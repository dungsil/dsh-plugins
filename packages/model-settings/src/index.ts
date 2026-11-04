import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-llm'
import { channel, endpointPrefix, type Route, type TitleTarget } from './protocol.js'

export const name = 'dungsil-model-settings'
export const inject = ['connection', 'configEditor', 'llm']

// Edit the owning provider's configuration, rather than intercepting an LLM
// stream after its route, capabilities and durable request log are captured.
const titlePlugins = new Set([
  '@deepseek-ai/dsh-session-title-first-prompt-llm',
  '@deepseek-ai/dsh-session-title-all-prompts-llm',
])

export function apply(ctx: Context) {
  const targetEntry = (task: 'title' | 'worktree') => {
    const entries = ctx.configEditor
      .entries()
      .filter(
        (entry) =>
          (task === 'title'
            ? titlePlugins.has(entry.options.name)
            : entry.options.name === '@dungsil/dsh-plugin-ui-worktree') && entry.fiber?.state === 2
      )
    return entries.length === 1 ? entries[0] : undefined
  }
  const snapshot = (task: 'title' | 'worktree'): TitleTarget | null => {
    const entry = targetEntry(task)
    if (!entry) return null
    const config = entry.fiber!.config as { provider?: string; model?: string }
    return {
      id: entry.options.id,
      revision: createHash('sha256')
        .update(JSON.stringify([entry.fiber!.uid, entry.options.config]))
        .digest('hex'),
      route: config.provider && config.model ? { provider: config.provider, model: config.model } : null,
    }
  }
  const failure = (code: string) => ({
    ok: false as const,
    error: { code, message: 'Model settings could not be updated.', details: {} },
  })

  const handle = async (endpoint: string, payload: unknown, signal: AbortSignal) => {
    if (endpoint === 'describe') {
      let catalogError = false
      const providers = await Promise.all(
        ctx.llm.listProviders().map(async (provider) => {
          try {
            const models = await ctx.llm.listModels(provider.id)
            return { ...provider, models: models.map(({ id, name }) => ({ id, name })) }
          } catch {
            catalogError = true
            return { ...provider, models: [] }
          }
        })
      )
      return { ok: true, value: { target: snapshot('title'), worktree: snapshot('worktree'), providers, catalogError } }
    }
    if (!payload || typeof payload !== 'object') return failure('invalid')
    const input = payload as { id?: unknown; revision?: unknown; route?: unknown }
    if (typeof input.id !== 'string' || typeof input.revision !== 'string') return failure('invalid')
    let route: Route | null = null
    if (input.route !== null) {
      if (!input.route || typeof input.route !== 'object') return failure('invalid')
      const pair = input.route as Partial<Route>
      if (
        typeof pair.provider !== 'string' ||
        !pair.provider.trim() ||
        typeof pair.model !== 'string' ||
        !pair.model.trim()
      )
        return failure('invalid')
      route = { provider: pair.provider, model: pair.model }
      try {
        // Resolve the exact route without sending a generation request. An
        // adapter's catalog may be incomplete; its resolver owns availability.
        await ctx.llm.resolveModelInfo(route.provider, route.model, signal)
      } catch {
        return failure('model_unavailable')
      }
    }
    const task = snapshot('worktree')?.id === input.id ? 'worktree' : 'title'
    const entry = targetEntry(task)
    if (!entry) return failure('unavailable')
    try {
      signal.throwIfAborted()
      await ctx.configEditor.edit(entry, (current) => {
        const latest = snapshot(task)
        if (!latest || latest.id !== input.id || latest.revision !== input.revision) throw new Error('conflict')
        const next = { ...current }
        if (route) Object.assign(next, route)
        else {
          delete next.provider
          delete next.model
        }
        return next
      })
      return { ok: true, value: snapshot(task) }
    } catch (error) {
      return failure(error instanceof Error && error.message === 'conflict' ? 'conflict' : 'save_failed')
    }
  }

  for (const endpoint of ['describe', 'save']) {
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
              {
                headers: { 'Cache-Control': 'no-store' },
              }
            )
          },
        }),
      `model-settings: owner-only ${endpoint}`
    )
  }
}
