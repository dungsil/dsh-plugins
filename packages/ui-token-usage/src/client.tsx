import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { countParts, countText } from '@dungsil/dsh-ui/count'
import { createExactCountMarker, exactCountStyles } from '@dungsil/dsh-ui/count/dom'
import { createElement, useLayoutEffect, useMemo, useRef, type ComponentType } from 'react'

export const name = 'dungsil-ui-token-usage'
export const inject = ['locale', 'slots']

type Translate = (key: string, params?: Record<string, unknown>) => string
type UseProjection = (key: string) => unknown
type Props = Record<string, unknown> & { t: Translate; useProjection: UseProjection }

interface TokenUsage {
  uncachedInputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}
interface ContextPressure {
  projectedTokens?: number
  pressureTokens?: number
  contextWindow?: number
}
interface ContextBreakdown {
  systemTokens: number
  toolsTokens: number
  messageTokens: number
}
interface ContextReading {
  used: number | undefined
  window: number | undefined
  rows: (number | undefined)[] | undefined
}

// The context panel header is one flex row sized for `~839K / 1M`.
const STYLES = `${exactCountStyles}
:has(> [data-dsh-token-usage-figures]) { flex-wrap: wrap; }
`

// Native exact counts join digit groups with `number.groupSeparator`; an invisible
// separator keeps them recognizable when they reach `message.turnUsage.count`.
const GROUP = '\u2063'

/**
 * Native Chat usage text through `t`, with every token count shown as a compact
 * count plus the exact count and no unit word. Native compact counts lose the
 * exact value before `t` sees them, so the caller passes the one value that
 * the component formats compactly; digit-only counts are already exact.
 */
function countTranslate(t: Translate, language: string, compactValue: number | undefined): Translate {
  return (key, params) => {
    if (key === 'number.groupSeparator') return GROUP
    if (key !== 'message.turnUsage.count') return t(key, params)
    const count = String(params?.count)
    const digits = count.replaceAll(GROUP, '')
    const value = /^\d+$/.test(digits) ? Number(digits) : compactValue
    if (value === undefined) return t(key, { ...params, count: count.replaceAll(GROUP, t('number.groupSeparator')) })
    return countText(countParts(value, language))
  }
}

export function apply(ctx: Context) {
  const marker = createExactCountMarker()
  const readings = new Map<HTMLElement, ContextReading>()
  const written = new Map<HTMLElement, { native: string; ours: string }>()

  const language = () => ctx.locale.getSnapshot().active
  const useLanguage = () => useLocaleSnapshot(ctx.locale).active
  const text = (value: number | undefined) => countText(countParts(value, language()))

  /** Writes a whole count string into a native element that React fills with one text child. */
  function write(element: HTMLElement, desired: string) {
    const current = element.textContent ?? ''
    let record = written.get(element)
    // React replaced our text: what it wrote is the native text to restore later.
    if (!record || current !== record.ours) written.set(element, (record = { native: current, ours: current }))
    if (current !== desired) element.textContent = desired
    record.ours = desired
  }

  /**
   * DSH 0.2.2-rc.3 renders the context meter inside the composer bar without a
   * slot: its root is a dock child with `anchor-name: --dsh-context-*`, and its
   * portaled panel names that anchor in `position-anchor`, puts `~used / window`
   * in the header's last span, and lists system, tools, and messages as `dl > div > dd`.
   */
  function contextPanels() {
    const panels: HTMLElement[] = []
    for (const [element, reading] of readings) {
      const dock = element.closest('[data-composer-dock]')
      const anchor = [...(dock?.children ?? [])]
        .map((child) => (child as HTMLElement).style.getPropertyValue('anchor-name'))
        .find((value) => value.startsWith('--dsh-context-'))
      if (!anchor) continue
      const panel = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
        (dialog) => dialog.style.getPropertyValue('position-anchor') === anchor
      )
      if (!panel) continue
      const figures = panel.firstElementChild?.lastElementChild
      if (figures instanceof HTMLElement && figures.textContent?.startsWith('~')) {
        // Exact counts no longer fit beside the headline; STYLES moves them to their own line.
        figures.dataset.dshTokenUsageFigures = ''
        write(figures, `~${text(reading.used)} / ${text(reading.window)}`)
      }
      const rows = panel.querySelectorAll<HTMLElement>(':scope > dl > div > dd')
      if (reading.rows && rows.length === reading.rows.length)
        rows.forEach((row, index) => write(row, `~${text(reading.rows![index])}`))
      panels.push(panel)
    }
    return panels
  }

  function refresh() {
    for (const element of written.keys()) if (!element.isConnected) written.delete(element)
    const panels = contextPanels()
    const dialogs = [...document.querySelectorAll('[data-session-stats-usage], [data-turn-usage-details]')].map(
      (details) => details.closest('[role="dialog"]') ?? details
    )
    marker.mark([
      ...document.querySelectorAll('[data-composer-stat="usage"], [data-turn-tail] button[aria-haspopup="dialog"]'),
      ...dialogs,
      ...panels,
    ])
  }

  function ContextCounts({ useProjection }: Props) {
    const ref = useRef<HTMLSpanElement>(null)
    // Re-run on language changes too: the panel text is ours, not React's.
    useLanguage()
    const pressure = useProjection('contextPressure') as ContextPressure | undefined
    const breakdown = useProjection('contextBreakdown') as ContextBreakdown | undefined
    useLayoutEffect(() => {
      readings.set(ref.current!, {
        used: pressure?.projectedTokens ?? pressure?.pressureTokens,
        window: pressure?.contextWindow,
        rows: breakdown && [breakdown.systemTokens, breakdown.toolsTokens, breakdown.messageTokens],
      })
      refresh()
    })
    useLayoutEffect(() => {
      const element = ref.current!
      return () => void readings.delete(element)
    }, [])
    return <span ref={ref} hidden data-dsh-token-usage-context="" />
  }

  const usagePill = (Original: ComponentType<Props>) =>
    function TokenUsagePill(props: Props) {
      const current = useLanguage()
      const usage = props.useProjection('tokenUsage') as TokenUsage | undefined
      // The same total the native pill formats compactly.
      const total =
        usage && usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
      const t = useMemo(() => countTranslate(props.t, current, total), [props.t, current, total])
      return createElement(Original, { ...props, t })
    }

  const turnTail = (Original: ComponentType<Props & { node: { data: { tokenUsage?: { totalTokens: number } } } }>) =>
    function TokenTurnTail(props: Props & { node: { data: { tokenUsage?: { totalTokens: number } } } }) {
      const current = useLanguage()
      const total = props.node.data.tokenUsage?.totalTokens
      const t = useMemo(() => countTranslate(props.t, current, total), [props.t, current, total])
      return createElement(Original, { ...props, t })
    }

  /**
   * Wraps native entries in place, as ui-image-paths does, so they keep their
   * cell, child slots, hooks, and locale; disposal puts the native component back.
   */
  function wrapEntries(
    slot: 'conversation.composer.dock' | 'conversation.chat.node',
    cell: { id: string } | { key: string },
    wrap: (original: ComponentType<never>) => ComponentType<never>
  ) {
    const matches = (entry: StoredEntry) =>
      'id' in cell ? entry.options.id === cell.id : entry.options.key === cell.key
    ctx.slots.inject(slot, () => {
      const originals = new Map<StoredEntry, { original: unknown; wrapper: unknown }>()
      const outlet = () => null
      const sync = () => {
        const entries = ctx.slots.entries(slot).filter((entry) => entry.component !== outlet && matches(entry))
        for (const entry of originals.keys()) if (!entries.includes(entry)) originals.delete(entry)
        for (const entry of entries) {
          if (originals.has(entry)) continue
          const wrapper = wrap(entry.component as ComponentType<never>)
          originals.set(entry, { original: entry.component, wrapper })
          entry.component = wrapper
        }
      }
      const unsubscribe = ctx.slots.subscribe(slot, sync)
      // This shadowed entry invalidates mounted outlets on enable and disable without rendering.
      const disposeOutlet = (ctx.slots.register as (options: object, component: unknown) => () => void)(
        { name: slot, ...cell, priority: Number.MAX_SAFE_INTEGER },
        outlet
      )
      sync()
      return () => {
        unsubscribe()
        for (const [entry, { original, wrapper }] of originals)
          if (entry.component === wrapper) entry.component = original
        originals.clear()
        disposeOutlet()
      }
    })
  }

  wrapEntries('conversation.composer.dock', { id: 'usage' }, usagePill as never)
  wrapEntries('conversation.chat.node', { key: 'turn-tail' }, turnTail as never)
  ctx.slots.inject('conversation.composer.dock', () =>
    (ctx.slots.register as (options: object, component: unknown) => () => void)(
      { name: 'conversation.composer.dock', id: name, order: 2 },
      ContextCounts
    )
  )

  ctx.effect(() => {
    const disposeStyles = installStyles(STYLES)
    // Rewrite in the mutation microtask, before paint, then drop the records our own writes queued.
    const observer = new MutationObserver(() => {
      refresh()
      observer.takeRecords()
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    refresh()
    return () => {
      observer.disconnect()
      marker.restore()
      for (const [element, { native, ours }] of written) {
        delete element.dataset.dshTokenUsageFigures
        if (element.textContent === ours) element.textContent = native
      }
      written.clear()
      disposeStyles()
    }
  }, 'ui-token-usage: counts')
}
