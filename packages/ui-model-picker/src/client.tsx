import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
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
    const subscribe = useCallback((listener: () => void) => directory.store.subscribe(listener), [directory])
    const getSnapshot = useCallback(() => directory.store.getSnapshot(), [directory])
    const state = useSyncExternalStore(subscribe, getSnapshot)
    const { active: locale } = useLocaleSnapshot(ctx.locale)
    const text = copy[locale.startsWith('ko') ? 'ko' : locale.startsWith('zh') ? 'zh' : 'en']
    const [requestedPanel, setPanel] = useState<'model' | 'effort' | null>(null)
    // A model chosen from the list while its reasoning effort is still unset.
    // It is staged only inside the popover; the selection changes when the
    // effort is committed, so the real model never changes first.
    const [staged, setStaged] = useState<{ provider: string; model: string } | null>(null)
    const [draft, setDraft] = useState(0)
    const [failed, setFailed] = useState(false)
    const trigger = useRef<HTMLButtonElement | null>(null)
    const anchor = useRef<HTMLDivElement>(null)
    const popup = useRef<HTMLDivElement>(null)
    const pending = useRef(false)
    const sliderSelection = useRef<ModelSelection | null>(null)
    const mounted = useRef(true)
    const id = useId()
    const current = state.current
    const group = state.groups.find((item) => item.id === current?.provider)
    const model = group?.models.find((item) => item.id === current?.model)
    const reasoning = model?.reasoning
    const efforts = reasoning?.efforts ?? []
    // The popover renders the staged model when the list queued one; otherwise
    // it renders the committed selection.
    const stagedGroup = staged ? state.groups.find((item) => item.id === staged.provider) : undefined
    const stagedModel = staged ? stagedGroup?.models.find((item) => item.id === staged.model) : model
    const stagedReasoning = stagedModel?.reasoning
    const stagedEfforts = stagedReasoning?.efforts ?? []
    const panel = requestedPanel === 'effort' && !stagedEfforts.length ? 'model' : requestedPanel
    const effective = current?.reasoningEffort ?? reasoning?.defaultEffort
    const effortIndex = efforts.findIndex((item) => item.id === effective)
    const effortLabel = efforts.length ? (efforts[effortIndex]?.name ?? state.retainedEffort) : undefined
    const stagedName = stagedModel?.name ?? (staged ? staged.model : current?.model) ?? text.model
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
      sliderSelection.current = null
      setPanel(null)
      setStaged(null)
      if (trigger.current) focusWithoutRing(trigger.current)
    }

    useDismissOnOutsidePointer(
      anchor,
      panel !== null,
      () => {
        sliderSelection.current = null
        setPanel(null)
        setStaged(null)
      },
      popup
    )

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
      if (locked) {
        sliderSelection.current = null
        setPanel(null)
        setStaged(null)
      }
    }, [locked])
    // Keep the slider mounted for its own committed selection, including when
    // the shared projection arrives after the RPC response. External changes
    // still discard the draft so it cannot be applied to another selection.
    useEffect(() => {
      const selection = sliderSelection.current
      sliderSelection.current = null
      if (
        selection &&
        current?.provider === selection.provider &&
        current?.model === selection.model &&
        current?.reasoningEffort === selection.reasoningEffort
      ) {
        setStaged(null)
        return
      }
      setPanel(null)
      setStaged(null)
    }, [current?.provider, current?.model, current?.reasoningEffort])

    const select = async (selection: ModelSelection, keepSlider = false) => {
      if (disabled || pending.current) return
      pending.current = true
      sliderSelection.current = keepSlider ? selection : null
      setFailed(false)
      try {
        const result = await directory.select(selection)
        if (!mounted.current) return
        if (result.ok) {
          if (!keepSlider) close()
        } else {
          sliderSelection.current = null
          setFailed(true)
        }
      } catch {
        sliderSelection.current = null
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
      setStaged(null)
      setDraft(Math.max(0, effortIndex))
      setFailed(false)
      setPanel('effort')
      void directory.load().catch(() => {})
    }
    const selectEffort = (index: number) => {
      const target = staged ?? (current ? { provider: current.provider, model: current.model } : null)
      const effort = stagedEfforts[index]
      if (!target || !effort) return
      void select(
        {
          provider: target.provider,
          model: target.model,
          reasoningEffort: effort.id,
        },
        true
      )
    }
    // A model picked from the list is staged only while its effort is unset.
    // A model without a choice of efforts keeps applying immediately; the rest
    // apply together with the effort chosen on the slider.
    const stageModel = (provider: string, option: ModelCatalogModel) => {
      const same = provider === current?.provider && option.id === current?.model
      const optionReasoning = option.reasoning
      const optionEfforts = optionReasoning?.efforts ?? []
      if (optionEfforts.length < 2) {
        if (same) {
          close()
          return
        }
        const effort = optionReasoning?.defaultEffort
        void select({
          provider,
          model: option.id,
          ...(effort === undefined ? {} : { reasoningEffort: effort }),
        })
        return
      }
      // The slider has no provider-default stop, so start from this model's
      // declared default or, failing that, the effort already in use.
      const preferredEffort = same
        ? (current?.reasoningEffort ?? optionReasoning?.defaultEffort)
        : (optionReasoning?.defaultEffort ?? current?.reasoningEffort)
      setStaged({ provider, model: option.id })
      setDraft(
        Math.max(
          0,
          optionEfforts.findIndex((item) => item.id === preferredEffort)
        )
      )
      setFailed(false)
      setPanel('effort')
    }

    return (
      <>
        <div className="dsh-codex-picker" ref={anchor} aria-busy={busy}>
          <ComposerTrigger
            className="dsh-codex-trigger"
            icon={<IconDataOutlineRegular size={16} />}
            label={model?.name ?? current?.model ?? text.model}
            detail={effortLabel}
            disabled={locked}
            aria-disabled={disabled}
            aria-label={`${efforts.length ? text.choose : text.model}: ${model?.name ?? current?.model ?? text.model}${effortLabel ? `, ${effortLabel}` : ''}`}
            title={`${model?.name ?? current?.model ?? text.model}${effortLabel ? ` ${effortLabel}` : ''}`}
            aria-haspopup="dialog"
            aria-expanded={panel !== null}
            aria-controls={panel ? id : undefined}
            onClick={(event) => {
              if (!disabled) show(event.currentTarget)
            }}
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
                stagedEfforts.length > 0 && (
                  <button type="button" className="dsh-codex-back" onClick={() => setPanel('effort')}>
                    <IconChevronLeftOutlineRegular size={14} /> {text.effort}
                  </button>
                )
              ) : (
                <header className="dsh-codex-header">
                  <button
                    type="button"
                    className="dsh-codex-model"
                    disabled={locked}
                    aria-disabled={disabled}
                    aria-label={`${text.model}: ${stagedName}`}
                    onClick={() => {
                      if (!disabled) setPanel('model')
                    }}
                  >
                    <strong>{stagedEfforts[draft]?.name}</strong>
                    <span>
                      {stagedName} <IconChevronRightOutlineRegular size={14} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="dsh-codex-reset"
                    disabled={locked || !(staged ?? current)}
                    aria-disabled={disabled || !(staged ?? current)}
                    aria-label={text.reset}
                    title={text.reset}
                    onClick={() => {
                      const target = staged ?? (current ? { provider: current.provider, model: current.model } : null)
                      if (target) void select(target)
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
                <p className={panel === 'effort' ? 'dsh-codex-status' : 'dsh-codex-notice'} role="status">
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
                            onClick={() => stageModel(provider.id, option)}
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
                stagedEfforts.length > 0 && (
                  <div className="dsh-codex-slider">
                    <div
                      className="dsh-codex-rail"
                      style={
                        {
                          '--dsh-codex-progress': `${stagedEfforts.length > 1 ? (draft / (stagedEfforts.length - 1)) * 100 : 0}%`,
                        } as React.CSSProperties
                      }
                    >
                      <div className="dsh-codex-track" aria-hidden="true">
                        {stagedEfforts.map((effort, index) => (
                          <span key={effort.id} data-filled={index <= draft} />
                        ))}
                      </div>
                      <input
                        id={`${id}-effort`}
                        type="range"
                        min={0}
                        max={stagedEfforts.length - 1}
                        step={1}
                        value={draft}
                        disabled={locked || stagedEfforts.length < 2}
                        aria-disabled={disabled || stagedEfforts.length < 2}
                        aria-label={text.effort}
                        aria-valuetext={stagedEfforts[draft]?.name}
                        onChange={(event) => {
                          if (!disabled) setDraft(Number(event.target.value))
                        }}
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
