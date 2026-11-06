import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import { channel, readMethod, saveMethod, validSettings, type SettingsEntry, type SettingsView } from './protocol.js'

export const name = 'dungsil-ui-setting-vcs'
export const inject = ['connection', 'configEditor']

const packages = new Map<string, SettingsEntry['kind']>([
  ['@deepseek-ai/dsh-experimental-worktree', 'worktree'],
  ['@deepseek-ai/dsh-experimental-client-ui-forge', 'panel'],
])
class SettingsError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !('__jsExpr' in value)
}
function layers(inherited: unknown, current: unknown): Record<string, unknown> {
  if (!record(inherited) || !record(current)) throw new SettingsError('unavailable')
  return { ...inherited, ...current }
}
function revision(inherited: Record<string, unknown>, current: Record<string, unknown>): string {
  return createHash('sha256')
    .update(JSON.stringify([inherited, layers(inherited, current)]))
    .digest('hex')
}
function settings(kind: SettingsEntry['kind'], inherited: Record<string, unknown>, current: Record<string, unknown>) {
  const effective = layers(inherited, current)
  const keys = kind === 'worktree' ? ['directory', 'namePrefix'] : ['worktreePrefix']
  // Raw expressions must never become editable fallback strings, even if evaluated at runtime.
  for (const layer of [inherited, current])
    for (const key of keys)
      if (Object.hasOwn(layer, key) && typeof layer[key] !== 'string') throw new SettingsError('unavailable')
  return kind === 'worktree'
    ? {
        directory: (effective.directory as string | undefined) ?? '.agents/worktrees',
        prefix: (effective.namePrefix as string | undefined) ?? 'dsh-',
      }
    : { prefix: (effective.worktreePrefix as string | undefined) ?? 'dsh-' }
}

export function apply(ctx: Context) {
  const editor = ctx.configEditor
  const rows = () => {
    const candidates = editor.configuration().filter(({ entry }) => packages.has(entry.options.name))
    const ids = new Set<string>()
    for (const { entry } of candidates) {
      if (!entry.options.id || ids.has(entry.options.id)) throw new SettingsError('unavailable')
      ids.add(entry.options.id)
    }
    return candidates
  }
  const view = (): SettingsView => ({
    entries: rows().map(({ entry, inherited, override }) => {
      const kind = packages.get(entry.options.name)!
      return {
        id: entry.options.id,
        kind,
        revision: revision(inherited, override),
        settings: settings(kind, inherited, override),
      }
    }),
  })
  for (const endpoint of [readMethod, saveMethod])
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            let body
            try {
              body = clientRequestSchema.safeParse(await request.json())
            } catch {
              return new Response('Invalid request', { status: 400 })
            }
            if (!body.success || body.data.method !== endpoint) return new Response('Invalid request', { status: 400 })
            let result
            try {
              if (endpoint === saveMethod) {
                const payload = body.data.payload
                if (
                  !record(payload) ||
                  Object.keys(payload).length !== 3 ||
                  !['id', 'revision', 'settings'].every((key) => Object.hasOwn(payload, key)) ||
                  typeof payload.id !== 'string' ||
                  typeof payload.revision !== 'string' ||
                  payload.revision.length !== 64 ||
                  !/^[a-f0-9]{64}$/.test(payload.revision)
                )
                  throw new SettingsError('invalid_request')
                const target = rows().find(({ entry }) => entry.options.id === payload.id)
                if (!target) throw new SettingsError('unavailable')
                const kind = packages.get(target.entry.options.name)!
                const next = payload.settings
                if (!validSettings(next, kind)) throw new SettingsError('invalid_request')
                await editor.edit(target.entry, (current, inherited) => {
                  // Recheck inside the editor's serialized write, not before acquiring its lock.
                  if (revision(inherited, current) !== payload.revision) throw new SettingsError('conflict')
                  settings(kind, inherited, current)
                  return kind === 'worktree'
                    ? { ...layers(inherited, current), directory: next.directory, namePrefix: next.prefix }
                    : { ...layers(inherited, current), worktreePrefix: next.prefix }
                })
              }
              result = { ok: true as const, value: view() }
            } catch (error) {
              const code =
                error instanceof SettingsError ? error.code : endpoint === saveMethod ? 'save_failed' : 'load_failed'
              result = { ok: false as const, error: { code, message: 'VCS settings operation failed.', details: {} } }
            }
            return Response.json(
              { type: 'server-response', rpcId: body.data.rpcId, result },
              { headers: { 'Cache-Control': 'no-store' } }
            )
          },
        }),
      'ui-setting-vcs: owner-only settings'
    )
}
