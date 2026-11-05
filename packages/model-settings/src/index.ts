import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  renderYoonmoonInstructions,
  titleInstructions,
  worktreeInstructions,
  yoonmoonInstructions,
} from '@dungsil/dsh-task-prompts'
import { channel, endpointPrefix, type Route, type TitleTarget } from './protocol.js'

export const name = 'dungsil-model-settings'
export const inject = ['connection', 'configEditor', 'llm']

// Keep model routes in the owning provider's profile configuration.
const titlePlugins = new Set([
  '@deepseek-ai/dsh-session-title-first-prompt-llm',
  '@deepseek-ai/dsh-session-title-all-prompts-llm',
])
const wrappedTitles = new WeakSet<object>()

export async function apply(ctx: Context) {
  const editor = ctx.root.configEditor
  const settingsEntry = () =>
    editor
      .entries()
      .find((entry) => entry.options.name === '@dungsil/dsh-plugin-model-settings' && entry.fiber?.state === 2)
  const targetEntry = (task: 'title' | 'worktree' | 'yoonmoon') => {
    const entries = editor
      .entries()
      .filter(
        (entry) =>
          (task === 'title'
            ? titlePlugins.has(entry.options.name)
            : entry.options.name ===
              (task === 'worktree' ? '@dungsil/dsh-plugin-ui-worktree' : '@dungsil/dsh-plugin-yoonmoon')) &&
          entry.fiber?.state === 2
      )
    return entries.length === 1 ? entries[0] : undefined
  }
  const snapshot = (task: 'title' | 'worktree' | 'yoonmoon' | 'auxiliary'): TitleTarget | null => {
    const owner = settingsEntry()
    const entry = task === 'auxiliary' ? owner : targetEntry(task)
    if (!entry) return null
    const config = (task === 'auxiliary' ? (owner?.options.config?.auxiliaryModel ?? {}) : entry.fiber!.config) as
      | {
          provider?: string
          model?: string
          reasoningEffort?: string
          naming?: string
          targetWords: number
          targetCjkCharacters: number
        }
      | undefined
    if (!config) return null
    const inheritance = owner?.options.config?.inheritAuxiliary as Record<string, boolean> | undefined
    const useAuxiliary =
      task !== 'auxiliary' && !config.provider && !config.model && (inheritance?.[entry.options.id] ?? true)
    const settings = (task === 'title' ? owner?.options.config?.titleReasoning : undefined) as
      | (Route & { target: string; reasoningEffort: string })
      | undefined
    const defaultInstructions =
      task === 'title'
        ? titleInstructions(
            config.targetWords,
            config.targetCjkCharacters,
            entry.options.name === '@deepseek-ai/dsh-session-title-all-prompts-llm'
          )
        : task === 'worktree'
          ? worktreeInstructions(config.naming ?? 'semantic')
          : task === 'yoonmoon'
            ? yoonmoonInstructions
            : ''
    const instructions =
      (owner?.options.config?.instructions as Record<string, string> | undefined)?.[entry.options.id] ??
      defaultInstructions
    return {
      id: entry.options.id,
      revision: createHash('sha256')
        .update(
          JSON.stringify([
            task === 'auxiliary' ? entry.options.id : entry.fiber!.uid,
            task === 'auxiliary' ? config : entry.options.config,
            settings,
            useAuxiliary,
            instructions,
            defaultInstructions,
          ])
        )
        .digest('hex'),
      route: config.provider && config.model ? { provider: config.provider, model: config.model } : null,
      useAuxiliary,
      instructions,
      defaultInstructions,
      reasoningEffort:
        task !== 'title'
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

  // Scope overrides to task consumers, before validation and request logging.
  ctx.on('internal/get', (consumer, service, _error, next) => {
    if (service !== 'llm' && service !== 'sessionTitle') return next()
    const entry = editor.entries().find((entry) => entry.fiber === consumer.fiber)
    // During initial activation the loader has not attached the fiber to its entry yet.
    const task = titlePlugins.has(entry?.options.name ?? `@deepseek-ai/dsh-${consumer.fiber.name}`)
      ? 'title'
      : entry?.options.name === '@dungsil/dsh-plugin-ui-worktree' || consumer.fiber.name === 'dungsil-ui-worktree'
        ? 'worktree'
        : entry?.options.name === '@dungsil/dsh-plugin-yoonmoon' || consumer.fiber.name === 'yoonmoon'
          ? 'yoonmoon'
          : null
    if (!task) return next()
    if (service === 'sessionTitle') {
      if (task !== 'title') return next()
      const titles = next() as Context['sessionTitle']
      const register: Context['sessionTitle']['register'] = (provider) => {
        wrappedTitles.add(consumer.fiber)
        consumer.effect(() => () => {
          wrappedTitles.delete(consumer.fiber)
        })
        return titles.register({
          ...provider,
          generate(request) {
            const auxiliary = snapshot('title')?.useAuxiliary ? snapshot('auxiliary') : null
            // The title provider uses this route for both generation and provenance.
            return provider.generate(auxiliary?.route ? { ...request, route: auxiliary.route } : request)
          },
        })
      }
      return new Proxy(titles, {
        get: (target, key, receiver) => (key === 'register' ? register : Reflect.get(target, key, receiver)),
      })
    }
    const llm = next() as Context['llm']
    const prepareCall: Context['llm']['prepareCall'] = async (config, signal, configure) => {
      const target = snapshot(task)
      const auxiliary = target?.useAuxiliary ? snapshot('auxiliary') : null
      const effort = auxiliary?.route ? auxiliary.reasoningEffort : target?.reasoningEffort
      const call = await llm.prepareCall({ ...config, ...auxiliary?.route }, signal, (controls, model) => ({
        ...(configure ? configure(controls, model) : controls),
        ...(typeof effort === 'string' ? { reasoningEffort: ReasoningEffortId(effort) } : {}),
      }))
      const instructions = target?.instructions !== target?.defaultInstructions ? target?.instructions : undefined
      if (!instructions && !auxiliary?.instructions) return call
      return {
        ...call,
        stream: (options) => {
          let system = instructions ?? options.system
          if (instructions && task === 'yoonmoon') {
            // Read variables from the owning plugin's unmodified prompt, never user text.
            const original = /^Execute the (\S+) skill below\.[^\n]*\n\n([\s\S]*)$/u.exec(options.system ?? '')!
            system = renderYoonmoonInstructions(instructions, original[1]!, original[2]!)
          }
          return call.stream({
            ...options,
            system: [system, auxiliary?.instructions].filter(Boolean).join('\n\n'),
          })
        },
      }
    }
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
      return {
        ok: true,
        value: {
          auxiliary: snapshot('auxiliary'),
          target: snapshot('title'),
          worktree: snapshot('worktree'),
          yoonmoon: snapshot('yoonmoon'),
          providers,
          catalogError,
        },
      }
    }
    if (!payload || typeof payload !== 'object') return failure('invalid')
    const input = payload as {
      id?: unknown
      revision?: unknown
      route?: unknown
      reasoningEffort?: unknown
      useAuxiliary?: unknown
      instructions?: unknown
    }
    if (typeof input.id !== 'string' || typeof input.revision !== 'string') return failure('invalid')
    if (endpoint === 'instructions') {
      if (typeof input.instructions !== 'string') return failure('invalid')
      const owner = settingsEntry()
      const task = (['auxiliary', 'title', 'worktree', 'yoonmoon'] as const).find(
        (task) => snapshot(task)?.id === input.id
      )
      if (!owner || !task) return failure('unavailable')
      const instructions = input.instructions.trim()
      try {
        signal.throwIfAborted()
        await ctx.configEditor.edit(owner, (current) => {
          if (snapshot(task)?.revision !== input.revision) throw new Error('conflict')
          const next = { ...current }
          const saved = { ...(current.instructions as Record<string, string> | undefined) }
          if (instructions && instructions !== snapshot(task)?.defaultInstructions)
            saved[input.id as string] = instructions
          else delete saved[input.id as string]
          if (Object.keys(saved).length) next.instructions = saved
          else delete next.instructions
          return next
        })
        return { ok: true, value: snapshot(task) }
      } catch (error) {
        return failure(error instanceof Error && error.message === 'conflict' ? 'conflict' : 'save_failed')
      }
    }
    if (input.useAuxiliary !== undefined && typeof input.useAuxiliary !== 'boolean') return failure('invalid')
    const useAuxiliary = input.route === null && input.useAuxiliary === true
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
    const owner = settingsEntry()
    const task =
      owner?.options.id === input.id
        ? 'auxiliary'
        : snapshot('worktree')?.id === input.id
          ? 'worktree'
          : snapshot('yoonmoon')?.id === input.id
            ? 'yoonmoon'
            : 'title'
    const entry = task === 'auxiliary' ? owner : targetEntry(task)
    if (!entry || (task === 'title' && !owner)) return failure('unavailable')
    if (task === 'auxiliary' && useAuxiliary) return failure('invalid')
    try {
      signal.throwIfAborted()
      await ctx.configEditor.edit(entry, (current) => {
        const latest = snapshot(task)
        if (!latest || latest.id !== input.id || latest.revision !== input.revision) throw new Error('conflict')
        const next = { ...current }
        if (task === 'auxiliary') {
          if (route) next.auxiliaryModel = { ...route, ...(reasoningEffort !== null ? { reasoningEffort } : {}) }
          else delete next.auxiliaryModel
          return next
        }
        if (route) Object.assign(next, route)
        else {
          delete next.provider
          delete next.model
        }
        if (task !== 'title') {
          if (route && reasoningEffort !== null) next.reasoningEffort = reasoningEffort
          else delete next.reasoningEffort
        }
        return next
      })
      if (task === 'auxiliary' || !owner) return { ok: true, value: snapshot(task) }
      // The upstream title config rejects additional fields. Store our
      // extension in this plugin's config, bound to the exact title route so
      // changing that route elsewhere cannot reuse an incompatible effort.
      const updated = snapshot(task)
      if (
        !updated ||
        updated.id !== input.id ||
        updated.route?.provider !== route?.provider ||
        updated.route?.model !== route?.model
      )
        throw new Error('conflict')
      await ctx.configEditor.edit(owner!, (current) => {
        if (snapshot(task)?.revision !== updated.revision) throw new Error('conflict')
        const next = { ...current }
        const inheritance = { ...(current.inheritAuxiliary as Record<string, boolean> | undefined) }
        if (!route && !useAuxiliary) inheritance[input.id as string] = false
        else delete inheritance[input.id as string]
        if (Object.keys(inheritance).length) next.inheritAuxiliary = inheritance
        else delete next.inheritAuxiliary
        if (task === 'title') {
          if (route && reasoningEffort !== null) next.titleReasoning = { target: input.id, ...route, reasoningEffort }
          else delete next.titleReasoning
        }
        return next
      })
      return { ok: true, value: snapshot(task) }
    } catch (error) {
      return failure(error instanceof Error && error.message === 'conflict' ? 'conflict' : 'save_failed')
    }
  }

  for (const endpoint of ['describe', 'save', 'instructions']) {
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
  // Registration can precede this plugin while the title fiber is still loading.
  // Wait for that activation before rebinding once; later saves use live settings.
  const titles = editor.entries().filter((entry) => titlePlugins.has(entry.options.name))
  const title = titles.length === 1 ? titles[0]!.fiber : undefined
  if (title) {
    try {
      await title.await()
      if (title.state === 2 && !wrappedTitles.has(title)) await title.restart()
    } catch {
      // An optional title provider's startup error must not disable the settings API.
      // The loader reports that provider's failure independently.
    }
  }
}
