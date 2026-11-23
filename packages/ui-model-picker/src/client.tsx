import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ShortcutBinding, ShortcutCommand, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { IconCheckOutlineRegular, IconChevronRightOutlineRegular, IconStarOutlineRegular } from '@dungsil/dsh-ui/icons'
import { styles } from './styles.js'
import { registerRetention } from './retention.js'
import { availableFavorite, createFavoriteStore, nextFavorite, sameFavorite } from './favorites.js'
import { transition } from './interaction.js'
import type { Action, Interaction } from './interaction.js'
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

const FAVORITES_PANE = 'dungsil-model-favorites'
const sliderKeys = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])
// The rows the official menu walks with the arrow keys, plus this plugin's slider.
const menuRows =
  'button[role="menuitem"]:not([disabled]), button[role="menuitemradio"]:not([disabled]), button[role="switch"]:not([disabled]), input.dsh-effort-input:not(:disabled)'

interface EffortChoice {
  key: string
  effort?: string
  label: string
}

interface MenuControls {
  locked: boolean
  dismiss: () => void
  reportFailure: (message: string) => void
  /** Absent before DSH 0.2.3, which has no plugin detail panes. */
  openPane?: (pane: { key: string; title: string }) => void
}

type SessionKey = Parameters<Context['modelDirectories']['directoryFor']>[0]

const isBusy = (state: ReturnType<ModelDirectory['store']['getSnapshot']>) =>
  state.status === 'selecting' || (state.pending ?? null) !== null

export function apply(ctx: Context) {
  registerRetention(ctx)
  const commandId = 'dungsil.model-picker.open' as ShortcutCommandId
  const cycleId = 'dungsil.model-picker.cycle-favorites' as ShortcutCommandId
  const favorites = createFavoriteStore(() => window.localStorage)
  const binding: ShortcutBinding = { code: 'KeyP', modifiers: ['alt'] }
  const cycleBinding: ShortcutBinding = { code: 'KeyP', modifiers: ['alt', 'shift'] }
  const text = () => localizedCopy(copy, ctx.locale.getSnapshot().active)

  // Each composer registers a marker inside its card; shortcuts act on the
  // official model trigger of the composer that holds the input focus.
  const targets = new Map<HTMLElement, ModelDirectory>()
  const cardOf = (element: HTMLElement) => element.closest('[data-composer-card]')
  const triggerOf = (element: HTMLElement) =>
    cardOf(element)?.querySelector<HTMLButtonElement>(
      '[data-slot="conversation.input.model"] button[aria-haspopup="menu"]'
    ) ?? null
  const pickerFor = (target: Element | null) => {
    const visible = [...targets].filter(([element]) => {
      const card = cardOf(element)
      return element.isConnected && card !== null && card.getClientRects().length > 0
    })
    if (visible.length < 2) return visible[0]
    if (!target) return undefined
    return visible.find(([element]) => {
      if (cardOf(element)?.contains(target)) return true
      const menu = triggerOf(element)?.getAttribute('aria-controls')
      return menu ? (document.getElementById(menu)?.contains(target) ?? false) : false
    })
  }
  const targetOf = (context?: { target: Element | null }) => context?.target ?? document.activeElement
  ctx.effect(() => {
    const resolve = (context?: { target: Element | null }) => {
      const picker = pickerFor(targetOf(context))
      const trigger = picker && triggerOf(picker[0])
      if (!picker || !trigger) return { status: 'pass' } as const
      if (trigger.disabled || isBusy(picker[1].store.getSnapshot()))
        return { status: 'blocked', reason: 'Model picker is locked or busy' } as const
      return { status: 'handled', run: () => trigger.click() } as const
    }
    const cycle: ShortcutCommand = {
      id: cycleId,
      label: () => text().cycleFavorites,
      aliases: ['favorite', 'model', '즐겨찾기', '모델', '收藏', '模型'],
      // Web admits no Alt+Shift default, so Web users bind it in shortcut settings.
      defaults: {
        'desktop:windows': cycleBinding,
        'desktop:macos': cycleBinding,
        'desktop:linux': cycleBinding,
      },
      regions: ['page', 'editable'],
      modals: [],
      resolve(context) {
        const picker = pickerFor(targetOf(context))
        if (!picker) return { status: 'pass' }
        const [element, directory] = picker
        const snapshot = directory.store.getSnapshot()
        if (triggerOf(element)?.disabled !== false || isBusy(snapshot))
          return { status: 'blocked', reason: 'Model picker is locked or busy' }
        const next = nextFavorite(favorites.getSnapshot(), snapshot.groups, snapshot.current)
        if (!next) return { status: 'blocked', reason: 'Fewer than two available favorites' }
        return { status: 'handled', run: () => void directory.select(next).catch(() => {}) }
      },
    }
    const registerCycle = () => {
      try {
        return ctx.shortcuts.register(cycle)
      } catch (error) {
        // Another command already owns the default; keep the command bindable.
        console.warn('ui-model-picker: favorite shortcut default unavailable', error)
        return ctx.shortcuts.register({ ...cycle, defaults: {} })
      }
    }
    const unregisterCycle = registerCycle()
    if (ctx.shortcuts.runtime === 'web') {
      const unregister = ctx.shortcuts.registerFixed({
        id: commandId,
        label: () => text().openPicker,
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
        const action = resolve(context)
        if (action.status === 'pass') return
        input.consume()
        if (action.status === 'handled') action.run()
      })
      return () => {
        unobserve()
        unregister()
        unregisterCycle()
      }
    }
    const unregister = ctx.shortcuts.register({
      id: commandId,
      label: () => text().openPicker,
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
    return () => {
      unregister()
      unregisterCycle()
    }
  }, 'ui-model-picker: shortcut')
  ctx.effect(() => {
    const sync = (event: StorageEvent) => favorites.sync(event)
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, 'ui-model-picker: favorites')

  function useDirectory(sessionId: SessionKey) {
    const directory = ctx.modelDirectories.directoryFor(sessionId)
    const subscribe = useCallback((listener: () => void) => directory.store.subscribe(listener), [directory])
    const getSnapshot = useCallback(() => directory.store.getSnapshot(), [directory])
    const state = useSyncExternalStore(subscribe, getSnapshot)
    const group = state.groups.find((item) => item.id === state.current?.provider)
    const model = group?.models.find((item) => item.id === state.current?.model)
    return { directory, state, model }
  }
  function useFavorites() {
    return useSyncExternalStore(
      (listener) => favorites.subscribe(listener),
      () => favorites.getSnapshot()
    )
  }
  function useText() {
    return localizedCopy(copy, useLocaleSnapshot(ctx.locale).active)
  }

  function Star({ favorite, name, onToggle }: { favorite: ModelSelection; name: string; onToggle?: () => void }) {
    const list = useFavorites()
    const t = useText()
    const saved = list.some((item) => sameFavorite(item, favorite))
    const label = `${saved ? t.removeFavorite : t.addFavorite}: ${name}`
    return (
      <button
        type="button"
        role="switch"
        className="dsh-picker-star"
        aria-checked={saved}
        aria-label={label}
        title={label}
        onClick={() => {
          favorites.toggle(favorite)
          onToggle?.()
        }}
      >
        <IconStarOutlineRegular />
      </button>
    )
  }

  // Replaces the official reasoning row of the root menu with a stepped slider.
  // The official row stays mounted but hidden and disabled while the slider is
  // drawn, so the menu's arrow keys and Tab never land on it.
  function EffortSlider({ sessionId, locked, reportFailure }: MenuControls & { sessionId: SessionKey }) {
    const { directory, state, model } = useDirectory(sessionId)
    const t = useText()
    const root = useRef<HTMLDivElement>(null)
    const reasoning = model?.reasoning
    const choices: EffortChoice[] = reasoning
      ? [
          ...(reasoning.defaultEffort === undefined ? [{ key: 'default', label: t.default }] : []),
          ...reasoning.efforts.map((effort) => ({ key: effort.id, effort: effort.id, label: effort.name })),
        ]
      : []
    const effective = state.current?.reasoningEffort ?? reasoning?.defaultEffort
    const selected = Math.max(
      0,
      choices.findIndex((choice) => choice.effort === effective)
    )
    const interaction = useRef<Interaction>({ draft: selected, gesture: null, selected })
    const [snapshot, setSnapshot] = useState<Interaction>(interaction.current)
    const busy = isBusy(state)

    useLayoutEffect(() => {
      const anchor = root.current?.closest('[data-slot="conversation.input.model.options"]')
      const row = anchor?.previousElementSibling
      if (
        !(row instanceof HTMLButtonElement) ||
        !row.matches('button[role="menuitem"]') ||
        !row.previousElementSibling?.matches('button[role="menuitem"]')
      )
        return
      // The official cell class sets display, which outranks the hidden attribute.
      const display = row.style.display
      row.style.display = 'none'
      row.disabled = true
      return () => {
        row.style.display = display
        row.disabled = false
      }
    })

    useLayoutEffect(() => {
      const menu = root.current?.closest<HTMLElement>('[data-model-menu]')
      if (!menu) return
      // The official arrow-key traversal only visits buttons; walk the slider too.
      const keydown = (event: KeyboardEvent) => {
        if (
          (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.isComposing ||
          menu.getAttribute('role') !== 'menu'
        )
          return
        const items = [...menu.querySelectorAll<HTMLElement>(menuRows)]
        const index = items.indexOf(document.activeElement as HTMLElement)
        if (index < 0) return
        event.preventDefault()
        event.stopPropagation()
        items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      }
      menu.addEventListener('keydown', keydown, true)
      return () => menu.removeEventListener('keydown', keydown, true)
    }, [])

    const dispatch = (action: Action) => {
      const synced = transition(interaction.current, { selected, type: 'sync' }).state
      const result = transition(synced, action)
      interaction.current = result.state
      setSnapshot(result.state)
      const choice = result.commit === undefined ? undefined : choices[result.commit]
      const current = state.current
      if (!choice || !current) return
      directory
        .select({
          provider: current.provider,
          model: current.model,
          ...(choice.effort === undefined ? {} : { reasoningEffort: choice.effort }),
        })
        .then(
          (outcome) => {
            if (outcome.ok) return
            dispatch({ type: 'cancel' })
            reportFailure(t.error)
          },
          () => {
            dispatch({ type: 'cancel' })
            reportFailure(t.error)
          }
        )
    }

    if (!reasoning || choices.length === 0 || !state.current) return <div ref={root} hidden />
    const draft = Math.min(transition(snapshot, { selected, type: 'sync' }).state.draft, choices.length - 1)
    const progress = choices.length > 1 ? draft / (choices.length - 1) : 0
    // A composer lock disables the slider; a selection in flight only blocks
    // input so the focused slider keeps focus until the selection settles.
    const blocked = locked || busy
    const disabled = (locked && !busy) || choices.length < 2
    const draftChoice = choices[draft]
    const draftEffort = draftChoice?.effort ?? reasoning.defaultEffort
    const favorite: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...(draftEffort === undefined ? {} : { reasoningEffort: draftEffort }),
    }
    return (
      <div className="dsh-effort" ref={root}>
        <div className="dsh-effort-header">
          <span className="dsh-effort-label">{t.effort}</span>
          <span className="dsh-effort-value">{draftChoice?.label}</span>
          <Star favorite={favorite} name={[model?.name ?? favorite.model, draftChoice?.label].join(', ')} />
        </div>
        <div className="dsh-effort-track">
          <div className="dsh-effort-rail" aria-hidden="true">
            <div
              className="dsh-effort-fill"
              style={{ width: `calc(${progress * 100}% + var(--dsh-effort-track) * ${0.5 - progress})` }}
            />
          </div>
          <div className="dsh-effort-dots" aria-hidden="true">
            {choices.map((choice, index) => (
              <span
                className="dsh-effort-dot"
                data-filled={index <= draft}
                key={choice.key}
                style={{ left: `${choices.length === 1 ? 0 : (index / (choices.length - 1)) * 100}%` }}
              />
            ))}
          </div>
          <input
            className="dsh-effort-input"
            type="range"
            min={0}
            max={choices.length - 1}
            step={1}
            value={draft}
            disabled={disabled}
            aria-disabled={blocked || disabled}
            aria-label={t.effort}
            aria-valuetext={draftChoice?.label}
            onPointerDown={(event) => {
              if (blocked) return
              dispatch({ gesture: 'pointer', type: 'begin' })
              event.currentTarget.setPointerCapture?.(event.pointerId)
            }}
            onPointerUp={() => dispatch({ gesture: 'pointer', type: 'commit' })}
            onPointerCancel={() => dispatch({ type: 'cancel' })}
            onLostPointerCapture={() => {
              if (interaction.current.gesture === 'pointer') dispatch({ type: 'cancel' })
            }}
            onChange={(event) => {
              if (!blocked) dispatch({ index: Number(event.currentTarget.value), type: 'change' })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                dispatch({ type: 'cancel' })
                return
              }
              if (!sliderKeys.has(event.key)) return
              // Keep the composer and the menu from reading the slider's keys.
              event.stopPropagation()
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) {
                event.preventDefault()
                dispatch({ type: 'cancel' })
                return
              }
              if (!blocked && interaction.current.gesture === null) dispatch({ gesture: 'keyboard', type: 'begin' })
            }}
            onKeyUp={(event) => {
              if (!sliderKeys.has(event.key)) return
              event.stopPropagation()
              dispatch({ gesture: 'keyboard', type: 'commit' })
            }}
            onBlur={() => dispatch({ type: 'cancel' })}
          />
        </div>
      </div>
    )
  }

  // Root-menu row that opens the favorites pane (DSH 0.2.3 and later).
  function FavoritesRow({ locked, openPane }: MenuControls) {
    const t = useText()
    const list = useFavorites()
    if (!openPane) return null
    return (
      <button
        type="button"
        role="menuitem"
        className="dsh-picker-cell"
        data-model-menu-pane={FAVORITES_PANE}
        disabled={locked}
        onClick={() => openPane({ key: FAVORITES_PANE, title: t.favorites })}
      >
        <span className="dsh-picker-cell-label">{t.favorites}</span>
        <span className="dsh-picker-cell-value">{list.length || ''}</span>
        <IconChevronRightOutlineRegular />
      </button>
    )
  }

  function FavoritesPane({ sessionId, locked, dismiss, reportFailure }: MenuControls & { sessionId: SessionKey }) {
    const { directory, state, model } = useDirectory(sessionId)
    const t = useText()
    const list = useFavorites()
    const pane = useRef<HTMLDivElement>(null)
    const current = state.current
    const currentEffort = current?.reasoningEffort ?? model?.reasoning?.defaultEffort
    const currentFavorite: ModelSelection | null = current
      ? {
          provider: current.provider,
          model: current.model,
          ...(currentEffort === undefined ? {} : { reasoningEffort: currentEffort }),
        }
      : null
    const describe = (favorite: ModelSelection) => {
      // A listed model keeps its catalog name even when the saved effort is gone.
      const listed = availableFavorite(state.groups, { provider: favorite.provider, model: favorite.model })
      const effort =
        favorite.reasoningEffort === undefined
          ? undefined
          : (listed?.reasoning?.efforts.find((item) => item.id === favorite.reasoningEffort)?.name ??
            favorite.reasoningEffort)
      return { option: availableFavorite(state.groups, favorite), name: listed?.name ?? favorite.model, effort }
    }
    // A removed row takes its focused star with it; keep focus in the pane.
    const keepFocus = () =>
      setTimeout(() => {
        if (!pane.current?.contains(document.activeElement))
          pane.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
      })
    const choose = (favorite: ModelSelection) => {
      directory.select(favorite).then(
        (outcome) => (outcome.ok ? dismiss() : reportFailure(t.error)),
        () => reportFailure(t.error)
      )
    }
    const busy = locked || isBusy(state)
    let focused = false
    return (
      <div ref={pane}>
        <div className="dsh-picker-favorites-title">
          <span>{t.favorites}</span>
          {currentFavorite && (
            <Star
              favorite={currentFavorite}
              name={[model?.name ?? currentFavorite.model, describe(currentFavorite).effort].filter(Boolean).join(', ')}
            />
          )}
        </div>
        {list.length === 0 && <p className="dsh-picker-empty">{t.noFavorites}</p>}
        {list.map((favorite) => {
          const { option, name, effort } = describe(favorite)
          const checked = currentFavorite !== null && sameFavorite(currentFavorite, favorite)
          const autoFocus = !focused && !busy && option !== undefined
          if (autoFocus) focused = true
          return (
            <div
              className="dsh-picker-favorite"
              key={`${favorite.provider}\u0000${favorite.model}\u0000${favorite.reasoningEffort ?? ''}`}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className="dsh-picker-cell"
                disabled={busy || !option}
                autoFocus={autoFocus}
                onClick={() => choose(favorite)}
              >
                <span className="dsh-picker-cell-label">
                  {name}
                  {(effort || !option) && (
                    <small>{[effort, option ? undefined : t.unavailable].filter(Boolean).join(' · ')}</small>
                  )}
                </span>
                <span className="dsh-picker-check" aria-hidden="true">
                  {checked && <IconCheckOutlineRegular />}
                </span>
              </button>
              <Star favorite={favorite} name={[name, effort].filter(Boolean).join(', ')} onToggle={keepFocus} />
            </div>
          )
        })}
      </div>
    )
  }

  function Target({ sessionId }: { sessionId: SessionKey }) {
    const marker = useRef<HTMLSpanElement>(null)
    useLayoutEffect(() => {
      const element = marker.current
      if (!element || ctx.sessions.subagentAddress(sessionId) !== undefined) return
      targets.set(element, ctx.modelDirectories.directoryFor(sessionId))
      return () => {
        targets.delete(element)
      }
    }, [sessionId])
    return <span ref={marker} hidden />
  }

  ctx.slots.inject('conversation.input.overlay', () =>
    ctx.slots.register(
      { id: 'dungsil-model-picker-target', name: 'conversation.input.overlay', order: -99 },
      (props) => <Target sessionId={props.sessionId} />
    )
  )
  ctx.slots.inject('conversation.input.model.options', () => {
    const disposeSlider = ctx.slots.register(
      { id: 'dungsil-effort-slider', name: 'conversation.input.model.options', order: -1000 },
      (props) => <EffortSlider {...(props as unknown as MenuControls)} sessionId={props.sessionId} />
    )
    const disposeRow = ctx.slots.register(
      { id: 'dungsil-model-favorites', name: 'conversation.input.model.options', order: 1000 },
      (props) => <FavoritesRow {...(props as unknown as MenuControls)} />
    )
    return () => {
      disposeSlider()
      disposeRow()
    }
  })
  ctx.slots.inject('conversation.input.model.pane', () =>
    ctx.slots.register({ key: FAVORITES_PANE, name: 'conversation.input.model.pane' }, (props) => (
      <FavoritesPane {...(props as unknown as MenuControls)} sessionId={props.sessionId} />
    ))
  )
  ctx.effect(() => installStyles(styles), 'ui-model-picker: styles')
}
