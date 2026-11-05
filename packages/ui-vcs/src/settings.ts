import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import z from '@deepseek-ai/schemastery'
import { SessionId } from '@deepseek-ai/dsh-session'
import { inspectCliStatus } from './cli-status.js'
import { channel, validCommitSettings, type CommitSettings } from './protocol.js'
import type { Config as ForgeConfig } from './pull-requests.js'

export const name = 'dungsil-vcs-settings'
export const inject = [
  'connection',
  'configEditor',
  'sessionController',
  'workingDirectory',
  'subprocess',
  'sandbox',
  'sandboxPolicy',
]
export const Config = z.object({
  provider: z.union(['auto', 'github', 'gitlab', 'gitea', 'forgejo']).default('auto'),
  authorName: z.string().default(''),
  authorEmail: z.string().default(''),
  noSign: z.boolean().default(false),
})
export interface Config extends ForgeConfig, CommitSettings {}

export function apply(ctx: Context) {
  const editor = ctx.configEditor
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())
  const entry = () => {
    const entries = editor.entries().filter((item) => item.options.name === '@dungsil/dsh-plugin-ui-vcs')
    if (entries.length !== 1) throw new Error('unavailable')
    return entries[0]!
  }
  const snapshot = () => {
    const current = entry().options.config
    return {
      revision: createHash('sha256')
        .update(JSON.stringify(current ?? {}))
        .digest('hex'),
      settings: {
        authorName: current?.authorName ?? '',
        authorEmail: current?.authorEmail ?? '',
        noSign: current?.noSign ?? false,
      },
    }
  }
  for (const endpoint of ['settings', 'save-settings', 'cli-status']) {
    const method = `dungsil-vcs/${endpoint}`
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${method}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            let rpcId = ''
            let result: unknown
            try {
              const body = clientRequestSchema.parse(await request.json())
              rpcId = body.rpcId
              if (body.method !== method) throw new Error('invalid')
              const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(30_000)])
              signal.throwIfAborted()
              if (endpoint === 'settings') {
                result = { ok: true, value: snapshot() }
              } else if (endpoint === 'save-settings') {
                const input = body.payload as { revision?: unknown; settings?: unknown } | null
                if (!input || typeof input.revision !== 'string' || !validCommitSettings(input.settings))
                  throw new Error('invalid')
                const settings = input.settings
                await editor.edit(entry(), (current) => {
                  if (snapshot().revision !== input.revision) throw new Error('conflict')
                  return { ...current, ...settings }
                })
                result = { ok: true, value: snapshot() }
              } else {
                const sessionId = (body.payload as { sessionId?: unknown } | null)?.sessionId
                if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) throw new Error('invalid')
                const resolved = await ctx.sessionController.resolveAgent(SessionId(sessionId))
                if ('error' in resolved) throw new Error('unavailable')
                const { agent } = resolved
                const cwd = await ctx.workingDirectory.ensure(agent, signal)
                const value = await inspectCliStatus(async (executable, args) => {
                  const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
                  let path: string
                  try {
                    path = await ctx.subprocess.resolveExecutable(executable, undefined, bounded)
                  } catch (error) {
                    if (error instanceof Error && error.name === 'SubprocessExecutableNotFoundError')
                      throw new Error('cli_missing')
                    throw error
                  }
                  const argv = [path, ...args]
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
                    env: {
                      GH_PROMPT_DISABLED: '1',
                      GLAB_PROMPT_DISABLED: '1',
                      NO_COLOR: '1',
                      GH_HOST: undefined,
                      GH_REPO: undefined,
                      GITLAB_HOST: undefined,
                      GITLAB_REPO: undefined,
                      TEA_LOGIN: undefined,
                      TEA_REPO: undefined,
                      ...(executable === 'tea'
                        ? {
                            GH_TOKEN: undefined,
                            GITEA_TOKEN: undefined,
                            GITEA_INSTANCE_URL: undefined,
                            GITEA_INSTANCE_SSH_HOST: undefined,
                            GITEA_INSTANCE_INSECURE: undefined,
                          }
                        : {}),
                    },
                    stdio: { stdin: 'ignore', stdout: { maxBytes: 131_072 }, stderr: { maxBytes: 16_384 } },
                  })
                  try {
                    const outcome = await child.done
                    bounded.throwIfAborted()
                    const output = child.collected!.stdout!.readFrom(0)
                    if (outcome.exitCode !== 0 || output.lossy) throw new Error('command_failed')
                    return output.text
                  } finally {
                    child.terminate()
                    await child.waitForExit()
                  }
                })
                signal.throwIfAborted()
                if (ctx.workingDirectory.get(agent.session) !== cwd) throw new Error('conflict')
                result = { ok: true, value }
              }
            } catch (error) {
              const code =
                error instanceof Error && ['invalid', 'conflict'].includes(error.message)
                  ? error.message
                  : 'unavailable'
              result = { ok: false, error: { code, message: 'Could not confirm VCS settings.', details: {} } }
            }
            return Response.json(
              { type: 'server-response', rpcId, result },
              { headers: { 'Cache-Control': 'no-store' } }
            )
          },
        }),
      `ui-vcs: owner-only ${endpoint}`
    )
  }
}
