import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { channel, endpointPrefix, type ModelSettingsView, type Route, type TitleTarget } from './protocol.js'

export const name = 'dungsil-model-settings'
export const inject = ['connection', 'locale', 'slots']

const copy = {
  en: {
    nav: 'Models by task',
    description: 'Choose a model for each task without changing the conversation model.',
    title: 'Session title',
    hint: 'Applies to future title generation across this profile. Existing titles and conversation models stay unchanged.',
    inherit: 'Use conversation model',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved. The next title request will use this selection.',
    refresh: 'Reload settings',
    loading: 'Loading models…',
    unavailable:
      'No supported active title generator was found. Enable one DSH first-prompt or all-prompts title provider.',
    catalog: 'Some model lists could not be loaded. You can still use the conversation model or reload settings.',
    missing: 'Saved model (not in current catalog)',
    error: 'Could not confirm the change. Reload settings to check the saved value before retrying.',
    conflict: 'Settings changed elsewhere. Reload settings before saving again.',
    model_unavailable: 'This model is unavailable. Reload settings and choose an available model.',
  },
  ko: {
    nav: '상황별 모델',
    description: '대화 모델을 바꾸지 않고 상황별로 사용할 모델을 지정합니다.',
    title: '세션 제목',
    hint: '이 프로필에서 이후 생성하는 제목에 적용합니다. 기존 제목과 대화 모델은 바뀌지 않습니다.',
    inherit: '대화 모델 따르기',
    save: '저장',
    saving: '저장 중…',
    saved: '저장했습니다. 다음 제목 생성부터 적용합니다.',
    refresh: '설정 새로고침',
    loading: '모델을 불러오는 중입니다…',
    unavailable:
      '지원하는 제목 생성기가 활성화되어 있지 않습니다. DSH의 first-prompt 또는 all-prompts 제목 생성기를 하나 활성화하세요.',
    catalog: '일부 모델 목록을 불러오지 못했습니다. 대화 모델을 따르거나 설정을 새로고침할 수 있습니다.',
    missing: '저장된 모델 (현재 목록에 없음)',
    error: '변경 여부를 확인하지 못했습니다. 다시 시도하기 전에 설정을 새로고침하여 저장된 값을 확인하세요.',
    conflict: '다른 곳에서 설정을 변경했습니다. 설정을 새로고침한 뒤 다시 저장하세요.',
    model_unavailable: '사용할 수 없는 모델입니다. 설정을 새로고침한 뒤 다른 모델을 선택하세요.',
  },
}

const styles = `
.dsh-model-settings { max-width: 680px; color: var(--dsw-alias-label-primary, #222); font: 14px/1.6 var(--dsw-font-family, system-ui); }
.dsh-model-settings h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.dsh-model-settings p { margin: 0 0 24px; color: var(--dsw-alias-label-secondary, #666); }
.dsh-model-settings label { display: block; margin-bottom: 8px; font-weight: 600; }
.dsh-model-settings select { box-sizing: border-box; width: 100%; min-height: 40px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #fff); color: inherit; font: inherit; }
.dsh-model-settings small { display: block; margin: 8px 0 24px; color: var(--dsw-alias-label-secondary, #666); font-size: 13px; }
.dsh-model-settings footer { display: flex; gap: 8px; justify-content: flex-end; }
.dsh-model-settings button { min-height: 36px; padding: 6px 14px; border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: 8px; color: inherit; background: transparent; font: inherit; cursor: pointer; }
.dsh-model-settings button[type=submit] { color: var(--dsw-alias-label-primary-foreground, #fff); background: var(--dsw-alias-button-primary-fill, #222); border-color: transparent; }
.dsh-model-settings button:hover:not(:disabled) { filter: brightness(.85); }
.dsh-model-settings :disabled { opacity: .5; cursor: default; }
.dsh-model-settings :focus-visible { outline: 2px solid #5677ee; outline-offset: 3px; }
.dsh-model-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); margin: 12px 0; }
.dsh-model-settings [role=status] { margin: 12px 0; }
`

const routeKey = (route: Route | null) => (route ? JSON.stringify([route.provider, route.model]) : '')

function ModelSettings({ ctx }: { ctx: Context }) {
  const locale = useSyncExternalStore(
    (listener) => ctx.locale.subscribe(listener),
    () => ctx.locale.getSnapshot()
  )
  const text = copy[locale.active.startsWith('ko') ? 'ko' : 'en']
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<ModelSettingsView>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(true)
  const [notice, setNotice] = useState<'saved' | 'error' | 'conflict' | 'model_unavailable'>()
  const lock = useRef(false)
  const [lifetime] = useState(() => new AbortController())

  const load = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      const result = await connection.rpc.call(channel, `${endpointPrefix}describe`, {}, lifetime.signal)
      if (!result.ok) throw new Error('describe failed')
      const next = result.value as unknown as ModelSettingsView
      setView(next)
      setDraft(routeKey(next.target?.route ?? null))
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
      }))
    ) ?? []
  const current = routeKey(view?.target?.route ?? null)
  const missing = current !== '' && !options.some((option) => routeKey(option.route) === current)
  const selected = options.find((option) => routeKey(option.route) === draft)?.route ?? null

  const save = async () => {
    if (lock.current || !view?.target || (draft && !selected)) return
    lock.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      const result = await connection.rpc.call(
        channel,
        `${endpointPrefix}save`,
        {
          id: view.target.id,
          revision: view.target.revision,
          route: selected,
        },
        lifetime.signal
      )
      if (!result.ok) {
        const code = result.error.code
        setNotice(code === 'conflict' || code === 'model_unavailable' ? code : 'error')
        return
      }
      const target = result.value as unknown as TitleTarget | null
      setView({ ...view, target })
      setDraft(routeKey(target?.route ?? null))
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
      <h2>{text.nav}</h2>
      <p>{text.description}</p>
      {!view && busy && <p role="status">{text.loading}</p>}
      {view && !view.target && <p role="status">{text.unavailable}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {view?.target && (
          <>
            <label htmlFor={id}>{text.title}</label>
            <select
              id={id}
              value={draft}
              disabled={busy}
              aria-describedby={`${id}-hint`}
              onChange={(event) => {
                setDraft(event.target.value)
                setNotice(undefined)
              }}
            >
              <option value="">{text.inherit}</option>
              {missing && (
                <option value={current} disabled>
                  {text.missing}: {view.target.route!.provider} / {view.target.route!.model}
                </option>
              )}
              {options.map((option) => (
                <option key={routeKey(option.route)} value={routeKey(option.route)}>
                  {option.label}
                </option>
              ))}
            </select>
            <small id={`${id}-hint`}>{text.hint}</small>
            {view.catalogError && <p role="alert">{text.catalog}</p>}
          </>
        )}
        {notice && <p role={notice === 'saved' ? 'status' : 'alert'}>{text[notice]}</p>}
        <footer>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void load()
            }}
          >
            {text.refresh}
          </button>
          {view?.target && (
            <button type="submit" disabled={busy || draft === current || (!!draft && !selected)}>
              {busy ? text.saving : text.save}
            </button>
          )}
        </footer>
      </form>
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
