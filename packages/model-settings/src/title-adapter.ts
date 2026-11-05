import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-config-editor'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-title'
import { titleInstructions } from '@dungsil/dsh-task-prompts'
import type { ModelSelection, Route, TaskSnapshot } from './protocol.js'

const titlePlugins = new Set([
  '@deepseek-ai/dsh-session-title-first-prompt-llm',
  '@deepseek-ai/dsh-session-title-all-prompts-llm',
])

type Entry = ReturnType<Context['configEditor']['entries']>[number]

// Upstream title providers cannot yet participate in the public task contract.
// Keep their schema and service interception isolated from native consumers.
export function createTitleAdapter(
  ctx: Context,
  settingsEntry: () => Entry | undefined,
  auxiliary: () => TaskSnapshot | null
) {
  const editor = ctx.configEditor
  const wrapped = new Set<Context['fiber']['uid']>()
  const targetEntry = () => {
    const entries = editor.entries().filter((entry) => titlePlugins.has(entry.options.name))
    return entries.length === 1 && entries[0]!.fiber?.state === 2 ? entries[0] : undefined
  }
  const snapshot = (): TaskSnapshot | null => {
    const entry = targetEntry()
    if (!entry) return null
    const owner = settingsEntry()
    const config = (entry.fiber!.effectiveConfig ?? entry.fiber!.config) as {
      provider?: string
      model?: string
      targetWords: number
      targetCjkCharacters: number
    }
    const saved = owner?.options.config?.titleReasoning as
      | (Route & { target: string; reasoningEffort: string })
      | undefined
    const defaultInstructions = titleInstructions(
      config.targetWords,
      config.targetCjkCharacters,
      entry.options.name === '@deepseek-ai/dsh-session-title-all-prompts-llm'
    )
    const instructions =
      (owner?.options.config?.instructions as Record<string, string> | undefined)?.[entry.options.id] ??
      defaultInstructions
    const inheritance = owner?.options.config?.inheritAuxiliary as Record<string, boolean> | undefined
    const selection: ModelSelection =
      config.provider && config.model
        ? {
            mode: 'model',
            route: { provider: config.provider, model: config.model },
            reasoningEffort:
              saved?.target === entry.options.id && saved.provider === config.provider && saved.model === config.model
                ? saved.reasoningEffort
                : null,
          }
        : { mode: inheritance?.[entry.options.id] === false ? 'conversation' : 'auxiliary' }
    return {
      id: JSON.stringify([entry.options.id, 'title']),
      key: 'title',
      owner: { entryId: entry.options.id, packageName: entry.options.name },
      label: { en: 'Session title', ko: '세션 제목', zh: '会话标题' },
      description: {
        en: 'Choose the model and reasoning effort used to automatically generate session titles.',
        ko: '세션 제목을 자동으로 생성할 때 사용할 모델과 추론 수준을 설정합니다.',
        zh: '设置自动生成会话标题时使用的模型和推理级别。',
      },
      automaticReasoningLabel: {
        en: 'Automatic (lowest supported effort)',
        ko: '자동 (지원하는 최저 수준)',
        zh: '自动（支持的最低级别）',
      },
      revision: createHash('sha256')
        .update(
          JSON.stringify([entry.fiber!.uid, entry.options.config, saved, selection, instructions, defaultInstructions])
        )
        .digest('hex'),
      selection,
      instructions,
      defaultInstructions,
    }
  }

  ctx.on('internal/get', (consumer, service, _error, next) => {
    if (service !== 'llm' && service !== 'sessionTitle') return next()
    const entry = consumer.fiber.entry
    if (!titlePlugins.has(entry?.options.name ?? `@deepseek-ai/dsh-${consumer.fiber.name}`)) return next()
    if (service === 'sessionTitle') {
      const titles = next() as Context['sessionTitle']
      const register: Context['sessionTitle']['register'] = (provider) => {
        const uid = consumer.fiber.uid
        wrapped.add(uid)
        consumer.effect(() => () => {
          wrapped.delete(uid)
        })
        return titles.register({
          ...provider,
          generate(request) {
            const shared = snapshot()?.selection.mode === 'auxiliary' ? auxiliary() : null
            return provider.generate(
              shared?.selection.mode === 'model' ? { ...request, route: shared.selection.route } : request
            )
          },
        })
      }
      return new Proxy(titles, {
        get: (target, key, receiver) => (key === 'register' ? register : Reflect.get(target, key, receiver)),
      })
    }
    const llm = next() as Context['llm']
    const prepareCall: Context['llm']['prepareCall'] = async (config, signal, configure) => {
      const task = snapshot()
      const shared = task?.selection.mode === 'auxiliary' ? auxiliary() : null
      const selected = shared?.selection.mode === 'model' ? shared.selection : task?.selection
      const effort = selected?.mode === 'model' ? selected.reasoningEffort : null
      const call = await llm.prepareCall(
        { ...config, ...(shared?.selection.mode === 'model' ? shared.selection.route : {}) },
        signal,
        (controls, model) => ({
          ...(configure ? configure(controls, model) : controls),
          ...(effort !== null ? { reasoningEffort: ReasoningEffortId(effort) } : {}),
        })
      )
      const instructions = task?.instructions !== task?.defaultInstructions ? task?.instructions : undefined
      if (!instructions && !shared?.instructions) return call
      return {
        ...call,
        stream: (options) =>
          call.stream({
            ...options,
            system: [instructions ?? options.system, shared?.instructions].filter(Boolean).join('\n\n'),
          }),
      }
    }
    return new Proxy(llm, {
      get: (target, key, receiver) => (key === 'prepareCall' ? prepareCall : Reflect.get(target, key, receiver)),
    })
  })

  const save = async (
    revision: string,
    selection: ModelSelection | undefined,
    instructions: string | undefined,
    signal: AbortSignal
  ) => {
    const entry = targetEntry()
    const owner = settingsEntry()
    if (!entry || !owner) throw new Error('unavailable')
    const check = (expected: string) => {
      if (snapshot()?.revision !== expected) throw new Error('conflict')
    }
    signal.throwIfAborted()
    if (instructions !== undefined) {
      await editor.edit(owner, (current) => {
        check(revision)
        const next = { ...current }
        const saved = { ...(current.instructions as Record<string, string> | undefined) }
        if (instructions && instructions !== snapshot()!.defaultInstructions) saved[entry.options.id] = instructions
        else delete saved[entry.options.id]
        if (Object.keys(saved).length) next.instructions = saved
        else delete next.instructions
        return next
      })
      return
    }
    if (!selection) throw new Error('invalid')
    await editor.edit(entry, (current) => {
      check(revision)
      const next = { ...current }
      if (selection.mode === 'model') Object.assign(next, selection.route)
      else {
        delete next.provider
        delete next.model
      }
      return next
    })
    const updated = snapshot()
    const route = selection.mode === 'model' ? selection.route : null
    if (
      !updated ||
      (updated.selection.mode === 'model' ? updated.selection.route.provider : undefined) !== route?.provider ||
      (updated.selection.mode === 'model' ? updated.selection.route.model : undefined) !== route?.model
    )
      throw new Error('conflict')
    await editor.edit(owner, (current) => {
      check(updated.revision)
      const next = { ...current }
      const inheritance = { ...(current.inheritAuxiliary as Record<string, boolean> | undefined) }
      if (selection.mode === 'conversation') inheritance[entry.options.id] = false
      else delete inheritance[entry.options.id]
      if (Object.keys(inheritance).length) next.inheritAuxiliary = inheritance
      else delete next.inheritAuxiliary
      if (selection.mode === 'model' && selection.reasoningEffort !== null)
        next.titleReasoning = {
          target: entry.options.id,
          ...selection.route,
          reasoningEffort: selection.reasoningEffort,
        }
      else delete next.titleReasoning
      return next
    })
  }

  const ready = async () => {
    const titles = editor.entries().filter((entry) => titlePlugins.has(entry.options.name))
    const title = titles.length === 1 ? titles[0]!.fiber : undefined
    if (!title) return
    try {
      await title.await()
      if (title.state === 2 && !wrapped.has(title.uid)) await title.restart()
    } catch {
      // An optional provider's startup failure must not disable other tasks.
    }
  }
  return { snapshot, save, ready }
}
