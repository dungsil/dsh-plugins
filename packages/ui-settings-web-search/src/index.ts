import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import { channel, defaults, endpointPrefix, validSettings, type WebToolTarget } from './protocol.js'

export const name = 'dungsil-ui-settings-web-search'
export const inject = ['connection', 'configEditor']

interface PluginRow {
  id?: string
  name?: string
  disabled?: unknown
  group?: boolean
  config?: Record<string, unknown>
}

// Only ordinary Cordis groups contain child rows. Do not interpret arbitrary plugin configs.
function tools(rows: PluginRow[], path: number[] = []): { row: PluginRow; path: number[] }[] {
  return rows.flatMap((row, index) => {
    if (row.disabled === true) return []
    const next = [...path, index]
    if (row.name === '@deepseek-ai/dsh-tool-web') return [{ row, path: next }]
    if (row.group && Array.isArray(row.config)) return tools(row.config, next)
    return []
  })
}

const revision = (config: unknown) => createHash('sha256').update(JSON.stringify(config)).digest('hex')
const settingsOf = (config: Record<string, unknown> = {}) =>
  Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, config[key] ?? fallback])
  ) as WebToolTarget['settings']

export function apply(ctx: Context) {
  const editor = ctx.configEditor
  const targets = () =>
    editor.entries().flatMap((entry) => {
      if (entry.fiber?.state !== 2) return []
      const config = entry.options.config ?? {}
      const preset = entry.options.name === '@deepseek-ai/dsh-agent-preset'
      const matches = preset
        ? tools((config.plugins ?? []) as PluginRow[])
        : entry.options.name === '@deepseek-ai/dsh-tool-web'
          ? [{ row: { id: entry.options.id, config }, path: [] }]
          : []
      return matches.map(({ row, path }) => ({
        entry,
        path,
        view: {
          id: JSON.stringify([entry.options.id, path]),
          label: `${preset ? (config.name ?? config.id ?? entry.options.id) : entry.options.id}${matches.length > 1 ? ` / ${row.id ?? path.join('.')}` : ''}`,
          preset,
          revision: revision(config),
          settings: settingsOf(row.config),
        } satisfies WebToolTarget,
      }))
    })

  for (const action of ['describe', 'save']) {
    const method = `${endpointPrefix}${action}`
    // Exact Connection routes require the owner's identity; shared sessions cannot edit the profile.
    ctx.effect(() =>
      ctx.connection.fetch.register({
        path: `${channel}/${method}`,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          let body
          try {
            body = clientRequestSchema.safeParse(await request.json())
          } catch {
            return new Response('Invalid request', { status: 400 })
          }
          if (!body.success || body.data.method !== method) return new Response('Invalid request', { status: 400 })
          let result
          try {
            if (action === 'save') {
              const payload = body.data.payload as { id?: unknown; revision?: unknown; settings?: unknown }
              if (
                !payload ||
                typeof payload.id !== 'string' ||
                typeof payload.revision !== 'string' ||
                !validSettings(payload.settings)
              ) {
                return new Response('Invalid settings', { status: 400 })
              }
              const target = targets().find((target) => target.view.id === payload.id)
              if (!target) throw new Error('unavailable')
              const settings = settingsOf(payload.settings)
              await editor.edit(target.entry, (current) => {
                if (revision(current) !== payload.revision) throw new Error('conflict')
                const next = structuredClone(current)
                let config = next
                if (target.path.length) {
                  let rows = next.plugins as PluginRow[]
                  for (const index of target.path.slice(0, -1)) rows = rows[index].config as unknown as PluginRow[]
                  const row = rows[target.path.at(-1)!]
                  config = row.config ??= {}
                }
                Object.assign(config, settings)
                return next
              })
            }
            result = { ok: true as const, value: targets().map((target) => target.view) }
          } catch (error) {
            result = {
              ok: false as const,
              error: {
                code: error instanceof Error && error.message === 'conflict' ? 'conflict' : 'unavailable',
                message: 'Could not read or update web tool settings.',
                details: {},
              },
            }
          }
          return Response.json(
            { type: 'server-response', rpcId: body.data.rpcId, result },
            { headers: { 'Cache-Control': 'no-store' } }
          )
        },
      })
    )
  }
}
