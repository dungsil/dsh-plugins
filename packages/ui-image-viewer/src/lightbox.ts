import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IconChevronLeftOutlineRegular, IconChevronRightOutlineRegular } from '@dungsil/dsh-ui/icons'
import { NAV, conversationOpeners, isHistoryOpener, isOpener, lightboxParts } from './dom.js'

export interface NavigationLabels {
  previous: string
  next: string
}

type Direction = 'previous' | 'next'

interface Controls {
  previous: HTMLButtonElement
  next: HTMLButtonElement
  roots: Root[]
}

interface View {
  dialog: HTMLElement
  parts: NonNullable<ReturnType<typeof lightboxParts>>
  /** The thumbnail the user first opened; focus returns here once the preview closes. */
  origin: HTMLButtonElement
  /** The thumbnail whose image the open preview shows. */
  current: HTMLButtonElement
  controls: Controls | undefined
  navigated: boolean
}

/**
 * Add previous and next controls to the native image lightbox. Moving closes the native preview
 * with its own close control and opens the neighbouring thumbnail of the same conversation, so the
 * native preview keeps its image, context menu, Escape handling and focus restoration.
 * @param document - the document whose lightboxes are extended.
 * @param labels - control names for the current UI language.
 * @returns relabel for a language change, and teardown that removes every control.
 */
export function installLightboxNavigation(document: Document, labels: () => NavigationLabels) {
  const window = document.defaultView!
  let lastOpener: HTMLButtonElement | undefined
  /** Set between closing one preview and the native opening of the next. */
  let pending: { origin: HTMLButtonElement; target: HTMLButtonElement; focus: Direction | undefined } | undefined
  let view: View | undefined

  const neighbours = (current: HTMLButtonElement) => {
    const openers = conversationOpeners(current)
    const index = openers.indexOf(current)
    return { previous: index > 0 ? openers[index - 1] : undefined, next: index < 0 ? undefined : openers[index + 1] }
  }

  const refresh = () => {
    if (view?.controls === undefined) return
    const copy = labels()
    const around = neighbours(view.current)
    for (const direction of ['previous', 'next'] as const) {
      const button = view.controls[direction]
      button.setAttribute('aria-label', copy[direction])
      button.title = copy[direction]
      button.disabled = around[direction] === undefined
    }
  }

  const navigate = (direction: Direction, focus: boolean) => {
    if (view === undefined) return
    const target = neighbours(view.current)[direction]
    if (target === undefined) return refresh()
    const { origin, parts } = view
    pending = { origin, target, focus: focus ? direction : undefined }
    parts.close.click()
    // The next native preview restores focus to whatever is focused when it opens.
    if (origin.isConnected) origin.focus({ preventScroll: true })
    target.click()
  }

  const createControls = (stage: HTMLElement): Controls => {
    const roots: Root[] = []
    const control = (direction: Direction, icon: typeof IconChevronLeftOutlineRegular) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute(NAV, direction)
      button.setAttribute('aria-keyshortcuts', direction === 'previous' ? 'ArrowLeft' : 'ArrowRight')
      button.addEventListener('click', () => navigate(direction, true))
      const root = createRoot(button)
      root.render(createElement(icon, { size: 16 }))
      roots.push(root)
      stage.append(button)
      return button
    }
    stage.setAttribute(`${NAV}-stage`, '')
    return {
      previous: control('previous', IconChevronLeftOutlineRegular),
      next: control('next', IconChevronRightOutlineRegular),
      roots,
    }
  }

  const removeControls = (target: View) => {
    if (target.controls === undefined) return
    for (const root of target.controls.roots) root.unmount()
    target.controls.previous.remove()
    target.controls.next.remove()
    target.parts.stage.removeAttribute(`${NAV}-stage`)
    target.controls = undefined
  }

  const attach = (dialog: HTMLElement) => {
    const parts = lightboxParts(dialog)
    if (parts === undefined) return
    // A move only counts when its target is the thumbnail that just opened this preview.
    const next = pending !== undefined && pending.target === lastOpener ? pending : undefined
    const opener = lastOpener
    pending = undefined
    lastOpener = undefined
    if (view !== undefined) removeControls(view)
    view = undefined
    // Composer drafts and previews opened outside a conversation keep the plain native lightbox.
    if (opener === undefined || !opener.isConnected || !isHistoryOpener(opener)) return
    view = { dialog, parts, origin: next?.origin ?? opener, current: opener, controls: undefined, navigated: !!next }
    if (conversationOpeners(opener).length < 2) return
    view.controls = createControls(parts.stage)
    refresh()
    // Keep a keyboard user on the control they pressed; at either end the native close stays focused.
    if (next?.focus !== undefined && !view.controls[next.focus].disabled) view.controls[next.focus].focus()
  }

  const detach = (dialog: HTMLElement) => {
    if (view?.dialog !== dialog) return
    const closed = view
    removeControls(closed)
    view = undefined
    if (pending !== undefined) return
    // The native preview restores focus to the element focused when it opened. After moving
    // between images that is the original thumbnail; repeat it when that restore did not land.
    if (closed.navigated && closed.origin.isConnected && document.activeElement !== closed.origin) {
      closed.origin.focus()
    }
  }

  const onClick = (event: MouseEvent) => {
    const button = (event.target as Element | null)?.closest?.('button')
    if (button && isOpener(button)) lastOpener = button
  }

  // Registered before any preview opens, so it runs ahead of the native window listener.
  const onKeyDown = (event: KeyboardEvent) => {
    const controls = view?.controls
    if (view === undefined || controls === undefined || !view.dialog.isConnected) return
    // A portaled image menu owns its keys until it returns focus, as in the native preview.
    if (event.defaultPrevented || event.isComposing || document.activeElement?.closest('[role="menu"]')) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      navigate(event.key === 'ArrowLeft' ? 'previous' : 'next', false)
    } else if (event.key === 'Tab') {
      // The native preview pins Tab to its close control; cycle through the added controls too.
      const order = [controls.previous, view.parts.close, controls.next].filter((button) => !button.disabled)
      const index = order.indexOf(document.activeElement as HTMLButtonElement)
      const step = event.shiftKey ? -1 : 1
      const target = order[index < 0 ? 0 : (index + step + order.length) % order.length]!
      event.preventDefault()
      event.stopImmediatePropagation()
      target.focus()
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.removedNodes.forEach((node) => {
        if (node.nodeType === 1) detach(node as HTMLElement)
      })
      record.addedNodes.forEach((node) => {
        if (node.nodeType === 1) attach(node as HTMLElement)
      })
    }
  })
  observer.observe(document.body, { childList: true })
  document.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKeyDown, true)

  return {
    refresh,
    dispose() {
      observer.disconnect()
      document.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
      if (view !== undefined) removeControls(view)
      view = undefined
      pending = undefined
      lastOpener = undefined
    },
  }
}
