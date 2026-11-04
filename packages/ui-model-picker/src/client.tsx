import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { styles } from './styles.js'

export const name = 'dungsil-ui-model-picker'
export const inject = ['slots', 'locale', 'sessions', 'modelDirectories']

const copy = {
  ko: {
    model: '모델 선택',
    effort: '추론 강도',
    default: '제공자 기본값',
    reset: '기본값으로 재설정',
    loading: '모델을 불러오는 중입니다…',
    empty: '사용할 수 있는 모델이 없습니다.',
    partial: '일부 제공자의 모델을 불러오지 못했습니다.',
    missing: '현재 모델을 사용할 수 없습니다.',
    error: '변경하지 못했습니다. 현재 선택을 확인한 뒤 다시 시도하세요.',
    retry: '모델 목록 새로고침',
    busy: '변경 중…',
  },
  en: {
    model: 'Select model',
    effort: 'Reasoning effort',
    default: 'Provider default',
    reset: 'Reset to default',
    loading: 'Loading models…',
    empty: 'No models available.',
    partial: 'Some providers could not be loaded.',
    missing: 'The current model is unavailable.',
    error: 'Could not change the selection. Check the current selection before retrying.',
    retry: 'Reload models',
    busy: 'Changing…',
  },
}

export function apply(ctx: Context) {
  function Picker({
    locked,
    directory,
  }: Pick<PropsRuntime<'conversation.input.model'>, 'locked'> & { directory: ModelDirectory }) {
    const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
    const locale = useSyncExternalStore(
      (fn) => ctx.locale.subscribe(fn),
      () => ctx.locale.getSnapshot().active
    )
    const text = copy[locale.startsWith('ko') ? 'ko' : 'en']
    const [panel, setPanel] = useState<'model' | 'effort' | null>(null)
    const [draft, setDraft] = useState(0)
    const [failed, setFailed] = useState(false)
    const trigger = useRef<HTMLButtonElement | null>(null)
    const anchor = useRef<HTMLDivElement>(null)
    const popup = useRef<HTMLDivElement>(null)
    const pending = useRef(false)
    const mounted = useRef(true)
    const id = useId()
    const current = state.current
    const group = state.groups.find((item) => item.id === current?.provider)
    const model = group?.models.find((item) => item.id === current?.model)
    const reasoning = model?.reasoning
    const efforts = reasoning?.efforts.length
      ? [
          ...(reasoning.defaultEffort === undefined ? [{ id: undefined, name: text.default }] : []),
          ...reasoning.efforts,
        ]
      : []
    const effective = current?.reasoningEffort ?? reasoning?.defaultEffort
    const effortIndex = efforts.findIndex((item) => item.id === effective)
    const effortLabel = efforts[effortIndex]?.name ?? state.retainedEffort
    const busy = state.status === 'selecting'
    const disabled = locked || busy

    useEffect(() => {
      mounted.current = true
      void directory.load().catch(() => {})
      return () => {
        mounted.current = false
      }
    }, [directory])

    const close = () => {
      setPanel(null)
      trigger.current?.focus()
    }

    useEffect(() => {
      if (!panel || !popup.current || !anchor.current) return
      const element = popup.current
      element.setAttribute('popover', 'auto')
      element.showPopover()
      const position = () => {
        const box = anchor.current!.getBoundingClientRect()
        element.style.left = `${Math.max(8, Math.min(box.right - element.offsetWidth, window.innerWidth - element.offsetWidth - 8))}px`
        const above = box.top - element.offsetHeight - 8
        element.style.top = `${Math.max(8, above >= 8 ? above : Math.min(box.bottom + 8, window.innerHeight - element.offsetHeight - 8))}px`
      }
      position()
      const observer = new ResizeObserver(position)
      observer.observe(element)
      const toggle = (event: Event) => {
        if ((event as ToggleEvent).newState === 'closed') setPanel(null)
      }
      const scroll = (event: Event) => {
        if (!element.contains(event.target as Node)) close()
      }
      element.addEventListener('toggle', toggle)
      window.addEventListener('resize', close)
      window.addEventListener('scroll', scroll, true)
      const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close()
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target instanceof HTMLInputElement)
          return
        const buttons = [...element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        if (!buttons.length) return
        event.preventDefault()
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
        ]?.focus()
      }
      element.addEventListener('keydown', keydown)
      const focusable = element.querySelector<HTMLElement>('[aria-checked=true], input, button')
      focusable?.focus()
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', close)
        window.removeEventListener('scroll', scroll, true)
        element.removeEventListener('keydown', keydown)
        element.removeEventListener('toggle', toggle)
        element.hidePopover()
      }
    }, [panel])

    useEffect(() => {
      if (locked) setPanel(null)
    }, [locked])
    // /model and other clients share this selection. Never apply an old slider
    // draft to a newly projected route or effort.
    useEffect(() => {
      setPanel(null)
    }, [current?.provider, current?.model, current?.reasoningEffort])

    const select = async (selection: ModelSelection) => {
      if (disabled || pending.current) return
      pending.current = true
      setFailed(false)
      try {
        const result = await directory.select(selection)
        if (!mounted.current) return
        if (result.ok) close()
        else setFailed(true)
      } catch {
        if (mounted.current) setFailed(true)
      } finally {
        pending.current = false
      }
    }
    const show = (next: 'model' | 'effort', button: HTMLButtonElement) => {
      trigger.current = button
      setDraft(Math.max(0, effortIndex))
      setFailed(false)
      setPanel(panel === next ? null : next)
      void directory.load().catch(() => {})
    }
    const selectEffort = (index: number) => {
      if (!current || !efforts[index]) return
      const effort = efforts[index].id
      void select({
        provider: current.provider,
        model: current.model,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      })
    }

    return (
      <>
        <div className="dsh-codex-picker" ref={anchor} aria-busy={busy}>
          <button
            type="button"
            className="dsh-codex-model"
            disabled={disabled}
            aria-label={`${text.model}: ${model?.name ?? current?.model ?? text.model}`}
            aria-haspopup="dialog"
            aria-expanded={panel === 'model'}
            aria-controls={panel === 'model' ? id : undefined}
            onClick={(event) => show('model', event.currentTarget)}
          >
            <span className="dsh-codex-icon" aria-hidden="true">
              ϟ
            </span>
            <span className="dsh-codex-name">{model?.name ?? current?.model ?? text.model}</span>
            {!efforts.length && <span aria-hidden="true">⌄</span>}
          </button>
          {efforts.length > 0 && (
            <button
              type="button"
              className="dsh-codex-effort"
              disabled={disabled}
              aria-label={`${text.effort}: ${effortLabel ?? text.default}`}
              aria-haspopup="dialog"
              aria-expanded={panel === 'effort'}
              aria-controls={panel === 'effort' ? id : undefined}
              onClick={(event) => show('effort', event.currentTarget)}
            >
              {effortLabel ?? text.default} <span aria-hidden="true">⌄</span>
            </button>
          )}
        </div>
        {panel &&
          createPortal(
            <div
              id={id}
              ref={popup}
              role="dialog"
              aria-label={panel === 'model' ? text.model : text.effort}
              className="dsh-codex-popover"
            >
              <h2>{panel === 'model' ? text.model : text.effort}</h2>
              {state.status === 'loading' && (
                <p className="dsh-codex-notice" role="status">
                  {text.loading}
                </p>
              )}
              {busy && (
                <p className="dsh-codex-notice" role="status">
                  {text.busy}
                </p>
              )}
              {(failed || state.error) && (
                <p className="dsh-codex-notice" role="alert">
                  {text.error}
                </p>
              )}
              {state.failures.length > 0 && (
                <p className="dsh-codex-notice" role="status">
                  {text.partial}
                </p>
              )}
              {state.routable === false && (
                <p className="dsh-codex-notice" role="status">
                  {text.missing}
                </p>
              )}
              {panel === 'model' ? (
                <>
                  <div role="radiogroup" aria-label={text.model}>
                    {state.groups.map((provider) => (
                      <section key={provider.id} aria-label={provider.name}>
                        <div className="dsh-codex-provider">{provider.name}</div>
                        {provider.models.map((option) => (
                          <button
                            type="button"
                            role="radio"
                            aria-checked={provider.id === current?.provider && option.id === current?.model}
                            className="dsh-codex-option"
                            key={option.id}
                            disabled={disabled}
                            onClick={() => {
                              const same = provider.id === current?.provider && option.id === current?.model
                              const effort = same ? current.reasoningEffort : option.reasoning?.defaultEffort
                              void select({
                                provider: provider.id,
                                model: option.id,
                                ...(effort === undefined ? {} : { reasoningEffort: effort }),
                              })
                            }}
                          >
                            <span>
                              {option.name}
                              {option.description && <small>{option.description}</small>}
                            </span>
                            <span className="dsh-codex-check" aria-hidden="true">
                              {provider.id === current?.provider && option.id === current?.model ? '✓' : ''}
                            </span>
                          </button>
                        ))}
                      </section>
                    ))}
                  </div>
                  {state.status !== 'loading' && !state.groups.some((provider) => provider.models.length) && (
                    <p className="dsh-codex-notice" role="status">
                      {text.empty}
                    </p>
                  )}
                  {efforts.length > 0 && (
                    <button
                      type="button"
                      className="dsh-codex-option"
                      disabled={disabled}
                      onClick={() => {
                        setDraft(Math.max(0, effortIndex))
                        setPanel('effort')
                      }}
                    >
                      <span>{text.effort}</span>
                      <span>{effortLabel ?? text.default} ›</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="dsh-codex-option"
                    disabled={busy}
                    onClick={() => {
                      setFailed(false)
                      void directory.load().catch(() => {})
                    }}
                  >
                    {text.retry}
                  </button>
                </>
              ) : (
                efforts.length > 0 && (
                  <div className="dsh-codex-slider">
                    <label htmlFor={`${id}-effort`}>{efforts[draft]?.name ?? effortLabel}</label>
                    <p>{model?.name}</p>
                    <input
                      id={`${id}-effort`}
                      type="range"
                      min={0}
                      max={efforts.length - 1}
                      step={1}
                      value={draft}
                      disabled={disabled || efforts.length < 2}
                      aria-label={text.effort}
                      aria-valuetext={efforts[draft]?.name}
                      onChange={(event) => setDraft(Number(event.target.value))}
                      onPointerUp={(event) => selectEffort(Number(event.currentTarget.value))}
                      onKeyUp={(event) => {
                        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
                          selectEffort(Number(event.currentTarget.value))
                      }}
                    />
                    <footer>
                      <span>{efforts[0]?.name}</span>
                      <span>{efforts.at(-1)?.name}</span>
                    </footer>
                    <button
                      type="button"
                      className="dsh-codex-option"
                      disabled={disabled}
                      onClick={() => {
                        if (current) void select({ provider: current.provider, model: current.model })
                      }}
                    >
                      {text.reset} ↺
                    </button>
                  </div>
                )
              )}
            </div>,
            document.body
          )}
      </>
    )
  }

  ctx.slots.inject('conversation.input.model', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.model',
        priority: -100,
      },
      (props) =>
        ctx.sessions.subagentAddress(props.sessionId) === undefined ? (
          <Picker
            key={props.sessionId}
            locked={props.locked}
            directory={ctx.modelDirectories.directoryFor(props.sessionId)}
          />
        ) : null
    )
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'ui-model-picker: styles')
}
