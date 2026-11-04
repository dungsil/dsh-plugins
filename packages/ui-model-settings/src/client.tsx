import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { installSettingsIcon, SettingsPicker, SettingsRow, settingsStyles } from '@dungsil/dsh-ui'
import {
  channel,
  endpointPrefix,
  type ModelSettingsView,
  type Route,
  type TitleTarget,
} from '@dungsil/dsh-plugin-model-settings/protocol'

export const name = 'dungsil-ui-model-settings'
export const inject = ['connection', 'locale', 'slots']

const copy = {
  en: {
    nav: 'Models by task',
    title: 'Session title',
    titleDescription: 'Choose the model and reasoning effort used to automatically generate session titles.',
    model: 'Model',
    worktree: 'Worktree branch name',
    worktreeDescription:
      'Choose the model and reasoning effort used to generate a branch name when creating a worktree without a name.',
    inherit: 'Use conversation model',
    effort: 'Reasoning effort',
    automatic: 'Automatic',
    automaticHint: 'Automatic (lowest supported effort)',
    worktreeAutomaticHint: 'Automatic (model default)',
    effortHint: 'Choose a model to set its reasoning effort. Automatic keeps the existing behavior.',
    noEfforts: 'This model does not offer reasoning effort settings.',
    missingEffort: 'Saved effort (currently unavailable)',
    saving: 'Saving…',
    loading: 'Loading models…',
    resyncing: 'Checking saved settings…',
    loadError: 'Could not load settings. Close and reopen this settings section to try again.',
    resyncError:
      'Could not check saved settings. Changes are disabled. Close and reopen this settings section to try again.',
    unavailable:
      'No supported active title generator was found. Enable one DSH first-prompt or all-prompts title provider.',
    catalog: 'Some model lists could not be loaded. You can still use the conversation model.',
    missing: 'Saved model (not in current catalog)',
    error: 'Could not confirm the change. The change will not be retried automatically.',
    conflict: 'Settings changed elsewhere. Your change will not be retried automatically.',
    model_unavailable: 'This model is unavailable. Choose an available model after the settings check.',
    reasoning_unavailable: 'This reasoning effort is unavailable. Choose a supported effort or Automatic.',
  },
  ko: {
    nav: '상황별 모델',
    title: '세션 제목',
    titleDescription: '세션 제목을 자동으로 생성할 때 사용할 모델과 추론 수준을 설정합니다.',
    model: '모델',
    worktree: '워크트리 브랜치 이름',
    worktreeDescription: '이름을 입력하지 않고 워크트리를 만들 때 브랜치 이름을 생성할 모델과 추론 수준을 설정합니다.',
    inherit: '대화 모델 따르기',
    effort: '추론 수준',
    automatic: '자동',
    automaticHint: '자동 (지원하는 최저 수준)',
    worktreeAutomaticHint: '자동 (모델 기본값)',
    effortHint: '모델을 지정하면 추론 수준을 선택할 수 있습니다. 자동은 기존 동작을 유지합니다.',
    noEfforts: '이 모델은 추론 수준 설정을 제공하지 않습니다.',
    missingEffort: '저장된 추론 수준 (현재 사용할 수 없음)',
    saving: '저장 중…',
    loading: '모델을 불러오는 중입니다…',
    resyncing: '저장된 설정을 확인하는 중입니다…',
    loadError: '설정을 불러오지 못했습니다. 이 설정 항목을 닫았다가 다시 열어 주세요.',
    resyncError: '저장된 설정을 확인하지 못해 변경을 잠갔습니다. 이 설정 항목을 닫았다가 다시 열어 주세요.',
    unavailable:
      '지원하는 제목 생성기가 활성화되어 있지 않습니다. DSH의 first-prompt 또는 all-prompts 제목 생성기를 하나 활성화하세요.',
    catalog: '일부 모델 목록을 불러오지 못했습니다. 대화 모델은 계속 따를 수 있습니다.',
    missing: '저장된 모델 (현재 목록에 없음)',
    error: '변경 여부를 확인하지 못했습니다. 변경 사항은 자동으로 다시 저장하지 않습니다.',
    conflict: '다른 곳에서 설정을 변경했습니다. 선택한 값은 자동으로 다시 저장하지 않습니다.',
    model_unavailable: '사용할 수 없는 모델입니다. 설정 확인이 끝나면 다른 모델을 선택하세요.',
    reasoning_unavailable: '사용할 수 없는 추론 수준입니다. 지원하는 수준이나 자동을 선택하세요.',
  },
  zh: {
    nav: '任务模型设置',
    title: '会话标题',
    titleDescription: '设置自动生成会话标题时使用的模型和推理级别。',
    model: '模型',
    worktree: '工作树分支名称',
    worktreeDescription: '设置创建未指定名称的工作树时用于生成分支名称的模型和推理级别。',
    inherit: '使用对话模型',
    effort: '推理级别',
    automatic: '自动',
    automaticHint: '自动（支持的最低级别）',
    worktreeAutomaticHint: '自动（模型默认值）',
    effortHint: '指定模型后可选择推理级别。自动选项保留现有行为。',
    noEfforts: '此模型不提供推理级别设置。',
    missingEffort: '已保存的推理级别（当前不可用）',
    saving: '正在保存…',
    loading: '正在加载模型…',
    resyncing: '正在检查已保存的设置…',
    loadError: '无法加载设置。请关闭并重新打开此设置项后重试。',
    resyncError: '无法确认已保存的设置，已禁止更改。请关闭并重新打开此设置项后重试。',
    unavailable: '未找到已启用且受支持的标题生成器。请启用一个 DSH first-prompt 或 all-prompts 标题提供程序。',
    catalog: '部分模型列表无法加载。仍可使用对话模型。',
    missing: '已保存的模型（不在当前列表中）',
    error: '无法确认更改是否生效。不会自动重新保存此更改。',
    conflict: '设置已在其他位置更改。不会自动重新保存您选择的值。',
    model_unavailable: '此模型不可用。请在设置检查完成后选择可用模型。',
    reasoning_unavailable: '此推理级别不可用。请选择支持的级别或自动选项。',
  },
}

const localizedCopy = (language: string) =>
  copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']

const styles = `${settingsStyles}
.dsh-model-settings { container-type: inline-size; color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-model-settings-description { margin-top: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; }
.dsh-model-settings-controls { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 65%; }
.dsh-model-settings-picker + .dsh-model-settings-picker { flex: none; max-width: 60%; }
.dsh-model-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); margin: 12px 0; }
.dsh-model-settings [role=status] { margin: 12px 0; }
@container (max-width: 480px) {
  .dsh-model-settings .dsh-plugin-settings-row { align-items: flex-start; flex-direction: column; gap: 12px; }
  .dsh-model-settings-controls { max-width: 100%; }
}
`

const routeKey = (route: Route | null) => (route ? JSON.stringify([route.provider, route.model]) : '')
type Task = 'target' | 'worktree'
type Notice = 'error' | 'conflict' | 'model_unavailable' | 'reasoning_unavailable'

function ModelSettings({ ctx }: { ctx: Context }) {
  const locale = useSyncExternalStore(
    (listener) => ctx.locale.subscribe(listener),
    () => ctx.locale.getSnapshot()
  )
  const text = localizedCopy(locale.active)
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<ModelSettingsView>()
  const [drafts, setDrafts] = useState({ target: '', worktree: '' })
  const [effortDrafts, setEffortDrafts] = useState({ target: '', worktree: '' })
  const [busy, setBusy] = useState<'loading' | 'saving' | 'resyncing' | undefined>('loading')
  const [synchronized, setSynchronized] = useState(false)
  const [notice, setNotice] = useState<Notice>()
  const [noticeTask, setNoticeTask] = useState<Task>()
  const [readError, setReadError] = useState<'loadError' | 'resyncError'>()
  const lock = useRef(true)
  const lifetime = useRef<AbortController>()

  const read = useCallback(
    async (controller: AbortController) => {
      const result = await connection.rpc.call(channel, `${endpointPrefix}describe`, {}, controller.signal)
      if (controller.signal.aborted || lifetime.current !== controller) return false
      if (!result.ok) throw new Error('describe failed')
      const next = result.value as unknown as ModelSettingsView
      setView(next)
      setEffortDrafts({ target: next.target?.reasoningEffort ?? '', worktree: next.worktree?.reasoningEffort ?? '' })
      setDrafts({ target: routeKey(next.target?.route ?? null), worktree: routeKey(next.worktree?.route ?? null) })
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

  const save = async (task: Task, draft: string, effort: string) => {
    const controller = lifetime.current
    const target = view?.[task]
    const option = options.find((option) => routeKey(option.route) === draft)
    const selected = option?.route ?? null
    const missingEffort = effort !== '' && !option?.efforts.some((item) => item.id === effort)
    if (
      lock.current ||
      !controller ||
      controller.signal.aborted ||
      !target ||
      !synchronized ||
      (draft === routeKey(target.route) && effort === (target.reasoningEffort ?? '')) ||
      (draft && !selected) ||
      missingEffort
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
      const result = await connection.rpc.call(
        channel,
        `${endpointPrefix}save`,
        { id: target.id, revision: target.revision, route: selected, reasoningEffort: effort || null },
        controller.signal
      )
      if (!active()) return
      if (result.ok) {
        const saved = result.value as unknown as TitleTarget | null
        setView((current) => current && { ...current, [task]: saved })
        setDrafts((current) => ({ ...current, [task]: routeKey(saved?.route ?? null) }))
        setEffortDrafts((current) => ({ ...current, [task]: saved?.reasoningEffort ?? '' }))
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
      {view && !view.target && <p role="status">{text.unavailable}</p>}
      {(['target', 'worktree'] as const).map((task) => {
        const target = view?.[task]
        if (!target) return null
        const title = task === 'target' ? text.title : text.worktree
        const draft = drafts[task]
        const effort = effortDrafts[task]
        const current = routeKey(target.route)
        const missing = current !== '' && !options.some((option) => routeKey(option.route) === current)
        const option = options.find((option) => routeKey(option.route) === draft)
        const selected = option?.route ?? null
        const efforts = option?.efforts ?? []
        const missingEffort = effort !== '' && !efforts.some((item) => item.id === effort)
        const automaticHint = task === 'target' ? text.automaticHint : text.worktreeAutomaticHint
        const modelLabel = option?.name ?? (draft ? text.missing : text.inherit)
        const effortLabel =
          efforts.find((item) => item.id === effort)?.name ?? (effort ? text.missingEffort : text.automatic)
        const fieldId = `${id}-${task}`
        const modelTitle =
          option?.label ??
          (draft ? `${text.missing}: ${target.route!.provider} / ${target.route!.model}` : text.inherit)
        const effortTitle = !selected
          ? text.effortHint
          : efforts.length === 0
            ? text.noEfforts
            : effort
              ? effortLabel
              : automaticHint
        return (
          <div key={task} className="dsh-model-settings-field">
            <SettingsRow
              label={
                <>
                  <div>{title}</div>
                  <div className="dsh-model-settings-description">
                    {task === 'target' ? text.titleDescription : text.worktreeDescription}
                  </div>
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
                  items={
                    missing
                      ? [
                          ...modelItems,
                          {
                            id: current,
                            label: `${text.missing}: ${target.route!.provider} / ${target.route!.model}`,
                            disabled: true,
                          },
                        ]
                      : modelItems
                  }
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
              </div>
            </SettingsRow>
            {busy === 'saving' && noticeTask === task && <p role="status">{text.saving}</p>}
            {notice && noticeTask === task && <p role="alert">{text[notice]}</p>}
          </div>
        )
      })}
      {view?.catalogError && <p role="alert">{text.catalog}</p>}
      {notice && (!noticeTask || !view?.[noticeTask]) && <p role="alert">{text[notice]}</p>}
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.effect(() =>
    installSettingsIcon(
      name,
      Object.values(copy).map((text) => text.nav),
      '<circle cx="2.5" cy="8" r="1.75"/><path d="M4.25 8H5.5C8 8 7 3.5 10 3.5H11M5.5 8C8 8 7 12.5 10 12.5H11"/><rect x="11" y="1.75" width="3.5" height="3.5" rx=".6"/><rect x="11" y="10.75" width="3.5" height="3.5" rx=".6"/>'
    )
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'model-settings: styles')
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
