import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
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
    description:
      'Choose a model for each task without changing the conversation model. Changes are saved automatically.',
    title: 'Session title',
    hint: 'Applies to future title generation across this profile. Existing titles and conversation models stay unchanged.',
    worktree: 'Worktree branch name',
    worktreeHint:
      'Used only when Git Worktree UI generates a branch name from an empty name. Does not change the conversation model.',
    inherit: 'Use conversation model',
    saving: 'Saving…',
    saved: 'Saved. The next request for this task will use this selection.',
    loading: 'Loading models…',
    resyncing: 'Checking saved settings…',
    resynced: 'Saved settings are now shown.',
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
  },
  ko: {
    nav: '상황별 모델',
    description: '대화 모델을 바꾸지 않고 상황별로 사용할 모델을 지정합니다. 변경 사항은 자동으로 저장합니다.',
    title: '세션 제목',
    hint: '이 프로필에서 이후 생성하는 제목에 적용합니다. 기존 제목과 대화 모델은 바뀌지 않습니다.',
    worktree: '워크트리 브랜치 이름',
    worktreeHint:
      'Git Worktree UI에서 이름을 비워 브랜치 이름을 자동 생성할 때만 사용합니다. 대화 모델은 바뀌지 않습니다.',
    inherit: '대화 모델 따르기',
    saving: '저장 중…',
    saved: '저장했습니다. 이 작업의 다음 모델 요청부터 적용합니다.',
    loading: '모델을 불러오는 중입니다…',
    resyncing: '저장된 설정을 확인하는 중입니다…',
    resynced: '저장된 설정을 다시 불러왔습니다.',
    loadError: '설정을 불러오지 못했습니다. 이 설정 항목을 닫았다가 다시 열어 주세요.',
    resyncError: '저장된 설정을 확인하지 못해 변경을 잠갔습니다. 이 설정 항목을 닫았다가 다시 열어 주세요.',
    unavailable:
      '지원하는 제목 생성기가 활성화되어 있지 않습니다. DSH의 first-prompt 또는 all-prompts 제목 생성기를 하나 활성화하세요.',
    catalog: '일부 모델 목록을 불러오지 못했습니다. 대화 모델은 계속 따를 수 있습니다.',
    missing: '저장된 모델 (현재 목록에 없음)',
    error: '변경 여부를 확인하지 못했습니다. 변경 사항은 자동으로 다시 저장하지 않습니다.',
    conflict: '다른 곳에서 설정을 변경했습니다. 선택한 값은 자동으로 다시 저장하지 않습니다.',
    model_unavailable: '사용할 수 없는 모델입니다. 설정 확인이 끝나면 다른 모델을 선택하세요.',
  },
}

const styles = `
.dsh-model-settings { max-width: 680px; color: var(--dsw-alias-label-primary, #222); font: 14px/1.6 var(--dsw-font-family, system-ui); }
.dsh-model-settings h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.dsh-model-settings p { margin: 0 0 24px; color: var(--dsw-alias-label-secondary, #666); }
.dsh-model-settings label { display: block; margin-bottom: 8px; font-weight: 600; }
.dsh-model-settings select { box-sizing: border-box; width: 100%; min-height: 40px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; font: inherit; }
.dsh-model-settings small { display: block; margin: 8px 0 24px; color: var(--dsw-alias-label-secondary, #666); font-size: 13px; }
.dsh-model-settings-field { margin-bottom: 24px; }
.dsh-model-settings :disabled { opacity: .5; cursor: default; }
.dsh-model-settings :focus-visible { outline: 2px solid #5677ee; outline-offset: 3px; }
.dsh-model-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); margin: 12px 0; }
.dsh-model-settings [role=status] { margin: 12px 0; }
`

const routeKey = (route: Route | null) => (route ? JSON.stringify([route.provider, route.model]) : '')
type Task = 'target' | 'worktree'
type Notice = 'saved' | 'error' | 'conflict' | 'model_unavailable'

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
      }))
    ) ?? []

  const save = async (task: Task, draft: string) => {
    const controller = lifetime.current
    const target = view?.[task]
    const selected = options.find((option) => routeKey(option.route) === draft)?.route ?? null
    if (
      lock.current ||
      !controller ||
      controller.signal.aborted ||
      !target ||
      !synchronized ||
      draft === routeKey(target.route) ||
      (draft && !selected)
    )
      return
    lock.current = true
    setBusy('saving')
    setDrafts((current) => ({ ...current, [task]: draft }))
    setNotice(undefined)
    setNoticeTask(task)
    setReadError(undefined)
    const active = () => !controller.signal.aborted && lifetime.current === controller
    let failure: Exclude<Notice, 'saved'> | undefined
    try {
      const result = await connection.rpc.call(
        channel,
        `${endpointPrefix}save`,
        { id: target.id, revision: target.revision, route: selected },
        controller.signal
      )
      if (!active()) return
      if (result.ok) {
        const saved = result.value as unknown as TitleTarget | null
        setView((current) => current && { ...current, [task]: saved })
        setDrafts((current) => ({ ...current, [task]: routeKey(saved?.route ?? null) }))
        setNotice('saved')
      } else {
        const code = result.error.code
        failure = code === 'conflict' || code === 'model_unavailable' ? code : 'error'
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
      <h2>{text.nav}</h2>
      <p>{text.description}</p>
      {busy === 'loading' && <p role="status">{text.loading}</p>}
      {busy === 'resyncing' && <p role="status">{text.resyncing}</p>}
      {notice && notice !== 'saved' && synchronized && !busy && <p role="status">{text.resynced}</p>}
      {readError && <p role="alert">{text[readError]}</p>}
      {view && !view.target && <p role="status">{text.unavailable}</p>}
      {(['target', 'worktree'] as const).map((task) => {
        const target = view?.[task]
        if (!target) return null
        const draft = drafts[task]
        const current = routeKey(target.route)
        const missing = current !== '' && !options.some((option) => routeKey(option.route) === current)
        const fieldId = `${id}-${task}`
        return (
          <div key={task} className="dsh-model-settings-field">
            <label htmlFor={fieldId}>{task === 'target' ? text.title : text.worktree}</label>
            <select
              id={fieldId}
              value={draft}
              disabled={!!busy || !synchronized}
              aria-describedby={`${fieldId}-hint`}
              onChange={(event) => {
                void save(task, event.target.value)
              }}
            >
              <option value="">{text.inherit}</option>
              {missing && (
                <option value={current} disabled>
                  {text.missing}: {target.route!.provider} / {target.route!.model}
                </option>
              )}
              {options.map((option) => (
                <option key={routeKey(option.route)} value={routeKey(option.route)}>
                  {option.label}
                </option>
              ))}
            </select>
            <small id={`${fieldId}-hint`}>{task === 'target' ? text.hint : text.worktreeHint}</small>
            {busy === 'saving' && noticeTask === task && <p role="status">{text.saving}</p>}
            {notice && noticeTask === task && <p role={notice === 'saved' ? 'status' : 'alert'}>{text[notice]}</p>}
          </div>
        )
      })}
      {view?.catalogError && <p role="alert">{text.catalog}</p>}
      {notice && (!noticeTask || !view?.[noticeTask]) && (
        <p role={notice === 'saved' ? 'status' : 'alert'}>{text[notice]}</p>
      )}
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
