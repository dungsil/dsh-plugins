import { createHash, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import type { ModelSettingsService, TaskDefinition, TaskSettings } from './contract.js'
import { legacyRole, legacyTarget, readLegacySettings } from './compatibility.js'
import { channel, endpointPrefix, type ModelSelection, type Route, type TaskSnapshot } from './protocol.js'
import { createTitleAdapter } from './title-adapter.js'
import { createPwshInstructionsAdapter } from './pwsh-adapter.js'

export const name = 'dungsil-model-settings'
export const inject = ['connection', 'configEditor', 'llm']
export const provide = 'dungsilModelSettings'

type Entry = ReturnType<Context['configEditor']['entries']>[number]

interface RegisteredTask {
  entry: Entry
  owner: Context
  definition: TaskDefinition
  generation: string
}

const revision = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const failure = (code: string) => ({
  ok: false as const,
  error: { code, message: 'Model settings could not be updated.', details: {} },
})

function parseSelection(value: unknown): ModelSelection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as { mode?: unknown; route?: Partial<Route>; reasoningEffort?: unknown }
  if (input.mode === 'conversation' || input.mode === 'auxiliary') {
    if (input.route !== undefined || input.reasoningEffort !== undefined) return undefined
    return { mode: input.mode }
  }
  if (input.mode !== 'model' || !input.route || typeof input.route !== 'object') return undefined
  if (
    typeof input.route.provider !== 'string' ||
    !input.route.provider.trim() ||
    typeof input.route.model !== 'string' ||
    !input.route.model.trim()
  )
    return undefined
  const effort = input.reasoningEffort ?? null
  if (effort !== null && (typeof effort !== 'string' || !effort.trim())) return undefined
  return { mode: 'model', route: { provider: input.route.provider, model: input.route.model }, reasoningEffort: effort }
}

export async function apply(ctx: Context) {
  const editor = ctx.configEditor
  const tasks = new Map<string, RegisteredTask>()
  let active = true
  ctx.effect(() => () => {
    active = false
    tasks.clear()
  })
  // Locate our configuration by ownership, not by a conventional entry id.
  const settingsEntry = () =>
    editor.entries().find((entry) => entry.fiber?.uid === ctx.fiber.uid && ctx.fiber.state === 2)

  const auxiliary = (): TaskSnapshot | null => {
    const entry = settingsEntry()
    if (!entry) return null
    const config = (entry.options.config?.auxiliaryModel ?? {}) as Route & { reasoningEffort?: string }
    const instructions =
      (entry.options.config?.instructions as Record<string, string> | undefined)?.[entry.options.id] ?? ''
    return {
      id: JSON.stringify([entry.options.id, 'auxiliary']),
      key: 'auxiliary',
      owner: { entryId: entry.options.id, packageName: entry.options.name },
      label: { en: 'Auxiliary model', ko: '보조 모델', zh: '辅助模型' },
      description: {
        en: 'Shared model and reasoning effort for tasks set to use the auxiliary model.',
        ko: '보조 모델 따르기를 선택한 작업에 사용할 공통 모델과 추론 수준입니다.',
        zh: '选择使用辅助模型的任务共用的模型和推理级别。',
      },
      instructionsHint: {
        en: 'Appended to instructions for tasks using the auxiliary model, even when no auxiliary model is selected. Clear and save to remove.',
        ko: '보조 모델 따르기를 선택한 작업의 지침 뒤에 추가합니다. 보조 모델을 지정하지 않아도 적용하며, 비우고 저장하면 제거합니다.',
        zh: '追加到使用辅助模型的任务指令之后，即使未指定辅助模型也会生效。清空并保存即可移除。',
      },
      automaticReasoningLabel: { en: 'Automatic (task default)', ko: '자동 (작업 기본값)', zh: '自动（任务默认值）' },
      selection:
        config.provider && config.model
          ? {
              mode: 'model',
              route: { provider: config.provider, model: config.model },
              reasoningEffort: config.reasoningEffort ?? null,
            }
          : { mode: 'conversation' },
      instructions,
      defaultInstructions: '',
      // Saves to our own entry remount the service. Unrelated task settings
      // must not invalidate an auxiliary revision after that remount.
      revision: revision([entry.options.id, config, instructions]),
    }
  }

  const read = (task: RegisteredTask, config = task.entry.options.config ?? {}): TaskSettings => {
    const settings = task.definition.read(config)
    return legacyRole(task.entry.options.name, task.definition.key)
      ? readLegacySettings(task.entry.options.id, config, settings, settingsEntry()?.options.config)
      : settings
  }
  const snapshot = (id: string): TaskSnapshot | null => {
    const task = tasks.get(id)
    if (!task || task.entry.fiber?.uid !== task.owner.fiber.uid || task.owner.fiber.state !== 2) return null
    const settings = read(task)
    const defaultInstructions = task.definition.defaultInstructions(
      (task.owner.fiber.effectiveConfig ?? {}) as Readonly<Record<string, unknown>>
    )
    const { key, label, description, automaticReasoningLabel, instructionsHint } = task.definition
    return {
      id,
      key,
      owner: { entryId: task.entry.options.id, packageName: task.entry.options.name },
      label,
      description,
      automaticReasoningLabel,
      instructionsHint,
      ...(task.definition.kind ? { kind: task.definition.kind } : {}),
      selection: task.definition.kind === 'instructions' ? { mode: 'conversation' } : settings.selection,
      instructions: settings.instructions ?? defaultInstructions,
      defaultInstructions,
      revision: revision([task.generation, task.entry.options.config, settings, defaultInstructions]),
    }
  }

  const service: ModelSettingsService = {
    register(owner, definition) {
      const entry = owner.fiber.entry
      if (!entry || !editor.entries().includes(entry) || !definition.key.trim())
        throw new Error('Model settings task requires an addressable profile entry and a stable key.')
      for (const text of [
        definition.label,
        definition.description,
        definition.automaticReasoningLabel,
        definition.instructionsHint,
      ]) {
        if (
          text &&
          !(['en', 'ko', 'zh'] as const).every((locale) => typeof text[locale] === 'string' && text[locale].trim())
        )
          throw new Error('Model settings task metadata requires en, ko and zh translations.')
      }
      const id = JSON.stringify([entry.options.id, definition.key])
      if (tasks.has(id)) throw new Error(`Model settings task is already registered: ${id}`)
      const task = { entry, owner, definition, generation: randomUUID() }
      tasks.set(id, task)
      return {
        resolve(conversationRoute) {
          if (!active || tasks.get(id) !== task)
            throw new Error('Model settings task registration is no longer active.')
          const target = snapshot(id)
          if (!target) throw new Error('Model settings task is unavailable.')
          const shared = target.selection.mode === 'auxiliary' ? auxiliary() : null
          const selection = shared?.selection.mode === 'model' ? shared.selection : target.selection
          return {
            route: selection.mode === 'model' ? { ...selection.route } : { ...conversationRoute },
            reasoningEffort: selection.mode === 'model' ? selection.reasoningEffort : null,
            instructions: target.instructions,
            additionalInstructions: shared?.instructions ?? '',
          }
        },
        dispose() {
          if (tasks.get(id) === task) tasks.delete(id)
        },
      }
    },
  }
  ctx.provide('dungsilModelSettings', service)
  let pwshDefault: string | null = null
  const pwshAdapter = createPwshInstructionsAdapter(ctx, () => {
    const value = settingsEntry()?.options.config?.pwshToolDescription
    return typeof value === 'string' && value.trim() ? value : null
  })
  const pwshDefinition: TaskDefinition = {
    key: 'tool:pwsh',
    kind: 'instructions',
    label: { en: 'pwsh', ko: 'pwsh', zh: 'pwsh' },
    description: {
      en: 'Edit the native pwsh tool description.',
      ko: '기본 pwsh 도구 설명을 수정합니다.',
      zh: '编辑原生 pwsh 工具说明。',
    },
    automaticReasoningLabel: { en: 'Not applicable', ko: '해당 없음', zh: '不适用' },
    instructionsHint: {
      en: 'Replaces the default tool description from the next request. Clear and save to restore it. Parameter descriptions and execution permissions stay unchanged.',
      ko: '다음 요청부터 기본 도구 설명을 대체합니다. 비우고 저장하면 기본값으로 복원합니다. 인자별 설명과 실행 권한은 유지합니다.',
      zh: '从下次请求起替换默认工具说明。清空并保存可恢复默认值。参数说明和执行权限保持不变。',
    },
    read: (config) => ({
      selection: { mode: 'conversation' },
      instructions: typeof config.pwshToolDescription === 'string' ? config.pwshToolDescription : null,
    }),
    write: (config, settings) => {
      const next = { ...config }
      // Supplemental text from older revisions must never become a replacement.
      delete next.pwshInstructions
      if (settings.instructions && settings.instructions !== pwshDefault)
        next.pwshToolDescription = settings.instructions
      else delete next.pwshToolDescription
      return next
    },
    defaultInstructions: () => pwshDefault ?? '',
  }
  // This task lives on the settings service itself; saving remounts that service.
  // Read it directly from the current entry, not the disposed registration map.
  const pwshSnapshot = (): TaskSnapshot | null => {
    const entry = settingsEntry()
    if (!entry || pwshDefault === null) return null
    const settings = pwshDefinition.read(entry.options.config ?? {})
    return {
      id: JSON.stringify([entry.options.id, pwshDefinition.key]),
      key: pwshDefinition.key,
      kind: 'instructions',
      owner: { entryId: entry.options.id, packageName: entry.options.name },
      label: pwshDefinition.label,
      description: pwshDefinition.description,
      automaticReasoningLabel: pwshDefinition.automaticReasoningLabel,
      instructionsHint: pwshDefinition.instructionsHint,
      selection: { mode: 'conversation' },
      instructions: settings.instructions ?? pwshDefault,
      defaultInstructions: pwshDefault,
      revision: revision([entry.options.id, entry.options.config?.pwshToolDescription ?? null, pwshDefault]),
    }
  }
  const titles = createTitleAdapter(ctx, settingsEntry, auxiliary)
  const snapshots = () => [...tasks.keys()].map(snapshot).filter((task): task is TaskSnapshot => task !== null)
  const legacyTasks = () => {
    const current = snapshots()
    const unique = (role: 'worktree' | 'yoonmoon') => {
      const matches = current.filter((task) => legacyRole(task.owner.packageName, task.key) === role)
      return matches.length === 1 ? matches[0]! : null
    }
    return {
      auxiliary: auxiliary(),
      target: titles.snapshot(),
      worktree: unique('worktree'),
      yoonmoon: unique('yoonmoon'),
    }
  }
  const find = (id: string, v2: boolean) =>
    v2
      ? auxiliary()?.id === id
        ? auxiliary()
        : titles.snapshot()?.id === id
          ? titles.snapshot()
          : pwshSnapshot()?.id === id
            ? pwshSnapshot()
            : snapshot(id)
      : (Object.values(legacyTasks()).find((task) => task?.owner.entryId === id) ?? null)

  const catalog = async (signal: AbortSignal) => {
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
    return { providers, catalogError }
  }

  const handle = async (method: string, payload: unknown, signal: AbortSignal) => {
    const v2 = method.startsWith('v2/')
    const endpoint = v2 ? method.slice(3) : method
    if (v2) pwshDefault = await pwshAdapter.defaultInstructions()
    if (endpoint === 'describe') {
      const models = await catalog(signal)
      if (!v2) {
        const current = legacyTasks()
        return {
          ok: true,
          value: {
            ...models,
            auxiliary: legacyTarget(current.auxiliary),
            target: legacyTarget(current.target),
            worktree: legacyTarget(current.worktree),
            yoonmoon: legacyTarget(current.yoonmoon),
          },
        }
      }
      const title = titles.snapshot()
      const pwsh = pwshSnapshot()
      const current = [...snapshots(), ...(title ? [title] : []), ...(pwsh ? [pwsh] : [])]
      current.sort(
        (a, b) =>
          a.owner.packageName.localeCompare(b.owner.packageName) ||
          a.owner.entryId.localeCompare(b.owner.entryId) ||
          a.key.localeCompare(b.key)
      )
      return { ok: true, value: { ...models, auxiliary: auxiliary(), tasks: current } }
    }
    if (!payload || typeof payload !== 'object') return failure('invalid')
    const input = payload as {
      id?: unknown
      revision?: unknown
      instructions?: unknown
      selection?: unknown
      route?: unknown
      reasoningEffort?: unknown
      useAuxiliary?: unknown
    }
    if (typeof input.id !== 'string' || typeof input.revision !== 'string') return failure('invalid')
    let selection: ModelSelection | undefined
    let instructions: string | undefined
    if (endpoint === 'instructions') {
      if (typeof input.instructions !== 'string') return failure('invalid')
      instructions = input.instructions.trim()
    } else {
      if (v2) selection = parseSelection(input.selection)
      else {
        if (input.useAuxiliary !== undefined && typeof input.useAuxiliary !== 'boolean') return failure('invalid')
        if (input.route === null) {
          if (input.reasoningEffort !== undefined && input.reasoningEffort !== null) return failure('invalid')
          selection = { mode: input.useAuxiliary === true ? 'auxiliary' : 'conversation' }
        } else selection = parseSelection({ mode: 'model', route: input.route, reasoningEffort: input.reasoningEffort })
      }
      if (!selection) return failure('invalid')
    }
    const target = find(input.id, v2)
    if (!target) return failure('unavailable')
    if (target.kind === 'instructions' && selection !== undefined) return failure('invalid')
    const isAuxiliary = target.id === auxiliary()?.id
    if (isAuxiliary && selection?.mode === 'auxiliary') return failure('invalid')
    if (selection?.mode === 'model') {
      try {
        const info = await ctx.llm.resolveModelInfo(selection.route.provider, selection.route.model, signal)
        if (
          selection.reasoningEffort !== null &&
          !info.reasoning?.efforts.some((item) => item.id === selection.reasoningEffort)
        )
          return failure('reasoning_unavailable')
      } catch {
        return failure('model_unavailable')
      }
    }
    try {
      signal.throwIfAborted()
      if (target.id === titles.snapshot()?.id) {
        await titles.save(input.revision, selection, instructions, signal)
      } else {
        const registered = tasks.get(target.id)
        const isPwsh = target.kind === 'instructions' && target.id === pwshSnapshot()?.id
        const entry = isAuxiliary || isPwsh ? settingsEntry() : registered?.entry
        if (!entry) return failure('unavailable')
        await editor.edit(entry, (current) => {
          const latest = find(input.id as string, v2)
          if (!latest || latest.revision !== input.revision || (!isAuxiliary && tasks.get(target.id) !== registered))
            throw new Error('conflict')
          if (isAuxiliary) {
            const next = { ...current }
            if (selection) {
              if (selection.mode === 'model')
                next.auxiliaryModel = {
                  ...selection.route,
                  ...(selection.reasoningEffort !== null ? { reasoningEffort: selection.reasoningEffort } : {}),
                }
              else delete next.auxiliaryModel
            } else {
              const saved = { ...(current.instructions as Record<string, string> | undefined) }
              if (instructions) saved[entry.options.id] = instructions
              else delete saved[entry.options.id]
              if (Object.keys(saved).length) next.instructions = saved
              else delete next.instructions
            }
            return next
          }
          if (isPwsh)
            return pwshDefinition.write(current, {
              selection: { mode: 'conversation' },
              instructions: instructions || null,
            })
          const settings = read(registered!, current)
          return registered!.definition.write(current, {
            selection: selection ?? settings.selection,
            instructions:
              instructions === undefined
                ? settings.instructions
                : !instructions || instructions === latest.defaultInstructions
                  ? null
                  : instructions,
          })
        })
      }
      // A native save remounts its owner. Its optional integration may still
      // be loading when configEditor finishes reconciling that owner.
      const owner = editor.entries().find((entry) => entry.options.id === target.owner.entryId)
      if (owner?.fiber) await owner.fiber.await()
      if (!isAuxiliary) {
        // Await only the optional child fibers belonging to this owner.
        const children = [...ctx.registry.values()]
          .flatMap((runtime) => [...runtime.fibers])
          .filter((fiber) => fiber.parent.fiber.uid === owner?.fiber?.uid && 'dungsilModelSettings' in fiber.inject)
        await Promise.all(children.map((fiber) => fiber.await()))
      }
      const saved = find(input.id, v2)
      if (!saved) return failure('save_failed')
      return { ok: true, value: v2 ? saved : legacyTarget(saved) }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      return failure(code === 'conflict' || code === 'unavailable' || code === 'invalid' ? code : 'save_failed')
    }
  }

  for (const endpoint of ['describe', 'save', 'instructions', 'v2/describe', 'v2/save', 'v2/instructions']) {
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
  await titles.ready()
}
