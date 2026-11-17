import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IconLoadingOutlineRegular } from '@dungsil/dsh-ui/icons'
import { LOADING, isHistoryOpener, lightboxParts } from './dom.js'

/** Fast and cached downloads settle before this, so they never flash an indicator. */
const SHOW_DELAY_MS = 150

interface Pending {
  host: HTMLElement
  timer: ReturnType<typeof setTimeout> | undefined
  indicator: { element: HTMLSpanElement; root: Root } | undefined
  /** Whether this plugin set `aria-busy`, so teardown never removes a native value. */
  busy: boolean
  settle: () => void
}

/**
 * Element that shows the indicator for `image`: its thumbnail button in a conversation history,
 * or the stage of a native lightbox. Composer drafts and every other image are left alone.
 */
function hostOf(image: HTMLImageElement): HTMLElement | undefined {
  const parent = image.parentElement
  if (parent === null) return undefined
  if (isHistoryOpener(parent)) return parent
  const dialog = parent.parentElement
  if (dialog !== null && lightboxParts(dialog)?.image === image) return parent
  return undefined
}

/**
 * Overlay a spinner on conversation thumbnails and lightbox images while their bytes download.
 * Native image nodes, URLs and handlers are untouched: the indicator is an inert sibling, and the
 * host only gains a marker attribute and, on thumbnails without one, `aria-busy`.
 * @param document - the document whose conversation images are watched.
 * @returns teardown that removes every indicator and stops watching.
 */
export function installImageLoading(document: Document) {
  const pending = new Map<HTMLImageElement, Pending>()

  const watch = (image: HTMLImageElement) => {
    // A native `src` swap on a watched image restarts its wait for the new bytes.
    pending.get(image)?.settle()
    if (image.complete) return
    const host = hostOf(image)
    if (host === undefined) return
    const entry: Pending = { host, timer: undefined, indicator: undefined, busy: false, settle: () => {} }
    entry.settle = () => {
      if (pending.get(image) !== entry) return
      pending.delete(image)
      clearTimeout(entry.timer)
      image.removeEventListener('load', entry.settle)
      image.removeEventListener('error', entry.settle)
      if (entry.indicator) {
        entry.indicator.root.unmount()
        entry.indicator.element.remove()
      }
      host.removeAttribute(LOADING)
      if (entry.busy) host.removeAttribute('aria-busy')
    }
    image.addEventListener('load', entry.settle)
    image.addEventListener('error', entry.settle)
    entry.timer = setTimeout(() => {
      if (image.complete) return entry.settle()
      const element = document.createElement('span')
      element.setAttribute(`${LOADING}-indicator`, '')
      element.setAttribute('aria-hidden', 'true')
      const root = createRoot(element)
      root.render(createElement(IconLoadingOutlineRegular, { size: 16 }))
      host.append(element)
      host.setAttribute(LOADING, '')
      if (host.tagName === 'BUTTON' && !host.hasAttribute('aria-busy')) {
        host.setAttribute('aria-busy', 'true')
        entry.busy = true
      }
      entry.indicator = { element, root }
    }, SHOW_DELAY_MS)
    pending.set(image, entry)
  }

  const scan = (node: Node) => {
    if (node.nodeType !== 1) return
    const element = node as Element
    if (element.tagName === 'IMG') watch(element as HTMLImageElement)
    for (const image of element.querySelectorAll('img')) watch(image)
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.nodeName === 'IMG') watch(record.target as HTMLImageElement)
        continue
      }
      record.addedNodes.forEach(scan)
      // A removed frame, message or lightbox drops its indicator with it.
      if (record.removedNodes.length > 0) {
        for (const [image, entry] of pending) if (!image.isConnected) entry.settle()
      }
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
  scan(document.body)

  return () => {
    observer.disconnect()
    for (const entry of pending.values()) entry.settle()
  }
}
