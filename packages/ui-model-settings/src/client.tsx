import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button, Menu, IconChevronDownOutlineRegular, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
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
    hint: 'Applies to future titles.',
    model: 'Model',
    worktree: 'Worktree branch name',
    worktreeHint: 'Used when the branch name is left empty.',
    inherit: 'Use conversation model',
    effort: 'Reasoning effort',
    automatic: 'Automatic',
    automaticHint: 'Automatic (lowest supported effort)',
    worktreeAutomaticHint: 'Automatic (model default)',
    effortHint: 'Choose a model to set its reasoning effort. Automatic keeps the existing behavior.',
    noEfforts: 'This model does not offer reasoning effort settings.',
    missingEffort: 'Saved effort (currently unavailable)',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved. The next request for this task will use this selection.',
    refresh: 'Reload settings',
    loading: 'Loading models…',
    unavailable:
      'No supported active title generator was found. Enable one DSH first-prompt or all-prompts title provider.',
    catalog: 'Some model lists could not be loaded. You can still use the conversation model or reload settings.',
    missing: 'Saved model (not in current catalog)',
    error: 'Could not confirm the change. Reload settings to check the saved value before retrying.',
    conflict: 'Settings changed elsewhere. Reload settings before saving again.',
    model_unavailable: 'This model is unavailable. Reload settings and choose an available model.',
    reasoning_unavailable: 'This reasoning effort is unavailable. Choose a supported effort or Automatic.',
  },
  ko: {
    nav: '상황별 모델',
    title: '세션 제목',
    hint: '이후 생성하는 제목에 적용합니다.',
    model: '모델',
    worktree: '워크트리 브랜치 이름',
    worktreeHint: '이름을 비워 자동 생성할 때 사용합니다.',
    inherit: '대화 모델 따르기',
    effort: '추론 수준',
    automatic: '자동',
    automaticHint: '자동 (지원하는 최저 수준)',
    worktreeAutomaticHint: '자동 (모델 기본값)',
    effortHint: '모델을 지정하면 추론 수준을 선택할 수 있습니다. 자동은 기존 동작을 유지합니다.',
    noEfforts: '이 모델은 추론 수준 설정을 제공하지 않습니다.',
    missingEffort: '저장된 추론 수준 (현재 사용할 수 없음)',
    save: '저장',
    saving: '저장 중…',
    saved: '저장했습니다. 이 작업의 다음 모델 요청부터 적용합니다.',
    refresh: '설정 새로고침',
    loading: '모델을 불러오는 중입니다…',
    unavailable:
      '지원하는 제목 생성기가 활성화되어 있지 않습니다. DSH의 first-prompt 또는 all-prompts 제목 생성기를 하나 활성화하세요.',
    catalog: '일부 모델 목록을 불러오지 못했습니다. 대화 모델을 따르거나 설정을 새로고침할 수 있습니다.',
    missing: '저장된 모델 (현재 목록에 없음)',
    error: '변경 여부를 확인하지 못했습니다. 다시 시도하기 전에 설정을 새로고침하여 저장된 값을 확인하세요.',
    conflict: '다른 곳에서 설정을 변경했습니다. 설정을 새로고침한 뒤 다시 저장하세요.',
    model_unavailable: '사용할 수 없는 모델입니다. 설정을 새로고침한 뒤 다른 모델을 선택하세요.',
    reasoning_unavailable: '사용할 수 없는 추론 수준입니다. 지원하는 수준이나 자동을 선택하세요.',
  },
}

const styles = `
.dsh-model-settings { container-type: inline-size; color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-model-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-model-settings-text { flex: 1; min-width: 0; }
.dsh-model-settings-hint { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-model-settings-controls { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 65%; }
.dsh-model-settings-picker { min-width: 0; }
.dsh-model-settings-picker + .dsh-model-settings-picker { flex: none; max-width: 60%; }
.dsh-model-settings-selector { box-sizing: border-box; display: inline-flex; align-items: center; gap: 12px; max-width: 100%; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); color: inherit; font: inherit; cursor: pointer; }
.dsh-model-settings-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-model-settings-selector svg { flex: none; }
.dsh-model-settings-selector:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-model-settings-selector:disabled { opacity: .5; cursor: default; }
.dsh-model-settings-selector:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset: 2px; }
.dsh-model-settings footer { display: flex; gap: 8px; justify-content: flex-end; padding-top: 16px; }
.dsh-model-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); margin: 12px 0; }
.dsh-model-settings [role=status] { margin: 12px 0; }
@container (max-width: 480px) {
  .dsh-model-settings-row { align-items: flex-start; flex-direction: column; gap: 12px; }
  .dsh-model-settings-controls { max-width: 100%; }
}
`

const routeKey = (route: Route | null) => (route ? JSON.stringify([route.provider, route.model]) : '')
type Task = 'target' | 'worktree'

function Picker({
  label,
  value,
  title,
  selectedId,
  items,
  disabled,
  describedBy,
  onSelect,
}: {
  label: string
  value: string
  title: string
  selectedId: string
  items: MenuEntry[]
  disabled: boolean
  describedBy?: string
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      className="dsh-model-settings-picker"
      open={open && !disabled}
      onClose={() => setOpen(false)}
      items={items}
      selectedId={selectedId}
      onSelect={(id) => {
        setOpen(false)
        onSelect(id)
      }}
      align="end"
      portal
      anchor={
        <button
          type="button"
          className="dsh-model-settings-selector"
          aria-label={`${label}: ${title}`}
          aria-describedby={describedBy}
          aria-haspopup="menu"
          aria-expanded={open && !disabled}
          title={title}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <span className="dsh-model-settings-value">{value}</span>
          <IconChevronDownOutlineRegular size={16} />
        </button>
      }
    />
  )
}

function ModelSettings({ ctx }: { ctx: Context }) {
  const locale = useSyncExternalStore(
    (listener) => ctx.locale.subscribe(listener),
    () => ctx.locale.getSnapshot()
  )
  const text = copy[locale.active.startsWith('ko') ? 'ko' : 'en']
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<ModelSettingsView>()
  const [drafts, setDrafts] = useState({ target: '', worktree: '' })
  const [effortDrafts, setEffortDrafts] = useState({ target: '', worktree: '' })
  const [busy, setBusy] = useState(true)
  const [notice, setNotice] = useState<'saved' | 'error' | 'conflict' | 'model_unavailable' | 'reasoning_unavailable'>()
  const [noticeTask, setNoticeTask] = useState<Task>()
  const lock = useRef(false)
  const [lifetime] = useState(() => new AbortController())

  const load = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setNotice(undefined)
    setNoticeTask(undefined)
    try {
      const result = await connection.rpc.call(channel, `${endpointPrefix}describe`, {}, lifetime.signal)
      if (!result.ok) throw new Error('describe failed')
      const next = result.value as unknown as ModelSettingsView
      setView(next)
      setEffortDrafts({ target: next.target?.reasoningEffort ?? '', worktree: next.worktree?.reasoningEffort ?? '' })
      setDrafts({ target: routeKey(next.target?.route ?? null), worktree: routeKey(next.worktree?.route ?? null) })
    } catch {
      if (!lifetime.signal.aborted) setNotice('error')
    } finally {
      lock.current = false
      if (!lifetime.signal.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    void load()
    return () => lifetime.abort()
  }, [])

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

  const save = async (task: Task) => {
    const target = view?.[task]
    const draft = drafts[task]
    const effort = effortDrafts[task]
    const option = options.find((option) => routeKey(option.route) === draft)
    const selected = option?.route ?? null
    const missingEffort = effort !== '' && !option?.efforts.some((item) => item.id === effort)
    if (lock.current || !target || (draft && !selected) || missingEffort) return
    lock.current = true
    setBusy(true)
    setNotice(undefined)
    setNoticeTask(task)
    try {
      const result = await connection.rpc.call(
        channel,
        `${endpointPrefix}save`,
        {
          id: target.id,
          revision: target.revision,
          route: selected,
          reasoningEffort: effort || null,
        },
        lifetime.signal
      )
      if (!result.ok) {
        const code = result.error.code
        setNotice(
          code === 'conflict' || code === 'model_unavailable' || code === 'reasoning_unavailable' ? code : 'error'
        )
        return
      }
      const saved = result.value as unknown as TitleTarget | null
      setView((current) => current && { ...current, [task]: saved })
      setDrafts((current) => ({ ...current, [task]: routeKey(saved?.route ?? null) }))
      setEffortDrafts((current) => ({ ...current, [task]: saved?.reasoningEffort ?? '' }))
      setNotice('saved')
    } catch {
      if (!lifetime.signal.aborted) setNotice('error')
    } finally {
      lock.current = false
      if (!lifetime.signal.aborted) setBusy(false)
    }
  }

  return (
    <section className="dsh-model-settings" aria-label={text.nav}>
      {!view && busy && <p role="status">{text.loading}</p>}
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
        const unchanged = draft === current && effort === (target.reasoningEffort ?? '')
        const automaticHint = task === 'target' ? text.automaticHint : text.worktreeAutomaticHint
        const modelLabel = option?.name ?? (draft ? text.missing : text.inherit)
        const effortLabel =
          efforts.find((item) => item.id === effort)?.name ?? (effort ? text.missingEffort : text.automatic)
        const fieldId = `${id}-${task}`
        return (
          <form
            key={task}
            aria-label={title}
            onSubmit={(event) => {
              event.preventDefault()
              void save(task)
            }}
          >
            <div className="dsh-model-settings-row">
              <div className="dsh-model-settings-text">
                <div>{title}</div>
                <p className="dsh-model-settings-hint" id={`${fieldId}-hint`}>
                  {task === 'target' ? text.hint : text.worktreeHint}
                </p>
              </div>
              <div className="dsh-model-settings-controls">
                <Picker
                  label={`${title} ${text.model}`}
                  value={modelLabel}
                  title={
                    option?.label ??
                    (draft ? `${text.missing}: ${target.route!.provider} / ${target.route!.model}` : text.inherit)
                  }
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
                  disabled={busy}
                  describedBy={`${fieldId}-hint`}
                  onSelect={(value) => {
                    if (value !== draft) {
                      setDrafts((current) => ({ ...current, [task]: value }))
                      setEffortDrafts((current) => ({ ...current, [task]: '' }))
                      setNotice(undefined)
                    }
                  }}
                />
                <Picker
                  label={`${title} ${text.effort}`}
                  value={effortLabel}
                  title={
                    !selected
                      ? text.effortHint
                      : efforts.length === 0
                        ? text.noEfforts
                        : effort
                          ? effortLabel
                          : automaticHint
                  }
                  selectedId={effort}
                  items={[
                    { id: '', label: automaticHint },
                    ...(missingEffort
                      ? [{ id: effort, label: `${text.missingEffort}: ${effort}`, disabled: true }]
                      : []),
                    ...efforts.map((item) => ({ id: item.id, label: item.name })),
                  ]}
                  disabled={busy || !selected || (efforts.length === 0 && !effort)}
                  onSelect={(value) => {
                    setEffortDrafts((current) => ({ ...current, [task]: value }))
                    setNotice(undefined)
                  }}
                />
                <Button
                  type="submit"
                  variant="primary"
                  disabled={busy || unchanged || (!!draft && !selected) || missingEffort}
                >
                  {busy && noticeTask === task ? text.saving : text.save}
                </Button>
              </div>
            </div>
            {notice && noticeTask === task && <p role={notice === 'saved' ? 'status' : 'alert'}>{text[notice]}</p>}
          </form>
        )
      })}
      {view?.catalogError && <p role="alert">{text.catalog}</p>}
      {notice && (!view || !noticeTask) && <p role="alert">{text[notice]}</p>}
      <footer>
        <Button
          type="button"
          aria-label={text.refresh}
          disabled={busy}
          onClick={() => {
            void load()
          }}
        >
          {text.refresh}
        </Button>
      </footer>
    </section>
  )
}

export function apply(ctx: Context) {
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
        label: () => copy[ctx.locale.getSnapshot().active.startsWith('ko') ? 'ko' : 'en'].nav,
        inject: () => ({ ctx }),
      },
      ModelSettings
    )
  )
}
