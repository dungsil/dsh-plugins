import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  Button,
  installSettingsIcon,
  SettingsPicker,
  SettingsRow,
  settingsStyles,
  type MenuEntry,
} from '@dungsil/dsh-ui'
import { IconChevronDownOutlineRegular, modelSettingsIconSvg } from '@dungsil/dsh-ui/icons'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import {
  channel,
  endpointPrefix,
  type ModelSettingsViewV2,
  type ModelSelection,
  type Route,
  type TaskSnapshot,
} from '@dungsil/dsh-plugin-model-settings/protocol'

export const name = 'dungsil-ui-model-settings'
export const inject = ['connection', 'locale', 'slots']

const copy = {
  en: {
    nav: 'Models by task',
    taskSettings: 'Task-specific settings',
    model: 'Model',
    inherit: 'Use conversation model',
    useAuxiliary: 'Use auxiliary model',
    auxiliaryHint: 'Uses the auxiliary model and its reasoning effort. If unset, uses the conversation model.',
    instructions: 'Instructions',
    editInstructions: 'Edit instructions',
    instructionsHint: 'Edit the default prompt used for this task. Clear and save to restore the default.',
    save: 'Save',
    effort: 'Reasoning effort',
    automatic: 'Automatic',
    effortHint: 'Choose a model to set its reasoning effort. Automatic keeps the existing behavior.',
    noEfforts: 'This model does not offer reasoning effort settings.',
    missingEffort: 'Saved effort (currently unavailable)',
    saving: 'Saving…',
    loading: 'Loading models…',
    resyncing: 'Checking saved settings…',
    loadError: 'Could not load settings. Close and reopen this settings section to try again.',
    resyncError:
      'Could not check saved settings. Changes are disabled. Close and reopen this settings section to try again.',
    unavailable: 'No tasks are registered. Enable a plugin that registers model settings tasks.',
    catalog: 'Some model lists could not be loaded. You can still use the conversation model.',
    missing: 'Saved model (not in current catalog)',
    error: 'Could not confirm the change. The change will not be retried automatically.',
    conflict: 'Settings changed elsewhere. Your change will not be retried automatically.',
    model_unavailable: 'This model is unavailable. Choose an available model after the settings check.',
    reasoning_unavailable: 'This reasoning effort is unavailable. Choose a supported effort or Automatic.',
  },
  ko: {
    nav: '상황별 모델',
    taskSettings: '작업별 설정',
    model: '모델',
    inherit: '대화 모델 따르기',
    useAuxiliary: '보조 모델 따르기',
    auxiliaryHint: '보조 모델과 추론 수준을 따릅니다. 보조 모델을 지정하지 않으면 대화 모델을 따릅니다.',
    instructions: '지침',
    editInstructions: '지침 수정',
    instructionsHint: '이 작업의 기본 프롬프트를 직접 수정합니다. 내용을 비우고 저장하면 기본값으로 복원합니다.',
    save: '저장',
    effort: '추론 수준',
    automatic: '자동',
    effortHint: '모델을 지정하면 추론 수준을 선택할 수 있습니다. 자동은 기존 동작을 유지합니다.',
    noEfforts: '이 모델은 추론 수준 설정을 제공하지 않습니다.',
    missingEffort: '저장된 추론 수준 (현재 사용할 수 없음)',
    saving: '저장 중…',
    loading: '모델을 불러오는 중입니다…',
    resyncing: '저장된 설정을 확인하는 중입니다…',
    loadError: '설정을 불러오지 못했습니다. 이 설정 항목을 닫았다가 다시 열어 주세요.',
    resyncError: '저장된 설정을 확인하지 못해 변경을 잠갔습니다. 이 설정 항목을 닫았다가 다시 열어 주세요.',
    unavailable: '등록된 작업이 없습니다. 모델 설정 작업을 등록하는 플러그인을 활성화하세요.',
    catalog: '일부 모델 목록을 불러오지 못했습니다. 대화 모델은 계속 따를 수 있습니다.',
    missing: '저장된 모델 (현재 목록에 없음)',
    error: '변경 여부를 확인하지 못했습니다. 변경 사항은 자동으로 다시 저장하지 않습니다.',
    conflict: '다른 곳에서 설정을 변경했습니다. 선택한 값은 자동으로 다시 저장하지 않습니다.',
    model_unavailable: '사용할 수 없는 모델입니다. 설정 확인이 끝나면 다른 모델을 선택하세요.',
    reasoning_unavailable: '사용할 수 없는 추론 수준입니다. 지원하는 수준이나 자동을 선택하세요.',
  },
  zh: {
    nav: '任务模型设置',
    taskSettings: '各任务设置',
    model: '模型',
    inherit: '使用对话模型',
    useAuxiliary: '使用辅助模型',
    auxiliaryHint: '使用辅助模型及其推理级别。未指定辅助模型时使用对话模型。',
    instructions: '指令',
    editInstructions: '编辑指令',
    instructionsHint: '直接编辑此任务的默认提示词。清空并保存即可恢复默认值。',
    save: '保存',
    effort: '推理级别',
    automatic: '自动',
    effortHint: '指定模型后可选择推理级别。自动选项保留现有行为。',
    noEfforts: '此模型不提供推理级别设置。',
    missingEffort: '已保存的推理级别（当前不可用）',
    saving: '正在保存…',
    loading: '正在加载模型…',
    resyncing: '正在检查已保存的设置…',
    loadError: '无法加载设置。请关闭并重新打开此设置项后重试。',
    resyncError: '无法确认已保存的设置，已禁止更改。请关闭并重新打开此设置项后重试。',
    unavailable: '尚未注册任何任务。请启用注册模型设置任务的插件。',
    catalog: '部分模型列表无法加载。仍可使用对话模型。',
    missing: '已保存的模型（不在当前列表中）',
    error: '无法确认更改是否生效。不会自动重新保存此更改。',
    conflict: '设置已在其他位置更改。不会自动重新保存您选择的值。',
    model_unavailable: '此模型不可用。请在设置检查完成后选择可用模型。',
    reasoning_unavailable: '此推理级别不可用。请选择支持的级别或自动选项。',
  },
}

const languageKey = (language: string) => (language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en')
const localizedCopy = (language: string) => copy[languageKey(language)]

const styles = `${settingsStyles}
.dsh-model-settings { container-type: inline-size; color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-model-settings-field { border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-model-settings-field[data-auxiliary=true] { border-bottom: none; }
.dsh-model-settings .dsh-plugin-settings-row { border-bottom: none; gap: 8px; }
.dsh-model-settings-task-heading { margin: 32px 0 0; padding-bottom: 8px; border-bottom: .5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font: inherit; }
.dsh-model-settings-description { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; }
.dsh-model-settings-controls { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 65%; }
.dsh-model-settings-picker + .dsh-model-settings-picker { flex: none; max-width: 60%; }
.dsh-model-settings-expander { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: var(--dsw-radius-xs); color: var(--dsw-alias-label-tertiary); background: transparent; cursor: pointer; }
.dsh-model-settings-expander:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-model-settings-expander svg { transition: transform var(--ds-transition-duration-fast) var(--ds-ease-in-out); }
.dsh-model-settings-expander[aria-expanded=true] svg { transform: rotate(180deg); }
.dsh-model-settings-expander:focus-visible, .dsh-model-settings-instructions textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset: 2px; }
.dsh-model-settings-instructions { padding: 0 0 16px; }
.dsh-model-settings-instructions label { display: block; }
.dsh-model-settings-instructions textarea { box-sizing: border-box; display: block; width: 100%; min-height: 112px; resize: vertical; margin-top: 12px; padding: 10px 12px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); color: inherit; font: inherit; }
.dsh-model-settings-instructions textarea:disabled { opacity: .5; }
.dsh-model-settings-instruction-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.dsh-model-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); margin: 12px 0; }
.dsh-model-settings [role=status] { margin: 12px 0; }
@container (max-width: 480px) {
  .dsh-model-settings .dsh-plugin-settings-row { align-items: flex-start; flex-direction: column; gap: 12px; }
  .dsh-model-settings-controls { flex-wrap: wrap; width: 100%; max-width: 100%; }
  .dsh-model-settings-controls .dsh-model-settings-picker { width: 100%; max-width: 100%; }
  .dsh-model-settings-controls .dsh-model-settings-picker:first-child { width: calc(100% - 32px); }
  .dsh-model-settings-expander { order: 1; }
  .dsh-model-settings-picker + .dsh-model-settings-picker { order: 2; }
  .dsh-model-settings-controls .dsh-plugin-settings-selector { width: 100%; justify-content: space-between; }
}
`

const routeKey = (route: Route | null) => (route ? JSON.stringify([route.provider, route.model]) : '')
const selectionKey = ({ selection }: TaskSnapshot) =>
  selection.mode === 'model' ? routeKey(selection.route) : selection.mode === 'auxiliary' ? 'auxiliary' : ''
const reasoningEffort = ({ selection }: TaskSnapshot) =>
  selection.mode === 'model' ? (selection.reasoningEffort ?? '') : ''
type Notice = 'error' | 'conflict' | 'model_unavailable' | 'reasoning_unavailable'

function ModelSettings({ ctx }: { ctx: Context }) {
  const locale = useLocaleSnapshot(ctx.locale)
  const language = languageKey(locale.active)
  const text = localizedCopy(locale.active)
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<ModelSettingsViewV2>()
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [effortDrafts, setEffortDrafts] = useState<Record<string, string>>({})
  const [instructionDrafts, setInstructionDrafts] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<'loading' | 'saving' | 'resyncing' | undefined>('loading')
  const [synchronized, setSynchronized] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const [noticeTask, setNoticeTask] = useState<string>()
  const [readError, setReadError] = useState<'loadError' | 'resyncError'>()
  const lock = useRef(true)
  const lifetime = useRef<AbortController>()

  const read = useCallback(
    async (controller: AbortController, preserveInstructions = false) => {
      const result = await connection.rpc.call(channel, `${endpointPrefix}v2/describe`, {}, controller.signal)
      if (controller.signal.aborted || lifetime.current !== controller) return false
      if (!result.ok) throw new Error('describe failed')
      const next = result.value as unknown as ModelSettingsViewV2
      const snapshots = next.auxiliary ? [next.auxiliary, ...next.tasks] : next.tasks
      setView(next)
      setInstructionDrafts((current) =>
        Object.fromEntries(
          snapshots.map((task) => [
            task.id,
            preserveInstructions ? (current[task.id] ?? task.instructions) : task.instructions,
          ])
        )
      )
      setEffortDrafts(Object.fromEntries(snapshots.map((task) => [task.id, reasoningEffort(task)])))
      setDrafts(Object.fromEntries(snapshots.map((task) => [task.id, selectionKey(task)])))
      setSynchronized(true)
      return true
    },
    [connection]
  )

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    lock.current = true
    setBusy('loading')
    setSynchronized(false)
    setNotice(undefined)
    setNoticeTask(undefined)
    setReadError(undefined)
    void (async () => {
      let loaded = false
      try {
        loaded = await read(controller)
      } catch {
        if (!controller.signal.aborted && lifetime.current === controller) setReadError('loadError')
      } finally {
        if (!controller.signal.aborted && lifetime.current === controller) {
          lock.current = !loaded
          setBusy(undefined)
        }
      }
    })()
    return () => {
      controller.abort()
      if (lifetime.current === controller) lifetime.current = undefined
    }
  }, [read])

  const options =
    view?.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        route: { provider: provider.id, model: model.id },
        label: `${provider.name} / ${model.name}`,
        name: model.name,
        efforts: model.efforts,
      }))
    ) ?? []
  const modelItems: MenuEntry[] = [
    { id: '', label: text.inherit },
    ...(view?.providers.flatMap((provider): MenuEntry[] =>
      provider.models.length
        ? [
            { type: 'separator', id: `separator:${provider.id}` },
            { type: 'label', id: `provider:${provider.id}`, text: provider.name },
            ...provider.models.map((model) => ({
              id: routeKey({ provider: provider.id, model: model.id }),
              label: model.name,
            })),
          ]
        : []
    ) ?? []),
  ]

  const snapshots = view ? (view.auxiliary ? [view.auxiliary, ...view.tasks] : view.tasks) : []

  const save = async (task: string, draft: string, effort: string, instructions?: string) => {
    const controller = lifetime.current
    const target = snapshots.find((snapshot) => snapshot.id === task)
    const option = options.find((option) => routeKey(option.route) === draft)
    const selected = option?.route ?? null
    const missingEffort = effort !== '' && !option?.efforts.some((item) => item.id === effort)
    if (
      lock.current ||
      !controller ||
      controller.signal.aborted ||
      !target ||
      !synchronized ||
      (instructions === undefined &&
        ((draft === selectionKey(target) && effort === reasoningEffort(target)) ||
          (draft === 'auxiliary' && target.id === view?.auxiliary?.id) ||
          (draft && draft !== 'auxiliary' && !selected) ||
          missingEffort)) ||
      (instructions !== undefined && instructions.trim() === target.instructions)
    )
      return
    lock.current = true
    setBusy('saving')
    setDrafts((current) => ({ ...current, [task]: draft }))
    setEffortDrafts((current) => ({ ...current, [task]: effort }))
    setNotice(undefined)
    setNoticeTask(task)
    setReadError(undefined)
    const active = () => !controller.signal.aborted && lifetime.current === controller
    let failure: Notice | undefined
    try {
      const selection: ModelSelection =
        draft === 'auxiliary'
          ? { mode: 'auxiliary' }
          : selected
            ? { mode: 'model', route: selected, reasoningEffort: effort || null }
            : { mode: 'conversation' }
      const result = await connection.rpc.call(
        channel,
        `${endpointPrefix}v2/${instructions === undefined ? 'save' : 'instructions'}`,
        instructions !== undefined
          ? { id: target.id, revision: target.revision, instructions }
          : {
              id: target.id,
              revision: target.revision,
              selection,
            },
        controller.signal
      )
      if (!active()) return
      if (result.ok) {
        const saved = result.value as unknown as TaskSnapshot
        setView(
          (current) =>
            current && {
              ...current,
              auxiliary: current.auxiliary?.id === task ? saved : current.auxiliary,
              tasks: current.tasks.map((snapshot) => (snapshot.id === task ? saved : snapshot)),
            }
        )
        setDrafts((current) => ({ ...current, [task]: selectionKey(saved) }))
        setEffortDrafts((current) => ({ ...current, [task]: reasoningEffort(saved) }))
        if (instructions !== undefined) setInstructionDrafts((current) => ({ ...current, [task]: saved.instructions }))
        // Shared settings can remount the service and renew every task's
        // registration. Refresh revisions without discarding other text drafts.
        await read(controller, true)
      } else {
        const code = result.error.code
        failure =
          code === 'conflict' || code === 'model_unavailable' || code === 'reasoning_unavailable' ? code : 'error'
      }
    } catch {
      if (!active()) return
      failure = 'error'
    }
    if (!active()) return
    let confirmed = !failure
    if (failure) {
      setNotice(failure)
      setSynchronized(false)
      setBusy('resyncing')
      try {
        confirmed = await read(controller)
      } catch {
        if (active()) setReadError('resyncError')
      }
    }
    if (active()) {
      lock.current = !confirmed
      setBusy(undefined)
    }
  }

  return (
    <section className="dsh-model-settings" aria-label={text.nav} aria-busy={!!busy}>
      {busy === 'loading' && <p role="status">{text.loading}</p>}
      {busy === 'resyncing' && <p role="status">{text.resyncing}</p>}
      {readError && <p role="alert">{text[readError]}</p>}
      {view && view.tasks.length === 0 && <p role="status">{text.unavailable}</p>}
      {snapshots.map((target, index) => {
        const task = target.id
        const auxiliary = target.id === view?.auxiliary?.id
        const title = target.label[language]
        const draft = drafts[task]
        const effort = effortDrafts[task]
        const route = target.selection.mode === 'model' ? target.selection.route : null
        const current = routeKey(route)
        const missing = current !== '' && !options.some((option) => routeKey(option.route) === current)
        const option = options.find((option) => routeKey(option.route) === draft)
        const selected = option?.route ?? null
        const efforts = option?.efforts ?? []
        const missingEffort = effort !== '' && !efforts.some((item) => item.id === effort)
        const automaticHint = target.automaticReasoningLabel[language]
        const modelLabel =
          draft === 'auxiliary' ? text.useAuxiliary : (option?.name ?? (draft ? text.missing : text.inherit))
        const effortLabel =
          efforts.find((item) => item.id === effort)?.name ?? (effort ? text.missingEffort : text.automatic)
        const fieldId = `${id}-${task}`
        const modelTitle =
          (draft === 'auxiliary' ? text.auxiliaryHint : option?.label) ??
          (draft ? `${text.missing}: ${route!.provider} / ${route!.model}` : text.inherit)
        const effortTitle =
          draft === 'auxiliary'
            ? text.auxiliaryHint
            : !selected
              ? text.effortHint
              : efforts.length === 0
                ? text.noEfforts
                : effort
                  ? effortLabel
                  : automaticHint
        return (
          <div key={task} className="dsh-model-settings-field" data-task={task} data-auxiliary={auxiliary}>
            {!auxiliary && index === (view?.auxiliary ? 1 : 0) && (
              <h3 className="dsh-model-settings-task-heading">{text.taskSettings}</h3>
            )}
            <SettingsRow
              label={
                <>
                  <div>{title}</div>
                  {!auxiliary &&
                    view!.tasks.filter(
                      (item) => item.owner.packageName === target.owner.packageName && item.key === target.key
                    ).length > 1 && <div className="dsh-model-settings-description">{target.owner.entryId}</div>}
                  <div className="dsh-model-settings-description">{target.description[language]}</div>
                </>
              }
            >
              <div className="dsh-model-settings-controls">
                <SettingsPicker
                  className="dsh-model-settings-picker"
                  id={fieldId}
                  aria-label={`${title} ${text.model}: ${modelTitle}`}
                  value={modelLabel}
                  title={modelTitle}
                  selectedId={draft}
                  items={[
                    ...(auxiliary ? [] : [{ id: 'auxiliary', label: text.useAuxiliary }]),
                    ...(missing
                      ? [
                          ...modelItems,
                          {
                            id: current,
                            label: `${text.missing}: ${route!.provider} / ${route!.model}`,
                            disabled: true,
                          },
                        ]
                      : modelItems),
                  ]}
                  disabled={!!busy || !synchronized}
                  onSelect={(value) => {
                    void save(task, value, value === draft ? effort : '')
                  }}
                />
                <SettingsPicker
                  className="dsh-model-settings-picker"
                  id={`${fieldId}-reasoning`}
                  aria-label={`${title} ${text.effort}: ${effortTitle}`}
                  value={effortLabel}
                  title={effortTitle}
                  selectedId={effort}
                  items={[
                    { id: '', label: automaticHint },
                    ...(missingEffort
                      ? [{ id: effort, label: `${text.missingEffort}: ${effort}`, disabled: true }]
                      : []),
                    ...efforts.map((item) => ({ id: item.id, label: item.name })),
                  ]}
                  disabled={!!busy || !synchronized || !selected || (efforts.length === 0 && !effort)}
                  onSelect={(value) => {
                    void save(task, draft, value)
                  }}
                />
                <button
                  type="button"
                  className="dsh-model-settings-expander"
                  aria-label={`${title} ${text.editInstructions}`}
                  title={text.editInstructions}
                  aria-expanded={!!expanded[task]}
                  aria-controls={`${fieldId}-instructions`}
                  onClick={() => setExpanded((current) => ({ ...current, [task]: !current[task] }))}
                >
                  <IconChevronDownOutlineRegular size={12} aria-hidden="true" />
                </button>
              </div>
            </SettingsRow>
            {expanded[task] && (
              <form
                id={`${fieldId}-instructions`}
                className="dsh-model-settings-instructions"
                aria-label={`${title} ${text.instructions}`}
                onSubmit={(event) => {
                  event.preventDefault()
                  void save(task, draft, effort, instructionDrafts[task])
                }}
              >
                <label htmlFor={`${fieldId}-instructions-input`}>{text.instructions}</label>
                <div id={`${fieldId}-instructions-hint`} className="dsh-model-settings-description">
                  {target.instructionsHint?.[language] ?? text.instructionsHint}
                </div>
                <textarea
                  id={`${fieldId}-instructions-input`}
                  aria-describedby={`${fieldId}-instructions-hint`}
                  rows={10}
                  value={instructionDrafts[task]}
                  disabled={!!busy || !synchronized}
                  onChange={(event) => setInstructionDrafts((current) => ({ ...current, [task]: event.target.value }))}
                />
                <div className="dsh-model-settings-instruction-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={!!busy || !synchronized || instructionDrafts[task].trim() === target.instructions}
                  >
                    {text.save}
                  </Button>
                </div>
              </form>
            )}
            {busy === 'saving' && noticeTask === task && <p role="status">{text.saving}</p>}
            {notice && noticeTask === task && <p role="alert">{text[notice]}</p>}
          </div>
        )
      })}
      {view?.catalogError && <p role="alert">{text.catalog}</p>}
      {notice && (!noticeTask || !snapshots.some((task) => task.id === noticeTask)) && (
        <p role="alert">{text[notice]}</p>
      )}
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.effect(() =>
    installSettingsIcon(
      name,
      Object.values(copy).map((text) => text.nav),
      modelSettingsIconSvg
    )
  )
  ctx.effect(() => installStyles(styles), 'model-settings: styles')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 15,
        label: () => localizedCopy(ctx.locale.getSnapshot().active).nav,
        inject: () => ({ ctx }),
      },
      ModelSettings
    )
  )
}
