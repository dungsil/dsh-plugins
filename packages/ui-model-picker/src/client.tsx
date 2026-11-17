import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ShortcutBinding, ShortcutCommand, ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { ComposerTrigger } from '@dungsil/dsh-ui/composer'
import {
  IconChevronLeftOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCheckOutlineRegular,
  IconDataOutlineRegular,
  IconResetOutlineRegular,
  IconStarOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import { MenuSurface, Tooltip, focusWithoutRing, useDismissOnOutsidePointer } from '@dungsil/dsh-ui'
import { styles } from './styles.js'
import { availableFavorite, createFavoriteStore, nextFavorite, sameFavorite } from './favorites.js'
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
  ko: {
    model: '모델 선택',
    effort: '추론 강도',
    choose: '추론 수준 선택',
    configure: '추론 수준 설정',
    openPicker: '모델 피커 열기',
    reset: '기본값으로 재설정',
    loading: '모델을 불러오는 중입니다…',
    empty: '사용할 수 있는 모델이 없습니다.',
    partial: '일부 제공자의 모델을 불러오지 못했습니다.',
    missing: '현재 모델을 사용할 수 없습니다.',
    error: '변경하지 못했습니다. 현재 선택을 확인한 뒤 다시 시도하세요.',
    retry: '모델 목록 새로고침',
    busy: '변경 중…',
    apply: '적용',
    favorites: '즐겨찾기',
    addFavorite: '즐겨찾기에 추가',
    removeFavorite: '즐겨찾기에서 제거',
    unavailable: '사용할 수 없음',
    cycleFavorites: '다음 즐겨찾기 모델로 전환',
  },
  en: {
    model: 'Select model',
    effort: 'Reasoning effort',
    choose: 'Select reasoning effort',
    configure: 'Configure reasoning effort',
    openPicker: 'Open model picker',
    reset: 'Reset to default',
    loading: 'Loading models…',
    empty: 'No models available.',
    partial: 'Some providers could not be loaded.',
    missing: 'The current model is unavailable.',
    error: 'Could not change the selection. Check the current selection before retrying.',
    retry: 'Reload models',
    busy: 'Changing…',
    apply: 'Apply',
    favorites: 'Favorites',
    addFavorite: 'Add to favorites',
    removeFavorite: 'Remove from favorites',
    unavailable: 'Unavailable',
    cycleFavorites: 'Switch to next favorite model',
  },
  zh: {
    model: '选择模型',
    effort: '推理强度',
    choose: '选择推理级别',
    configure: '设置推理级别',
    openPicker: '打开模型选择器',
    reset: '重置为默认值',
    loading: '正在加载模型…',
    empty: '没有可用的模型。',
    partial: '部分提供商的模型加载失败。',
    missing: '当前模型不可用。',
    error: '更改失败。请确认当前选择后重试。',
    retry: '刷新模型列表',
    busy: '正在更改…',
    apply: '应用',
    favorites: '收藏',
    addFavorite: '添加到收藏',
    removeFavorite: '从收藏中移除',
    unavailable: '不可用',
    cycleFavorites: '切换到下一个收藏模型',
  },
}

export function apply(ctx: Context) {
  const commandId = 'dungsil.model-picker.open' as ShortcutCommandId
  const cycleId = 'dungsil.model-picker.cycle-favorites' as ShortcutCommandId
  const pickers = new Map<
    HTMLDivElement,
    {
      disabled: boolean
      owns: (node: Node) => boolean
      open: () => void
      next: () => ModelSelection | null
      cycle: (selection: ModelSelection) => void
    }
  >()
  const favorites = createFavoriteStore(() => window.localStorage)
  const binding: ShortcutBinding = { code: 'KeyP', modifiers: ['alt'] }
  const cycleBinding: ShortcutBinding = { code: 'KeyP', modifiers: ['alt', 'shift'] }
  // One visible picker is the target. With several composers on screen, the
  // target is the picker whose popover holds the input, or the one sharing the
  // closest ancestor with it that holds no other visible picker.
  const pickerFor = (target: Element | null) => {
    const visible = [...pickers].filter(([element]) => element.isConnected && element.getClientRects().length > 0)
    if (visible.length < 2) return visible[0]?.[1]
    if (!target) return undefined
    const popover = visible.find(([, picker]) => picker.owns(target))
    if (popover) return popover[1]
    const owners = visible.filter(([element]) => {
      let scope = element.parentElement
      while (scope && !scope.contains(target)) scope = scope.parentElement
      return scope !== null && visible.every(([other]) => other === element || !scope!.contains(other))
    })
    return owners.length === 1 ? owners[0]![1] : undefined
  }
  const targetOf = (context?: { target: Element | null }) => context?.target ?? document.activeElement
  const shortcutCatalog = ctx.shortcuts.runtime === 'web' ? ctx.shortcuts.fixedCatalog : ctx.shortcuts.catalog
  ctx.effect(() => {
    const label = () => {
      const locale = ctx.locale.getSnapshot().active
      return localizedCopy(copy, locale).openPicker
    }
    const resolve = (context?: { target: Element | null }) => {
      const picker = pickerFor(targetOf(context))
      if (!picker) return { status: 'pass' } as const
      if (picker.disabled) return { status: 'blocked', reason: 'Model picker is locked or busy' } as const
      return { status: 'handled', run: picker.open } as const
    }
    const cycle: ShortcutCommand = {
      id: cycleId,
      label: () => localizedCopy(copy, ctx.locale.getSnapshot().active).cycleFavorites,
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
        if (picker.disabled) return { status: 'blocked', reason: 'Model picker is locked or busy' }
        const next = picker.next()
        if (!next) return { status: 'blocked', reason: 'Fewer than two available favorites' }
        return { status: 'handled', run: () => picker.cycle(next) }
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
    const favoriteList = useSyncExternalStore(
      (listener) => favorites.subscribe(listener),
      () => favorites.getSnapshot()
    )
    const { active: locale } = useLocaleSnapshot(ctx.locale)
    const text = localizedCopy(copy, locale)
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

    const close = (refocus = true) => {
      sliderSelection.current = null
      setPanel(null)
      setStaged(null)
      if (refocus && trigger.current) focusWithoutRing(trigger.current)
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
      const resize = () => close()
      const scroll = (event: Event) => {
        if (!element.contains(event.target as Node)) position()
      }
      window.addEventListener('resize', resize)
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
        element.querySelector<HTMLElement>('[aria-current=true]') ??
        element.querySelector<HTMLElement>('input:not(:disabled)') ??
        element.querySelector<HTMLElement>('button:not(:disabled)')
      focusable?.focus()
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', resize)
        window.removeEventListener('scroll', scroll, true)
        element.removeEventListener('keydown', keydown)
      }
    }, [panel])

    useEffect(() => {
      if (locked) {
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
      restorePopupFocus()
      setPanel(null)
      setStaged(null)
    }, [current?.provider, current?.model, current?.reasoningEffort])

    // `refocus` is false for the cycle shortcut, which keeps focus in the editor.
    const select = async (selection: ModelSelection, keepSlider = false, refocus = true) => {
      if (disabled || pending.current) return
      pending.current = true
      sliderSelection.current = keepSlider ? selection : null
      setFailed(false)
      try {
        const result = await directory.select(selection)
        if (!mounted.current) return
        if (result.ok) {
          if (!keepSlider) close(refocus)
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
    useLayoutEffect(() => {
      const element = anchor.current
      if (!element) return
      pickers.set(element, {
        disabled,
        owns: (node) => popup.current?.contains(node) ?? false,
        next: () => {
          const snapshot = directory.store.getSnapshot()
          return nextFavorite(favorites.getSnapshot(), snapshot.groups, snapshot.current)
        },
        cycle: (selection) => void select(selection, false, panel !== null),
        open: () => {
          if (panel) {
            popup.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus()
          } else if (trigger.current) {
            show(trigger.current)
          }
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
      setDraft(
        Math.max(
          0,
          optionEfforts.findIndex((item) => item.id === preferredEffort)
        )
      )
      setFailed(false)
      setPanel('effort')
    }

    // Favorites keep an explicit effort so a cycle restores the exact combination.
    const currentEffort = current?.reasoningEffort ?? reasoning?.defaultEffort
    const currentFavorite: ModelSelection | null = current
      ? {
          provider: current.provider,
          model: current.model,
          ...(currentEffort === undefined ? {} : { reasoningEffort: currentEffort }),
        }
      : null
    const draftTarget = staged ?? current
    const draftEffort = stagedEfforts[draft]?.id
    const draftFavorite: ModelSelection | null =
      draftTarget && draftEffort !== undefined
        ? { provider: draftTarget.provider, model: draftTarget.model, reasoningEffort: draftEffort }
        : null
    const star = (favorite: ModelSelection, name: string, removesRow = false) => {
      const saved = favoriteList.some((item) => sameFavorite(item, favorite))
      const label = `${saved ? text.removeFavorite : text.addFavorite}: ${name}`
      return (
        <button
          type="button"
          className="dsh-codex-star"
          aria-pressed={saved}
          aria-label={label}
          title={label}
          onClick={() => {
            favorites.toggle(favorite)
            // A removed row takes its focused button with it.
            if (removesRow)
              setTimeout(() => {
                if (!popup.current?.contains(document.activeElement))
                  popup.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
              })
          }}
        >
          <IconStarOutlineRegular />
        </button>
      )
    }
    const favoriteName = (favorite: ModelSelection) => {
      // A listed model keeps its catalog name even when the saved effort is gone.
      const listed = availableFavorite(state.groups, { provider: favorite.provider, model: favorite.model })
      const effort =
        favorite.reasoningEffort === undefined
          ? undefined
          : (listed?.reasoning?.efforts.find((item) => item.id === favorite.reasoningEffort)?.name ??
            favorite.reasoningEffort)
      return { option: availableFavorite(state.groups, favorite), name: listed?.name ?? favorite.model, effort }
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
                      if (!disabled) setPanel('model')
                    }}
                  >
                    <strong>{stagedEfforts[draft]?.name}</strong>
                    <span>
                      {stagedName} <IconChevronRightOutlineRegular size={14} />
                    </span>
                  </button>
                  {draftFavorite ? (
                    star(draftFavorite, `${stagedName}, ${stagedEfforts[draft]?.name ?? draftEffort}`)
                  ) : (
                    <span />
                  )}
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
                  {(currentFavorite || favoriteList.length > 0) && (
                    <section className="dsh-codex-favorites" aria-label={text.favorites}>
                      <div className="dsh-codex-provider dsh-codex-favorites-title">
                        <span>{text.favorites}</span>
                        {currentFavorite &&
                          star(
                            currentFavorite,
                            [model?.name ?? current!.model, effortLabel].filter(Boolean).join(', ')
                          )}
                      </div>
                      {favoriteList.map((favorite) => {
                        const { option, name, effort } = favoriteName(favorite)
                        const selected = currentFavorite !== null && sameFavorite(currentFavorite, favorite)
                        return (
                          <div
                            className="dsh-codex-favorite"
                            key={`${favorite.provider}\u0000${favorite.model}\u0000${favorite.reasoningEffort ?? ''}`}
                          >
                            <button
                              type="button"
                              className="dsh-codex-option"
                              disabled={disabled || !option}
                              onClick={() => void select(favorite)}
                            >
                              <span>
                                {name}
                                {(effort || !option) && (
                                  <small>
                                    {[effort, option ? undefined : text.unavailable].filter(Boolean).join(' · ')}
                                  </small>
                                )}
                              </span>
                              <span className="dsh-codex-check" aria-hidden="true">
                                {selected && <IconCheckOutlineRegular size={14} />}
                              </span>
                            </button>
                            {star(favorite, [name, effort].filter(Boolean).join(', '), true)}
                          </div>
                        )
                      })}
                    </section>
                  )}
                  <div className="dsh-codex-models" role="group" aria-label={text.model}>
                    {state.groups.map((provider) => (
                      <section key={provider.id} aria-label={provider.name}>
                        <div className="dsh-codex-provider">{provider.name}</div>
                        {provider.models.map((option) => (
                          <button
                            type="button"
                            aria-current={
                              provider.id === current?.provider && option.id === current?.model ? 'true' : undefined
                            }
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
                        onPointerUp={() => selectEffort(draft)}
                        onKeyUp={(event) => {
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
                            selectEffort(draft)
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
