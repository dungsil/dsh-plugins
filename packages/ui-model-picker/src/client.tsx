import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ShortcutBinding, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
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
import {
  Input,
  MenuSurface,
  Tooltip,
  focusWithoutRing,
  isMobileDevice,
  rankByName,
  useDismissOnOutsidePointer,
} from '@dungsil/dsh-ui'
import { styles } from './styles.js'
import { registerRetention } from './retention.js'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import ja from '../locale/ja.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import de from '../locale/de.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }

export const name = 'dungsil-ui-model-picker'
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.session', 'modelDirectories', 'shortcuts']

const copy = {
  ja: ja.ui,
  es: es.ui,
  fr: fr.ui,
  de: de.ui,
  ru: ru.ui,
  pt: pt.ui,
  ko: ko.ui,
  en: en.ui,
  zh: zh.ui,
}

const localizedCopy = (language: string) => {
  const base = language.toLowerCase().split(/[-_]/)[0]!
  return copy[Object.hasOwn(copy, base) ? (base as keyof typeof copy) : 'en']
}

export function apply(ctx: Context) {
  registerRetention(ctx)
  const commandId = 'dungsil.model-picker.open' as ShortcutCommandId
  const pickers = new Map<HTMLDivElement, { disabled: boolean; open: () => void }>()
  const binding: ShortcutBinding = { code: 'KeyP', modifiers: ['alt'] }
  const shortcutCatalog = ctx.shortcuts.runtime === 'web' ? ctx.shortcuts.fixedCatalog : ctx.shortcuts.catalog
  ctx.effect(() => {
    const label = () => {
      const locale = ctx.locale.getSnapshot().active
      return localizedCopy(locale).openPicker
    }
    const resolve = () => {
      const visible = [...pickers].filter(([element]) => element.isConnected && element.getClientRects().length > 0)
      if (visible.length !== 1) return { status: 'pass' } as const
      const [, picker] = visible[0]!
      if (picker.disabled) return { status: 'blocked', reason: 'Model picker is locked or busy' } as const
      return { status: 'handled', run: picker.open } as const
    }
    if (ctx.shortcuts.runtime === 'web') {
      const unregister = ctx.shortcuts.registerFixed({
        id: commandId,
        label,
        keys: ['Alt', 'P'],
        bindings: [binding],
        group: 'input',
      })
      const unobserve = ctx.shortcuts.observeFixedInput((input) => {
        if (input.type !== 'keydown') return
        const { gesture, context } = input
        if (
          context.modal ||
          context.region === 'terminal' ||
          gesture.code !== 'KeyP' ||
          gesture.secondCode ||
          !gesture.alt ||
          gesture.control ||
          gesture.meta ||
          gesture.shift ||
          gesture.repeat ||
          gesture.composing ||
          gesture.defaultPrevented
        )
          return
        const action = resolve()
        if (action.status === 'pass') return
        input.consume()
        if (action.status === 'handled') action.run()
      })
      return () => {
        unobserve()
        unregister()
      }
    }
    return ctx.shortcuts.register({
      id: commandId,
      label,
      aliases: ['model', 'reasoning', '모델', '추론', '模型'],
      defaults: {
        'desktop:windows': binding,
        'desktop:macos': binding,
        'desktop:linux': binding,
      },
      regions: ['page', 'editable'],
      modals: [],
      resolve,
    })
  }, 'ui-model-picker: shortcut')

  function Picker({
    locked,
    directory,
  }: Pick<PropsRuntime<'conversation.input.model'>, 'locked'> & { directory: ModelDirectory }) {
    const subscribe = useCallback((listener: () => void) => directory.store.subscribe(listener), [directory])
    const getSnapshot = useCallback(() => directory.store.getSnapshot(), [directory])
    const state = useSyncExternalStore(subscribe, getSnapshot)
    const subscribeShortcuts = useCallback(
      (listener: () => void) => shortcutCatalog.subscribe(listener),
      [shortcutCatalog]
    )
    const shortcutKeys = useSyncExternalStore(subscribeShortcuts, () => shortcutCatalog.getSnapshot()).find(
      (entry) => entry.id === commandId
    )?.keys
    const { active: locale } = useLocaleSnapshot(ctx.locale)
    const text = localizedCopy(locale)
    const [requestedPanel, setPanel] = useState<'model' | 'effort' | null>(null)
    // A model chosen from the list while its reasoning effort is still unset.
    // It is staged only inside the popover; the selection changes when the
    // effort is committed, so the real model never changes first.
    const [staged, setStaged] = useState<{ provider: string; model: string } | null>(null)
    const [draft, setDraft] = useState(0)
    const [query, setQuery] = useState('')
    const [highlighted, setHighlighted] = useState<number | null>(null)
    const gesture = useRef<{ kind: 'pointer' | 'keyboard'; start: number; pointerId?: number } | null>(null)
    const draftRef = useRef(0)
    const returnToModelButton = useRef(false)
    const focusPanel = useRef<string | null>(null)
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
    const orderedGroups = [...state.groups].sort((a, b) => {
      const priority = (id: string) => (id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2)
      return priority(a.id) - priority(b.id)
    })
    const showSearch = state.groups.reduce((count, provider) => count + provider.models.length, 0) > 4
    const filteredGroups = orderedGroups
      .map((provider) => ({
        ...provider,
        models: rankByName(provider.models, showSearch ? query.trim() : ''),
      }))
      .filter((provider) => provider.models.length > 0)
    const visibleModels = filteredGroups.flatMap((provider) =>
      provider.models.map((option) => ({ provider: provider.id, option }))
    )
    const selectedVisible = visibleModels.findIndex(
      ({ provider, option }) => provider === current?.provider && option.id === current?.model
    )
    const activeIndex = Math.min(highlighted ?? Math.max(0, selectedVisible), visibleModels.length - 1)
    const setSliderDraft = (value: number) => {
      draftRef.current = value
      setDraft(value)
    }
    const cancelGesture = () => {
      if (!gesture.current) return
      setSliderDraft(gesture.current.start)
      gesture.current = null
    }
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
      gesture.current = null
      sliderSelection.current = null
      setPanel(null)
      setStaged(null)
      if (trigger.current) focusWithoutRing(trigger.current)
    }

    const restorePopupFocus = () => {
      if (!popup.current?.contains(document.activeElement)) return
      const target = trigger.current?.disabled
        ? anchor.current?.parentElement?.querySelector<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
          )
        : trigger.current
      if (target) focusWithoutRing(target)
    }

    useDismissOnOutsidePointer(
      anchor,
      panel !== null,
      () => {
        gesture.current = null
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
        if (!element.contains(event.target as Node)) position()
      }
      window.addEventListener('resize', close)
      window.addEventListener('scroll', scroll, true)
      const keydown = (event: KeyboardEvent) => {
        if (
          event.defaultPrevented ||
          event.isComposing ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          (event.shiftKey && event.key !== 'Tab')
        )
          return
        if (event.key === 'Escape' || (event.key === 'Tab' && event.shiftKey)) {
          event.preventDefault()
          cancelGesture()
          if (panel === 'model' && stagedEfforts.length) {
            returnToModelButton.current = true
            setPanel('effort')
          } else close()
          return
        }
        if (
          panel === 'model' &&
          event.key === 'ArrowLeft' &&
          stagedEfforts.length &&
          (!(event.target instanceof HTMLInputElement) || event.target.value === '')
        ) {
          event.preventDefault()
          returnToModelButton.current = true
          setPanel('effort')
          return
        }
        if (
          panel === 'effort' &&
          event.key === 'ArrowRight' &&
          event.target === element.querySelector('.dsh-codex-model')
        ) {
          event.preventDefault()
          setQuery('')
          setHighlighted(null)
          setPanel('model')
          return
        }
        if (panel === 'model' && showSearch && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          if (!disabled && visibleModels.length) {
            setHighlighted(
              (activeIndex + (event.key === 'ArrowUp' ? -1 : 1) + visibleModels.length) % visibleModels.length
            )
            element.querySelector<HTMLInputElement>('[role=searchbox]')?.focus()
          }
          return
        }
        if (
          panel === 'model' &&
          event.target instanceof HTMLInputElement &&
          event.target.type !== 'range' &&
          (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) &&
          activeIndex >= 0
        ) {
          event.preventDefault()
          const choice = visibleModels[activeIndex]
          if (!disabled && choice) stageModel(choice.provider, choice.option)
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
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', close)
        window.removeEventListener('scroll', scroll, true)
        element.removeEventListener('keydown', keydown)
      }
    }, [panel, showSearch, query, highlighted, state.groups, current, stagedEfforts.length, disabled])

    useLayoutEffect(() => {
      const element = popup.current
      if (!panel || !element) {
        focusPanel.current = null
        return
      }
      const changedPanel = focusPanel.current !== panel
      focusPanel.current = panel
      if (!changedPanel && !element.contains(document.activeElement) && document.activeElement !== trigger.current)
        return
      if (panel === 'model' && isMobileDevice()) {
        trigger.current?.focus()
        returnToModelButton.current = false
        return
      }
      const focusable =
        (returnToModelButton.current ? element.querySelector<HTMLElement>('.dsh-codex-model:not(:disabled)') : null) ??
        element.querySelector<HTMLElement>('[role=searchbox]:not(:disabled)') ??
        element.querySelector<HTMLElement>('[aria-current=true]') ??
        element.querySelector<HTMLElement>('input:not(:disabled)') ??
        element.querySelector<HTMLElement>('button:not(:disabled)')
      returnToModelButton.current = false
      focusable?.focus()
    }, [panel, showSearch])

    const visibleIdentity = visibleModels.map(({ provider, option }) => JSON.stringify([provider, option.id])).join(',')
    useLayoutEffect(() => {
      if (panel !== 'model' || !showSearch || activeIndex < 0) return
      document.getElementById(id + '-model-' + activeIndex)?.scrollIntoView?.({ block: 'nearest' })
    }, [panel, showSearch, activeIndex, visibleIdentity, id])

    useEffect(() => {
      if (!panel) return
      window.addEventListener('blur', cancelGesture)
      return () => window.removeEventListener('blur', cancelGesture)
    }, [panel])

    useEffect(() => {
      if (locked) {
        gesture.current = null
        restorePopupFocus()
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
      gesture.current = null
      restorePopupFocus()
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
      setQuery('')
      setHighlighted(null)
      setSliderDraft(Math.max(0, effortIndex))
      setFailed(false)
      setPanel('effort')
      void directory.load().catch(() => {})
    }
    useLayoutEffect(() => {
      const element = anchor.current
      if (!element) return
      pickers.set(element, {
        disabled,
        open: () => {
          if (trigger.current) show(trigger.current)
        },
      })
      return () => {
        pickers.delete(element)
      }
    })

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
      setSliderDraft(
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
          <Tooltip label={efforts.length ? text.configure : text.model} shortcutKeys={shortcutKeys} side="top" portal>
            <ComposerTrigger
              ref={trigger}
              className="dsh-codex-trigger"
              icon={<IconDataOutlineRegular size={16} />}
              label={model?.name ?? current?.model ?? text.model}
              detail={effortLabel}
              disabled={locked}
              aria-disabled={disabled}
              aria-label={`${efforts.length ? text.choose : text.model}: ${model?.name ?? current?.model ?? text.model}${effortLabel ? `, ${effortLabel}` : ''}`}
              aria-haspopup="dialog"
              aria-expanded={panel !== null}
              aria-controls={panel ? id : undefined}
              onClick={(event) => {
                if (!disabled) show(event.currentTarget)
              }}
              onKeyDown={(event) => {
                if (
                  !panel &&
                  !disabled &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                ) {
                  event.preventDefault()
                  show(event.currentTarget)
                }
              }}
            />
          </Tooltip>
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
                  <button
                    type="button"
                    className="dsh-codex-model"
                    disabled={locked}
                    aria-disabled={disabled}
                    title={stagedName}
                    onClick={() => {
                      if (!disabled) {
                        setQuery('')
                        setHighlighted(null)
                        setPanel('model')
                      }
                    }}
                  >
                    <strong>{stagedEfforts[draft]?.name}</strong>
                    <span>
                      {stagedName} <IconChevronRightOutlineRegular size={14} />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="dsh-codex-apply"
                    disabled={locked}
                    aria-disabled={disabled}
                    onClick={() => selectEffort(draft)}
                  >
                    {text.apply}
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
                  {showSearch && (
                    <Input
                      type="text"
                      role="searchbox"
                      className="dsh-codex-search"
                      aria-label={text.search}
                      placeholder={text.search}
                      value={query}
                      readOnly={busy}
                      aria-controls={id + '-models'}
                      aria-activedescendant={activeIndex < 0 ? undefined : id + '-model-' + activeIndex}
                      onChange={(event) => {
                        setQuery(event.target.value)
                        setHighlighted(0)
                      }}
                    />
                  )}
                  <div id={id + '-models'} className="dsh-codex-models" role="listbox" aria-label={text.model}>
                    {filteredGroups.map((provider) => (
                      <section key={provider.id} role="group" aria-label={provider.name}>
                        <div className="dsh-codex-provider" aria-hidden="true">
                          {provider.name}
                        </div>
                        {provider.models.map((option) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={provider.id === current?.provider && option.id === current?.model}
                            aria-current={
                              provider.id === current?.provider && option.id === current?.model ? 'true' : undefined
                            }
                            className="dsh-codex-option"
                            id={
                              id +
                              '-model-' +
                              visibleModels.findIndex(
                                (item) => item.provider === provider.id && item.option.id === option.id
                              )
                            }
                            data-search-option={showSearch ? '' : undefined}
                            data-highlighted={
                              showSearch &&
                              visibleModels[activeIndex]?.provider === provider.id &&
                              visibleModels[activeIndex]?.option.id === option.id
                                ? ''
                                : undefined
                            }
                            key={option.id}
                            disabled={disabled}
                            tabIndex={showSearch ? -1 : undefined}
                            onMouseMove={() => {
                              if (showSearch)
                                setHighlighted(
                                  visibleModels.findIndex(
                                    (item) => item.provider === provider.id && item.option.id === option.id
                                  )
                                )
                            }}
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
                  {state.status !== 'loading' && visibleModels.length === 0 && (
                    <p className="dsh-codex-notice" role="status">
                      {state.groups.some((provider) => provider.models.length) ? text.searchEmpty : text.empty}
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
                          if (!disabled) setSliderDraft(Number(event.target.value))
                        }}
                        onPointerDown={(event) => {
                          if (disabled) return
                          gesture.current = { kind: 'pointer', start: draftRef.current, pointerId: event.pointerId }
                          event.currentTarget.setPointerCapture?.(event.pointerId)
                        }}
                        onPointerUp={(event) => {
                          if (gesture.current?.kind !== 'pointer' || gesture.current.pointerId !== event.pointerId)
                            return
                          gesture.current = null
                          selectEffort(draftRef.current)
                        }}
                        onPointerCancel={(event) => {
                          if (gesture.current?.kind === 'pointer' && gesture.current.pointerId === event.pointerId)
                            cancelGesture()
                        }}
                        onLostPointerCapture={(event) => {
                          if (gesture.current?.kind === 'pointer' && gesture.current.pointerId === event.pointerId)
                            cancelGesture()
                        }}
                        onBlur={cancelGesture}
                        onKeyDown={(event) => {
                          if (
                            !event.nativeEvent.isComposing &&
                            (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) &&
                            [
                              'ArrowLeft',
                              'ArrowRight',
                              'ArrowUp',
                              'ArrowDown',
                              'Home',
                              'End',
                              'PageUp',
                              'PageDown',
                            ].includes(event.key)
                          ) {
                            event.preventDefault()
                            if (gesture.current?.kind === 'keyboard') cancelGesture()
                            return
                          }
                          if (
                            event.defaultPrevented ||
                            event.nativeEvent.isComposing ||
                            event.altKey ||
                            event.ctrlKey ||
                            event.metaKey ||
                            event.shiftKey
                          )
                            return
                          if (event.key === 'Escape') cancelGesture()
                          else if (
                            !disabled &&
                            [
                              'ArrowLeft',
                              'ArrowRight',
                              'ArrowUp',
                              'ArrowDown',
                              'Home',
                              'End',
                              'PageUp',
                              'PageDown',
                            ].includes(event.key) &&
                            !gesture.current
                          ) {
                            gesture.current = { kind: 'keyboard', start: draftRef.current }
                          }
                        }}
                        onKeyUp={(event) => {
                          if (
                            event.defaultPrevented ||
                            event.nativeEvent.isComposing ||
                            event.altKey ||
                            event.ctrlKey ||
                            event.metaKey ||
                            event.shiftKey
                          ) {
                            if (gesture.current?.kind === 'keyboard') cancelGesture()
                            return
                          }
                          if (
                            [
                              'ArrowLeft',
                              'ArrowRight',
                              'ArrowUp',
                              'ArrowDown',
                              'Home',
                              'End',
                              'PageUp',
                              'PageDown',
                            ].includes(event.key)
                          ) {
                            if (gesture.current?.kind !== 'keyboard') return
                            gesture.current = null
                            selectEffort(draftRef.current)
                          }
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
