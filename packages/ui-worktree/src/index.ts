import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-experimental-worktree'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-working-directory'
import { channel, endpointPrefix, type WorktreeView } from './protocol.js'

export const name = 'dungsil-ui-worktree'
export const inject = [
  'connection',
  'sessionController',
  'sessions',
  'worktrees',
  'workingDirectory',
  'subprocess',
  'sandbox',
  'sandboxPolicy',
]

// Do not let inherited Git selectors redirect the repository chosen by the Session.
const gitEnv = Object.fromEntries(
  [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'GIT_CEILING_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_SHALLOW_FILE',
    'GIT_GRAFT_FILE',
    'GIT_REPLACE_REF_BASE',
    'GIT_ATTR_SOURCE',
  ].map((key) => [key, undefined])
)

export function apply(ctx: Context) {
  const pending = new Set<string>()

  const describe = async (agent: Agent, signal: AbortSignal): Promise<WorktreeView> => {
    const cwd = await ctx.workingDirectory.ensure(agent, signal)
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    const argv = [
      await ctx.subprocess.resolveExecutable('git', undefined, bounded),
      '-c',
      'core.fsmonitor=false',
      'worktree',
      'list',
      '--porcelain',
      '-z',
    ]
    const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
    const command =
      policy.mode === 'danger-full-access'
        ? argv
        : (await ctx.sandbox.confine(argv, { ...policy, mode: policy.mode }, bounded)).argv
    const child = ctx.subprocess.spawn({
      argv: command,
      cwd,
      signal: bounded,
      graceMs: 1000,
      env: { ...gitEnv, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_048_576 }, stderr: { maxBytes: 65536 } },
    })
    try {
      const outcome = await child.done
      bounded.throwIfAborted()
      const output = child.collected!.stdout!.readFrom(0)
      if (outcome.exitCode !== 0 || output.lossy) throw new Error('Could not read the Git worktree list')
      const worktrees: WorktreeView['worktrees'] = []
      // -z preserves spaces, newlines and backslashes in literal filesystem paths.
      for (const record of output.text.split('\0\0')) {
        const fields = record.split('\0')
        const path = fields.find((field) => field.startsWith('worktree '))?.slice(9)
        if (!path || fields.includes('bare')) continue
        const branch = fields.find((field) => field.startsWith('branch refs/heads/'))?.slice(18) ?? null
        worktrees.push({ path, branch })
      }
      return { cwd, worktrees }
    } finally {
      child.terminate()
      await child.waitForExit()
    }
  }

  const failure = (code: string) => ({
    ok: false as const,
    error: {
      code,
      message: 'Worktree operation could not be confirmed. Reload the list before retrying.',
      details: {},
    },
  })
  const handle = async (endpoint: string, payload: unknown, signal: AbortSignal) => {
    if (!payload || typeof payload !== 'object') return failure('invalid')
    const input = payload as { sessionId?: unknown; cwd?: unknown; name?: unknown; path?: unknown }
    if (typeof input.sessionId !== 'string' || !input.sessionId) return failure('invalid')
    if (endpoint !== 'describe' && typeof input.cwd !== 'string') return failure('invalid')
    if (
      endpoint === 'create' &&
      input.name !== undefined &&
      (typeof input.name !== 'string' || input.name.length > 200)
    )
      return failure('invalid')
    if (endpoint === 'switch' && (typeof input.path !== 'string' || !input.path)) return failure('invalid')
    if (pending.has(input.sessionId)) return failure('busy')
    pending.add(input.sessionId)
    try {
      const resolved = await ctx.sessionController.resolveAgent(SessionId(input.sessionId))
      if ('error' in resolved)
        return {
          ok: false as const,
          error: { code: resolved.error.code, message: resolved.error.message, details: {} },
        }
      const { agent } = resolved
      // Directory changes inject non-waking notices for the next model step; they must not prevent another switch.
      const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(
        (message) => message.source.kind !== 'working-directory'
      )
      if (agent.status !== 'idle' || queued) return failure('busy')
      return await agent.runMaintenance(async (maintenanceSignal) => {
        const operationSignal = AbortSignal.any([signal, maintenanceSignal])
        operationSignal.throwIfAborted()
        if (endpoint === 'describe') return { ok: true as const, value: await describe(agent, operationSignal) }
        if (ctx.workingDirectory.get(agent.session) !== input.cwd) return failure('conflict')
        if (endpoint === 'create') {
          await ctx.worktrees.create(
            agent,
            { name: typeof input.name === 'string' ? input.name.trim() || undefined : undefined },
            operationSignal
          )
        } else {
          const view = await describe(agent, operationSignal)
          if (!view.worktrees.some((entry) => entry.path === input.path)) return failure('invalid')
          await ctx.workingDirectory.set(agent, input.path as string, operationSignal)
        }
        await ctx.sessions.flush(agent.session)
        return { ok: true as const, value: await describe(agent, operationSignal) }
      })
    } catch {
      return failure('operation_failed')
    } finally {
      pending.delete(input.sessionId)
    }
  }

  // Exact Connection routes admit only authenticated owner Peers, not shared Session viewers.
  for (const endpoint of ['describe', 'create', 'switch']) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${endpointPrefix}${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            let body
            try {
              body = clientRequestSchema.safeParse(await request.json())
            } catch {
              return new Response('Invalid request', { status: 400 })
            }
            if (!body.success || body.data.method !== `${endpointPrefix}${endpoint}`)
              return new Response('Invalid request', { status: 400 })
            const result = await handle(endpoint, body.data.payload, request.signal)
            return Response.json(
              { type: 'server-response', rpcId: body.data.rpcId, result },
              { headers: { 'Cache-Control': 'no-store' } }
            )
          },
        }),
      `ui-worktree: owner-only ${endpoint}`
    )
  }
}
