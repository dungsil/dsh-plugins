import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SlotComponent, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-cot-translation/remote'
import type { CotTranslationSnapshot } from '@deepseek-ai/dsh-experimental-client-ui-cot-translation/types'
import type { TranslationProvider } from '@deepseek-ai/dsh-experimental-translator/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, Tooltip } from '@dungsil/dsh-ui'
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { IconLanguagesOutlineRegular, IconLoadingOutlineRegular } from '@dungsil/dsh-ui/icons'
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { copy, providerNames, type Copy } from './copy.js'
import { isForeign } from './language.js'
import { OWN, collectParagraphs, firstBlockChild, prose, restore, type Paragraph } from './paragraphs.js'
import { TranslationRequests } from './requests.js'
import { STYLES } from './styles.js'

export const name = 'dungsil-ui-answer-translation'
export const inject = ['slots', 'locale', 'remote']

type AssistantProps = ChatNodeViewProps<'assistant-step'>

interface Settings {
  get: () => CotTranslationSnapshot | undefined
  subscribe: (listener: () => void) => () => void
}

interface Shared {
  ctx: Context
  settings: Settings
  requests: TranslationRequests
}

const format = (template: string, provider: string) => template.replace('{provider}', provider)

/** One preserved inline element of the original, cloned so it keeps its exact markup. */
function Atom({ source }: { source: Element }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const clone = source.cloneNode(true) as Element
    for (const element of [clone, ...clone.querySelectorAll('[id]')]) element.removeAttribute('id')
    ref.current?.replaceChildren(clone)
  }, [source])
  // Clones lost React handlers; the original link, mention, or menu handles the gesture instead.
  const interactive = (event: { target: EventTarget }) =>
    (event.target as Element).closest('a, button, [role="button"], [tabindex]') !== null
  const forward = (event: ReactMouseEvent) => {
    if (!interactive(event)) return
    event.preventDefault()
    event.stopPropagation()
    if (!source.isConnected) return
    const { clientX, clientY, screenX, screenY, button, buttons, ctrlKey, shiftKey, altKey, metaKey } = event
    source.dispatchEvent(
      new MouseEvent(event.type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        screenX,
        screenY,
        button,
        buttons,
        ctrlKey,
        shiftKey,
        altKey,
        metaKey,
      })
    )
  }
  // Native links and buttons turn Enter into a click; other focusable mentions need their key handlers.
  const forwardKey = (event: ReactKeyboardEvent) => {
    const target = event.target as Element
    if (!interactive(event) || target.closest('a, button') || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    event.stopPropagation()
    if (!source.isConnected) return
    const { key, code, ctrlKey, shiftKey, altKey, metaKey } = event
    source.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, code, ctrlKey, shiftKey, altKey, metaKey })
    )
  }
  return (
    <span
      ref={ref}
      className="dsh-answer-translation-atom"
      onClickCapture={forward}
      onContextMenuCapture={forward}
      onKeyDownCapture={forwardKey}
    />
  )
}

function Translation({ text, atoms }: { text: string; atoms: readonly Element[] }) {
  return (
    <>
      {restore(text, atoms.length).map((part, index) =>
        typeof part === 'number' ? <Atom key={index} source={atoms[part]!} /> : part
      )}
    </>
  )
}

/** Insert the result panel right after the paragraph's own text, inside list items before their sublists. */
function usePanelHost(paragraph: HTMLElement, mounted: boolean) {
  const [host, setHost] = useState<HTMLElement>()
  useLayoutEffect(() => {
    if (!mounted) return
    const element = document.createElement('div')
    element.setAttribute(OWN, 'panel')
    const place = () => {
      if (paragraph.tagName === 'LI') {
        const block = firstBlockChild(paragraph)
        if (element.parentElement !== paragraph || element.nextElementSibling !== block) {
          paragraph.insertBefore(element, block)
        }
      } else if (paragraph.nextElementSibling !== element) paragraph.after(element)
    }
    place()
    setHost(element)
    // React may rebuild the paragraph's siblings; keep the panel directly below it.
    const observer = new MutationObserver(place)
    observer.observe(paragraph.parentElement ?? paragraph, { childList: true })
    if (paragraph.tagName === 'LI') observer.observe(paragraph, { childList: true })
    return () => {
      observer.disconnect()
      element.remove()
      setHost(undefined)
    }
  }, [paragraph, mounted])
  return host
}

interface ActionProps {
  shared: Shared
  paragraph: Paragraph
  host: HTMLElement
  requestKey: string
  viewKey: string
  provider: string
  text: Copy
}

function ParagraphAction({ shared: { requests }, paragraph, host, requestKey, viewKey, provider, text }: ActionProps) {
  const panelId = useId()
  const subscribe = useCallback((listener: () => void) => requests.subscribe(listener), [requests])
  const status = useSyncExternalStore(subscribe, () => requests.status(requestKey))
  const open = useSyncExternalStore(subscribe, () => requests.isExpanded(viewKey))
  useEffect(() => requests.retain(requestKey), [requests, requestKey])
  // A row that returns after virtualization resumes a translation the reader already asked for.
  useEffect(() => {
    if (open && status.state === 'idle') requests.request(requestKey)
  }, [open, status.state, requests, requestKey])
  const panelHost = usePanelHost(paragraph.element, open && status.state !== 'idle')
  const disclosure = format(text.disclosure, provider)
  const label = status.state === 'done' ? (open ? text.hide : text.show) : text.translate
  const activate = () => {
    if (status.state === 'done' || status.state === 'pending') {
      requests.setExpanded(viewKey, !open)
      return
    }
    requests.setExpanded(viewKey, true)
    requests.request(requestKey)
  }
  return (
    <>
      {createPortal(
        <Tooltip label={status.state === 'done' ? label : `${label} · ${disclosure}`} side="top" portal>
          <button
            type="button"
            className="dsh-answer-translation-trigger"
            aria-label={status.state === 'done' ? label : `${label}${text.separator}${disclosure}`}
            aria-expanded={open && status.state !== 'idle'}
            aria-controls={panelHost ? panelId : undefined}
            aria-busy={status.state === 'pending' || undefined}
            data-active={open || undefined}
            onClick={activate}
          >
            {status.state === 'pending' ? (
              <IconLoadingOutlineRegular size={14} className="dsh-answer-translation-spin" />
            ) : (
              <IconLanguagesOutlineRegular />
            )}
          </button>
        </Tooltip>,
        host
      )}
      {panelHost &&
        createPortal(
          <div id={panelId} className="dsh-answer-translation-panel" data-state={status.state}>
            {status.state === 'pending' && <p role="status">{text.translating}</p>}
            {status.state === 'failed' && (
              <div className="dsh-answer-translation-row" role="alert">
                <span>{text.failed}</span>
                <Button size="sm" variant="ghost" onClick={() => requests.request(requestKey)}>
                  {text.retry}
                </Button>
              </div>
            )}
            {status.state === 'done' && (
              <>
                <p className="dsh-answer-translation-text">
                  <Translation text={status.text} atoms={paragraph.atoms} />
                </p>
                <p className="dsh-answer-translation-source">{format(text.translatedBy, provider)}</p>
              </>
            )}
          </div>,
          panelHost
        )}
    </>
  )
}

interface Mounted {
  paragraph: Paragraph
  host: HTMLElement
}

/** Place the action at the end of the paragraph's own inline text, before its panel and sublists. */
function placeTrigger(paragraph: HTMLElement, host: HTMLElement) {
  let before: ChildNode | null = paragraph.tagName === 'LI' ? firstBlockChild(paragraph) : null
  const previous = before ? before.previousSibling : paragraph.lastChild
  if (previous instanceof Element && previous.getAttribute(OWN) === 'panel') before = previous
  if (host.parentNode === paragraph && host.nextSibling === before) return
  paragraph.insertBefore(host, before)
}

function same(a: readonly Mounted[], b: readonly Mounted[]) {
  return (
    a.length === b.length &&
    a.every(
      (item, index) =>
        item.host === b[index]!.host &&
        item.paragraph.element === b[index]!.paragraph.element &&
        item.paragraph.text === b[index]!.paragraph.text
    )
  )
}

function createWrapper(Original: SlotComponent<AssistantProps>, shared: Shared) {
  function AnswerTranslation(props: AssistantProps) {
    const { node, sessionId } = props
    const messageId = node.data.status === 'settled' ? node.data.finalNode?.messageId : undefined
    const snapshot = useSyncExternalStore(shared.settings.subscribe, shared.settings.get)
    const { active } = useLocaleSnapshot(shared.ctx.locale)
    const text = localizedCopy(copy, active)
    const provider = snapshot?.preferences.provider
    const target = snapshot?.preferences.targetLanguage === 'auto' ? active : snapshot?.preferences.targetLanguage
    const usable =
      messageId !== undefined &&
      snapshot !== undefined &&
      target !== undefined &&
      provider !== undefined &&
      snapshot.availableProviders.includes(provider)
    const marker = useRef<HTMLSpanElement>(null)
    const hosts = useRef(new Map<HTMLElement, HTMLElement>())
    const [mounted, setMounted] = useState<readonly Mounted[]>([])
    useLayoutEffect(() => {
      const owner = marker.current?.parentElement
      const known = hosts.current
      const clear = () => {
        for (const host of known.values()) host.remove()
        known.clear()
        setMounted([])
      }
      if (!usable || !owner) return clear
      let frame = 0
      const sync = () => {
        frame = 0
        const scope = marker.current?.nextElementSibling
        const paragraphs = scope
          ? collectParagraphs(scope).filter(
              (paragraph) => paragraph.text.length <= snapshot.maxTextChars && isForeign(prose(paragraph.text), target)
            )
          : []
        const next: Mounted[] = []
        for (const paragraph of paragraphs) {
          let host = known.get(paragraph.element)
          if (!host) {
            host = document.createElement('span')
            host.setAttribute(OWN, 'action')
            host.contentEditable = 'false'
            known.set(paragraph.element, host)
          }
          placeTrigger(paragraph.element, host)
          next.push({ paragraph, host })
        }
        for (const [element, host] of known) {
          if (next.some((item) => item.paragraph.element === element)) continue
          host.remove()
          known.delete(element)
        }
        setMounted((previous) => (same(previous, next) ? previous : next))
      }
      sync()
      const observer = new MutationObserver((records) => {
        // Portal renders and panel moves are ours; only native Markdown changes need a rescan.
        const ours = (node: Node) =>
          (node instanceof Element ? node : node.parentElement)?.closest(`[${OWN}]`) != null ||
          (node instanceof Element && node.hasAttribute(OWN))
        const native = records.some((record) =>
          record.type === 'characterData'
            ? !ours(record.target)
            : !ours(record.target) && ![...record.addedNodes, ...record.removedNodes].every(ours)
        )
        if (!native) return
        if (!frame) frame = requestAnimationFrame(sync)
      })
      observer.observe(owner, { childList: true, subtree: true, characterData: true })
      return () => {
        observer.disconnect()
        cancelAnimationFrame(frame)
        clear()
      }
    }, [usable, snapshot, target])
    const providerName = provider ? (providerNames[provider] ?? provider) : ''
    return (
      <>
        <span ref={marker} hidden data-answer-translation-marker="" />
        <Original {...props} />
        {usable &&
          mounted.map(({ paragraph, host }) => (
            <ParagraphAction
              key={paragraph.index}
              shared={shared}
              paragraph={paragraph}
              host={host}
              requestKey={JSON.stringify([sessionId, provider, target, paragraph.text])}
              // A new provider or language needs a new activation before any text is sent.
              viewKey={JSON.stringify([sessionId, messageId, paragraph.index, provider, target])}
              provider={providerName}
              text={text}
            />
          ))}
      </>
    )
  }
  return AnswerTranslation
}

/** Accepted preferences and limits from the official Remote, refreshed whenever the Host may change them. */
async function createSettings(ctx: Context, lifetime: AbortSignal) {
  let snapshot: CotTranslationSnapshot | undefined
  let revision = 0
  let accepted = -1
  let reading: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const refresh = (): Promise<void> =>
    (reading ??= (async () => {
      try {
        while (accepted !== revision && !lifetime.aborted) {
          const observed = revision
          const result = await ctx.remote.cotTranslation.limits(lifetime)
          if (lifetime.aborted) return
          if (observed !== revision) continue
          if (!result.ok) throw result.error
          snapshot = result.value
          accepted = observed
          for (const listener of listeners) listener()
        }
      } catch {
        if (!lifetime.aborted) ctx.logger.warn('answer-translation: could not read translation preferences')
      } finally {
        reading = undefined
      }
    })())
  const invalidate = () => {
    revision += 1
    void refresh()
  }
  ctx.effect(() => [
    ctx.remote.$on('settings/document-updated', invalidate),
    ctx.remote.$on('llm/adapters-updated', invalidate),
    // The official DeepSeek account plugin declares these; paid providers become available or unavailable.
    ...(['deepseek-account/session-expired', 'deepseek-account/model-sign-in-required'] as never[]).map((event) =>
      ctx.remote.$on(event, invalidate)
    ),
    ctx.remote.$on('credentials/record-updated', invalidate),
    ctx.remote.$on('credentials/reference-updated', invalidate),
  ])
  ctx.on('connection/reset', invalidate)
  await refresh()
  const settings: Settings = {
    get: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
  /** Send one paragraph only while it still matches the accepted provider, language, and limit. */
  const translate = async (key: string, signal: AbortSignal) => {
    const [sessionId, provider, targetLanguage, text] = JSON.parse(key) as [
      SessionId,
      TranslationProvider,
      string,
      string,
    ]
    if (accepted !== revision) await refresh()
    signal.throwIfAborted()
    const preferences = snapshot?.preferences
    if (
      !snapshot ||
      !preferences ||
      accepted !== revision ||
      preferences.provider !== provider ||
      (preferences.targetLanguage !== 'auto' && preferences.targetLanguage !== targetLanguage) ||
      text.length > snapshot.maxTextChars
    )
      throw new Error('Translation preferences or limits changed')
    const result = await ctx.remote.cotTranslation.translate(
      { text, provider, targetLanguage, sessionId },
      AbortSignal.any([signal, lifetime])
    )
    if (!result.ok) throw result.error
    return result.value
  }
  return { settings, translate }
}

async function mount(ctx: Context) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'answer-translation: queries')
  const { settings, translate } = await createSettings(ctx, lifetime.signal)
  if (lifetime.signal.aborted) return
  const requests = new TranslationRequests(translate)
  ctx.effect(() => () => requests.dispose(), 'answer-translation: requests')
  const shared: Shared = { ctx, settings, requests }
  const slot = 'conversation.chat.node'
  ctx.slots.inject(slot, () => {
    const originals = new Map<StoredEntry, { original: unknown; wrapper: unknown }>()
    const refreshOutlet = () => null
    const sync = () => {
      const entries = ctx.slots.entries(slot).filter((entry) => entry.options.key === 'assistant-step')
      for (const entry of originals.keys()) {
        if (!entries.includes(entry)) originals.delete(entry)
      }
      for (const entry of entries) {
        if (originals.has(entry)) continue
        const wrapper = createWrapper(entry.component as SlotComponent<AssistantProps>, shared)
        // Keep the original entry's child-slot authorization, hooks, and locale.
        originals.set(entry, { original: entry.component, wrapper })
        entry.component = wrapper
      }
    }
    const unsubscribe = ctx.slots.subscribe(slot, sync)
    // A dormant key no node uses re-renders mounted rows when the plugin is enabled or disabled.
    const disposeRefresh = ctx.slots.register(
      { name: slot, key: 'dungsil-answer-translation' as 'assistant-step' },
      refreshOutlet as never
    )
    sync()
    return () => {
      unsubscribe()
      for (const [entry, { original, wrapper }] of originals) {
        if (entry.component === wrapper) entry.component = original
      }
      originals.clear()
      disposeRefresh()
    }
  })
}

export function apply(ctx: Context) {
  ctx.effect(() => installStyles(STYLES), 'answer-translation: styles')
  // Without the official translation Remote, answers render exactly as before.
  ctx.inject(['remote.cotTranslation'], (child) => mount(child))
}
