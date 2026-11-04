import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { channel, endpointPrefix, type Route, type TitleTarget } from './protocol.js'

export const name = 'dungsil-model-settings'
export const inject = ['connection', 'configEditor', 'llm']

// Keep model routes in the owning provider's profile configuration.
const titlePlugins = new Set([
  '@deepseek-ai/dsh-session-title-first-prompt-llm',
  '@deepseek-ai/dsh-session-title-all-prompts-llm',
])

export function apply(ctx: Context) {
  const settingsEntry = () =>
    ctx.configEditor.entries().find((entry) => entry.options.name === '@dungsil/dsh-plugin-model-settings')
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
    const config = entry.fiber!.config as { provider?: string; model?: string; reasoningEffort?: string }
    const settings = (task === 'title' ? settingsEntry()?.options.config?.titleReasoning : undefined) as
      | (Route & { target: string; reasoningEffort: string })
      | undefined
    return {
      id: entry.options.id,
      revision: createHash('sha256')
        .update(JSON.stringify([entry.fiber!.uid, entry.options.config, settings]))
        .digest('hex'),
      route: config.provider && config.model ? { provider: config.provider, model: config.model } : null,
      reasoningEffort:
        task === 'worktree'
          ? config.provider && config.model
            ? (config.reasoningEffort ?? null)
            : null
          : settings?.target === entry.options.id &&
              settings.provider === config.provider &&
              settings.model === config.model
            ? settings.reasoningEffort
            : null,
    }
  }

  // Upstream title providers always select the lowest effort. Scope this
  // service binding to their exact fiber, and select the override BEFORE LLM
  // validation and durable request logging, never by rewriting a stream.
  ctx.on('internal/get', (consumer, service, _error, next) => {
    if (service !== 'llm') return next()
    const entry = targetEntry('title')
    if (consumer.fiber !== entry?.fiber) return next()
    const effort = snapshot('title')?.reasoningEffort
    if (typeof effort !== 'string') return next()
    const llm = next() as Context['llm']
    const prepareCall: Context['llm']['prepareCall'] = (config, signal, configure) =>
      llm.prepareCall(config, signal, (controls, model) => ({
        ...(configure ? configure(controls, model) : controls),
        reasoningEffort: ReasoningEffortId(effort),
      }))
    return new Proxy(llm, {
      get: (target, key, receiver) => (key === 'prepareCall' ? prepareCall : Reflect.get(target, key, receiver)),
    })
  })

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
            return {
              ...provider,
              models: await Promise.all(
                models.map(async ({ id, name }) => {
                  try {
                    const info = await ctx.llm.resolveModelInfo(provider.id, id, signal)
                    return { id, name, efforts: info.reasoning?.efforts.map(({ id, name }) => ({ id, name })) ?? [] }
                  } catch {
                    catalogError = true
                    return { id, name, efforts: [] }
                  }
                })
              ),
            }
          } catch {
            catalogError = true
            return { ...provider, models: [] }
          }
        })
      )
      return { ok: true, value: { target: snapshot('title'), worktree: snapshot('worktree'), providers, catalogError } }
    }
    if (!payload || typeof payload !== 'object') return failure('invalid')
    const input = payload as { id?: unknown; revision?: unknown; route?: unknown; reasoningEffort?: unknown }
    if (typeof input.id !== 'string' || typeof input.revision !== 'string') return failure('invalid')
    const reasoningEffort = input.reasoningEffort ?? null
    if (reasoningEffort !== null && (typeof reasoningEffort !== 'string' || !reasoningEffort.trim()))
      return failure('invalid')
    if (input.route === null && reasoningEffort !== null) return failure('invalid')
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
        const info = await ctx.llm.resolveModelInfo(route.provider, route.model, signal)
        if (reasoningEffort !== null && !info.reasoning?.efforts.some((effort) => effort.id === reasoningEffort))
          return failure('reasoning_unavailable')
      } catch {
        return failure('model_unavailable')
      }
    }
    const task = snapshot('worktree')?.id === input.id ? 'worktree' : 'title'
    const entry = targetEntry(task)
    const owner = settingsEntry()
    if (!entry || (task === 'title' && !owner)) return failure('unavailable')
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
        if (task === 'worktree') {
          if (route && reasoningEffort !== null) next.reasoningEffort = reasoningEffort
          else delete next.reasoningEffort
        }
        return next
      })
      if (task === 'worktree') return { ok: true, value: snapshot(task) }
      // The upstream title config rejects additional fields. Store our
      // extension in this plugin's config, bound to the exact title route so
      // changing that route elsewhere cannot reuse an incompatible effort.
      const updated = snapshot('title')
      if (
        !updated ||
        updated.id !== input.id ||
        updated.route?.provider !== route?.provider ||
        updated.route?.model !== route?.model
      )
        throw new Error('conflict')
      await ctx.configEditor.edit(owner!, (current) => {
        if (snapshot('title')?.revision !== updated.revision) throw new Error('conflict')
        const next = { ...current }
        if (route && reasoningEffort !== null) next.titleReasoning = { target: input.id, ...route, reasoningEffort }
        else delete next.titleReasoning
        return next
      })
      return { ok: true, value: snapshot('title') }
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
