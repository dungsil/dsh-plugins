import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-working-directory'
import { SessionId } from '@deepseek-ai/dsh-session'

export const name = 'dungsil-ui-vcs'
export const inject = ['connection', 'sessionController', 'subprocess', 'sandbox', 'sandboxPolicy', 'workingDirectory']

// These reads never fetch, run hooks, or change Git state. Writes remain owned by the agent.
export function apply(ctx: Context) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: '/api/dungsil-vcs/describe',
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          const failure = {
            ok: false as const,
            error: { code: 'git_unavailable', message: 'Git context unavailable', details: {} },
          }
          let result: { ok: true; value: 'push' | 'pr' } | typeof failure = failure
          let rpcId = ''
          try {
            const body = clientRequestSchema.parse(await request.json())
            rpcId = body.rpcId
            if (body.method !== 'dungsil-vcs/describe') throw new Error('Invalid method')
            const sessionId = (body.payload as { sessionId?: unknown } | null)?.sessionId
            if (typeof sessionId !== 'string' || !sessionId) throw new Error('Invalid session')
            const resolved = await ctx.sessionController.resolveAgent(SessionId(sessionId))
            if ('error' in resolved) throw new Error('Session unavailable')
            const { agent } = resolved
            const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)])
            const cwd = await ctx.workingDirectory.ensure(agent, signal)
            const git = async (args: string[]) => {
              const argv = [
                await ctx.subprocess.resolveExecutable('git', undefined, signal),
                '-c',
                'core.fsmonitor=false',
                '-c',
                'core.hooksPath=/dev/null',
                ...args,
              ]
              const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
              const command =
                policy.mode === 'danger-full-access'
                  ? argv
                  : (await ctx.sandbox.confine(argv, { ...policy, mode: policy.mode }, signal)).argv
              const child = ctx.subprocess.spawn({
                argv: command,
                cwd,
                signal,
                graceMs: 1000,
                env: {
                  ...Object.fromEntries(
                    Object.keys(process.env)
                      .filter((key) => key.startsWith('GIT_'))
                      .map((key) => [key, undefined])
                  ),
                  GIT_TERMINAL_PROMPT: '0',
                  GIT_OPTIONAL_LOCKS: '0',
                  GIT_NO_LAZY_FETCH: '1',
                },
                stdio: { stdin: 'ignore', stdout: { maxBytes: 65536 }, stderr: { maxBytes: 4096 } },
              })
              try {
                const outcome = await child.done
                signal.throwIfAborted()
                const output = child.collected!.stdout!.readFrom(0)
                if (outcome.exitCode !== 0 || output.lossy) throw new Error('Git read failed')
                return output.text.replace(/\r?\n$/, '')
              } finally {
                child.terminate()
                await child.waitForExit()
              }
            }
            const gitDir = await git(['rev-parse', '--path-format=absolute', '--git-dir'])
            const commonDir = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'])
            if (gitDir !== commonDir) result = { ok: true, value: 'pr' }
            else {
              const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
              const upstream = await git(['for-each-ref', '--format=%(upstream:remotename)', `refs/heads/${branch}`])
              const remotes = (await git(['remote'])).split('\n').filter(Boolean)
              const remote =
                upstream && upstream !== '.'
                  ? upstream
                  : remotes.includes('origin')
                    ? 'origin'
                    : remotes.length === 1
                      ? remotes[0]
                      : undefined
              if (!remote) throw new Error('Default remote unknown')
              const head = await git(['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`])
              result = { ok: true, value: head === `refs/remotes/${remote}/${branch}` ? 'push' : 'pr' }
            }
            if (ctx.workingDirectory.get(agent.session) !== cwd) throw new Error('Working directory changed')
          } catch {
            result = failure
          }
          return Response.json({ type: 'server-response', rpcId, result }, { headers: { 'Cache-Control': 'no-store' } })
        },
      }),
    'ui-vcs: owner-only Git context'
  )
}
