/**
 * Add one row to the native View Options menu without forking ui-workspace.
 *
 * DSH 0.2.x renders that menu from a hardcoded item list and exposes no slot,
 * so the row is injected into the portaled menu DOM. The menu primitive walks
 * `button[role="menuitem"]` nodes for its keyboard order, so an injected row
 * joins the arrow/Tab walk for free; activation closes the menu through the
 * same Escape path the primitive already handles, which also returns focus to
 * the trigger. Only classes and spans are read from the native rows, so the
 * injected row keeps the shipped styling without naming any hashed class.
 */

import { activityIconPath, checkIconPath, createIconGlyph } from '@dungsil/dsh-ui/icons/dom'

/** Localized copy and state read at render time by the injected row. */
export interface SortOption {
  /** Row label; read on every refresh so a live language switch relabels. */
  label(): string
  /** Whether the plugin's sort mode is the active one. */
  isActive(): boolean
  /** Whether the row can be used in the current native view (disabled otherwise). */
  isEnabled(): boolean
  /** Activate or leave the plugin's sort mode. */
  onToggle(): void
}

/** Lifecycle handle: `refresh` re-reads label/state, `dispose` removes the row. */
export interface SortOptionHandle {
  refresh(): void
  dispose(): void
}

/** ui-workspace passes this CSS-module class to the View Options menu only. */
const MENU_SELECTOR = '[role="menu"][class*="viewOptionsMenu"]'
/** Marker on the injected wrapper so refreshes recognize their own node. */
const ROW_ATTRIBUTE = 'data-dsh-inbox-sort-item'

/** A native row wraps one `role="menuitem"` button, optionally after a group separator. */
function isMenuRow(node: Element): node is HTMLElement {
  return (
    node.tagName === 'DIV' &&
    [...node.children].some((child) => child.tagName === 'BUTTON' && child.getAttribute('role') === 'menuitem')
  )
}

/** The scrolling items card; the footer presentation div has no rows. */
function findViewport(menu: Element): HTMLElement | undefined {
  for (const child of menu.children) {
    if (child.getAttribute('role') === 'presentation' && child.querySelector('button[role="menuitem"]') !== null)
      return child as HTMLElement
  }
  return undefined
}

/**
 * The last row of the native Sort by group: the "Last updated" row. The group
 * starts after the second heading row (the Sort by label) and ends at the next
 * separator, so a later DSH release may add sort rows without moving the slot.
 */
function sortGroupAnchor(viewport: HTMLElement): HTMLElement | undefined {
  const children = [...viewport.children]
  const labels = children.filter(
    (child) => child.getAttribute('role') === 'presentation' && child.textContent?.trim() !== ''
  )
  const sortLabel = labels[1]
  if (sortLabel === undefined) return undefined
  let anchor: HTMLElement | undefined
  for (const child of children.slice(children.indexOf(sortLabel) + 1)) {
    if (isMenuRow(child)) {
      // The plugin's own row sits in this group after the first insert; it must
      // not become the anchor or every refresh would move it onto itself.
      if (!child.hasAttribute(ROW_ATTRIBUTE)) anchor = child
      continue
    }
    if (anchor !== undefined) break
  }
  return anchor
}

/** Clone the trailing check of a selected native row so the mark keeps its styling. */
function readCheckTemplate(menu: Element): Element | null {
  return menu.querySelector('button[role="menuitem"] > svg')
}

function buildRow(
  anchor: HTMLElement,
  options: SortOption
): { row: HTMLElement; label: HTMLElement; button: HTMLElement } {
  const template = [...anchor.children].find(
    (child) => child.tagName === 'BUTTON' && child.getAttribute('role') === 'menuitem'
  ) as HTMLElement
  const row = document.createElement('div')
  row.className = anchor.className
  row.setAttribute(ROW_ATTRIBUTE, '')
  const button = document.createElement('button')
  button.type = 'button'
  button.setAttribute('role', 'menuitem')
  button.className = template.className
  const iconTemplate = [...template.children].find(
    (child) => child.tagName === 'SPAN' && child.querySelector('svg') !== null
  )
  if (iconTemplate !== undefined) {
    const icon = document.createElement('span')
    icon.className = iconTemplate.className
    icon.append(createIconGlyph(activityIconPath))
    button.append(icon)
  }
  const labelTemplate = [...template.children].find(
    (child) => child.tagName === 'SPAN' && child.querySelector('svg') === null && !child.hasAttribute('aria-hidden')
  )
  const label = document.createElement('span')
  label.className = labelTemplate?.className ?? ''
  label.textContent = options.label()
  button.append(label)
  button.addEventListener('click', (event) => {
    event.preventDefault()
    // Disabled rows are excluded from the native keyboard walk; this guard also
    // covers a synthetic click.
    if (!options.isEnabled()) return
    // Let the native list's click handler run: it returns focus to the menu
    // trigger after the rows disappear, which covers pointer paths where the
    // click did not focus our row.
    options.onToggle()
    closeMenu()
  })
  row.append(button)
  return { row, label, button }
}

/** Close the native menu through its own Escape path so focus returns to the trigger. */
function closeMenu() {
  const Keyboard = document.defaultView?.KeyboardEvent
  if (Keyboard === undefined) return
  document.dispatchEvent(new Keyboard('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
}

function syncCheck(button: HTMLElement, active: boolean, check: Element | null) {
  const existing = [...button.children].find((child) => child.tagName === 'svg')
  if (active && existing === undefined)
    button.append(check === null ? createIconGlyph(checkIconPath) : check.cloneNode(true))
  else if (!active && existing !== undefined) existing.remove()
  if (active) button.setAttribute('aria-current', 'true')
  else button.removeAttribute('aria-current')
}

/** Mirror the native row's disabled contract: no pointer, no keyboard walk, dimmed. */
function syncEnabled(button: HTMLElement, enabled: boolean) {
  const control = button as HTMLButtonElement
  if (control.disabled === !enabled) return
  control.disabled = !enabled
}

/** Observe the portaled menu and keep one plugin row in its Sort by group. */
export function installSortOption(options: SortOption): SortOptionHandle {
  let row: HTMLElement | undefined
  let label: HTMLElement | undefined
  let button: HTMLElement | undefined
  let check: Element | null = null
  let scheduled = false
  let disposed = false

  const detach = () => {
    row?.remove()
    row = undefined
    label = undefined
    button = undefined
  }

  const refresh = () => {
    if (disposed) return
    const menu = document.querySelector<HTMLElement>(MENU_SELECTOR)
    if (menu === null) {
      detach()
      return
    }
    const viewport = findViewport(menu)
    const anchor = viewport === undefined ? undefined : sortGroupAnchor(viewport)
    if (viewport === undefined || anchor === undefined) {
      detach()
      return
    }
    check ??= readCheckTemplate(menu)
    if (row === undefined || !row.isConnected || row.parentElement !== viewport) {
      detach()
      const built = buildRow(anchor, options)
      anchor.after(built.row)
      row = built.row
      label = built.label
      button = built.button
    } else if (row.previousElementSibling !== anchor) {
      anchor.after(row)
    }
    const text = options.label()
    if (label !== undefined && label.textContent !== text) label.textContent = text
    if (button !== undefined) {
      syncCheck(button, options.isActive(), check)
      syncEnabled(button, options.isEnabled())
    }
  }

  const schedule = () => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      refresh()
    })
  }

  const touchesMenu = (record: MutationRecord) => {
    if (record.target instanceof Element && record.target.closest(MENU_SELECTOR) !== null) return true
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (node instanceof Element && (node.matches(MENU_SELECTOR) || node.querySelector(MENU_SELECTOR) !== null))
        return true
    }
    return false
  }

  const observer = new MutationObserver((records) => {
    if (records.some(touchesMenu)) schedule()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  refresh()

  return {
    refresh,
    dispose() {
      disposed = true
      observer.disconnect()
      detach()
      check = null
    },
  }
}
