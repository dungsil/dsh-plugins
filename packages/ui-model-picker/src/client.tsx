import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
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
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { ComposerTrigger } from '@dungsil/dsh-ui/composer'
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCheckOutlineRegular,
  IconDataOutlineRegular,
  IconResetOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import { MenuSurface, focusWithoutRing, useDismissOnOutsidePointer } from '@dungsil/dsh-ui'
import { styles } from './styles.js'

export const name = 'dungsil-ui-model-picker'
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.session', 'modelDirectories']

const copy = {
  ko: {
    model: '모델 선택',
    effort: '추론 강도',
    choose: '추론 수준 선택',
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
    choose: 'Select reasoning effort',
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
  zh: {
    model: '选择模型',
    effort: '推理强度',
    choose: '选择推理级别',
    default: '提供商默认值',
    reset: '重置为默认值',
    loading: '正在加载模型…',
    empty: '没有可用的模型。',
    partial: '部分提供商的模型加载失败。',
    missing: '当前模型不可用。',
    error: '更改失败。请确认当前选择后重试。',
    retry: '刷新模型列表',
    busy: '正在更改…',
  },
}

export function apply(ctx: Context) {
  function Picker({
    locked,
    directory,
  }: Pick<PropsRuntime<'conversation.input.model'>, 'locked'> & { directory: ModelDirectory }) {
    const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
    const { active: locale } = useLocaleSnapshot(ctx.locale)
    const text = copy[locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en']
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
      if (trigger.current) focusWithoutRing(trigger.current)
    }

    useDismissOnOutsidePointer(anchor, panel !== null, () => setPanel(null), popup)

    useLayoutEffect(() => {
      if (!panel || !popup.current || !anchor.current) return
      const element = popup.current
      const position = () => {
        const box = anchor.current!.getBoundingClientRect()
        element.style.left = `${Math.max(8, Math.min(box.right - element.offsetWidth, window.innerWidth - element.offsetWidth - 8))}px`
        const above = box.top - element.offsetHeight - 8
        element.style.top = `${Math.max(8, above >= 8 ? above : Math.min(box.bottom + 8, window.innerHeight - element.offsetHeight - 8))}px`
      }
      position()
      const observer = new ResizeObserver(position)
      observer.observe(element)
      const scroll = (event: Event) => {
        if (!element.contains(event.target as Node)) close()
      }
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
      const focusable =
        element.querySelector<HTMLElement>('[aria-checked=true]') ??
        element.querySelector<HTMLElement>('input:not(:disabled)') ??
        element.querySelector<HTMLElement>('button:not(:disabled)')
      focusable?.focus()
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', close)
        window.removeEventListener('scroll', scroll, true)
        element.removeEventListener('keydown', keydown)
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
    const show = (button: HTMLButtonElement) => {
      trigger.current = button
      if (panel) {
        close()
        return
      }
      setDraft(Math.max(0, effortIndex))
      setFailed(false)
      setPanel('effort')
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
          <ComposerTrigger
            className="dsh-codex-trigger"
            icon={<IconDataOutlineRegular size={16} />}
            label={model?.name ?? current?.model ?? text.model}
            detail={effortLabel}
            disabled={disabled}
            aria-label={`${text.choose}: ${model?.name ?? current?.model ?? text.model}${effortLabel ? `, ${effortLabel}` : ''}`}
            title={`${model?.name ?? current?.model ?? text.model}${effortLabel ? ` ${effortLabel}` : ''}`}
            aria-haspopup="dialog"
            aria-expanded={panel !== null}
            aria-controls={panel ? id : undefined}
            onClick={(event) => show(event.currentTarget)}
          />
        </div>
        {panel &&
          createPortal(
            <MenuSurface
              id={id}
              ref={popup}
              role="dialog"
              aria-label={panel === 'model' ? text.model : text.effort}
              className="dsh-codex-popover"
            >
              {panel === 'model' ? (
                <button type="button" className="dsh-codex-back" onClick={() => setPanel('effort')}>
                  <IconChevronLeftOutlineRegular size={14} /> {text.effort}
                </button>
              ) : (
                <header className="dsh-codex-header">
                  <button
                    type="button"
                    className="dsh-codex-model"
                    disabled={disabled}
                    aria-label={`${text.model}: ${model?.name ?? current?.model ?? text.model}`}
                    onClick={() => setPanel('model')}
                  >
                    <strong>{efforts[draft]?.name ?? effortLabel ?? text.default}</strong>
                    <span>
                      {model?.name ?? current?.model ?? text.model} <IconChevronRightOutlineRegular size={14} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="dsh-codex-reset"
                    disabled={disabled || !current}
                    aria-label={text.reset}
                    title={text.reset}
                    onClick={() => {
                      if (current) void select({ provider: current.provider, model: current.model })
                    }}
                  >
                    <IconResetOutlineRegular />
                  </button>
                </header>
              )}
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
                              {provider.id === current?.provider && option.id === current?.model && (
                                <IconCheckOutlineRegular size={14} />
                              )}
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
                    <div
                      className="dsh-codex-rail"
                      style={
                        {
                          '--dsh-codex-progress': `${efforts.length > 1 ? (draft / (efforts.length - 1)) * 100 : 0}%`,
                        } as React.CSSProperties
                      }
                    >
                      <div className="dsh-codex-track" aria-hidden="true">
                        {efforts.map((effort, index) => (
                          <span key={effort.id ?? 'default'} data-filled={index <= draft} />
                        ))}
                      </div>
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
                    </div>
                  </div>
                )
              )}
            </MenuSurface>,
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
        !props.useSession((state) => state.subagent) ? (
          <Picker
            key={props.sessionId}
            locked={props.locked}
            directory={ctx.modelDirectories.directoryFor(props.sessionId)}
          />
        ) : null
    )
  )
  ctx.effect(() => installStyles(styles), 'ui-model-picker: styles')
}
