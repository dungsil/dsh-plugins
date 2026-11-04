import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { IconChevronDownOutlineRegular, IconChevronRightOutlineRegular } from '@dungsil/dsh-ui/icons'
import type { Placement, Section } from './inbox.js'

/** Section copy resolved at render time so a language switch relabels live DOM. */
export interface HeadingLabels {
  working: string
  archived: string
}

/** Footer sections have separate controls to open or close their rows. */
type FooterSection = Extract<Section, 'Working' | 'Archived'>

/**
 * Add labels without moving, cloning or replacing any React-owned row.
 * @param placements - current section placement per session id.
 * @param labels - section copy for the current UI language.
 * @param archivedCollapsible - whether archived rows are mixed into this list and
 * should fold into the bottom, i.e. the archived-inclusive view is selected.
 * @param active - whether the plugin's sort mode owns the row order; an inactive
 * mode strips every injected label and footer style so the native list is left
 * exactly as its own view options render it.
 */
export function installHeadings(
  placements: () => ReadonlyMap<string, Placement>,
  labels: () => HeadingLabels,
  archivedCollapsible: () => boolean,
  active: () => boolean = () => true
) {
  const headings = new Map<HTMLElement, HTMLSpanElement>()
  const icons = new Map<HTMLSpanElement, Root>()
  const trees = new Set<HTMLElement>()
  const wrappers = new Set<HTMLElement>()
  const originalSlots = new Map<HTMLElement, string | null>()
  const panes = new Map<HTMLElement, { root: ShadowRoot; footer: HTMLElement }>()
  const archiveAnimations = new Map<HTMLElement, () => void>()
  /** Each footer opens independently; a reload resets to these defaults. */
  const open: Record<FooterSection, boolean> = { Working: true, Archived: false }
  const style = document.createElement('style')
  style.textContent = `
    [data-dsh-inbox-tree] {
      display: flex; flex-direction: column; padding-bottom: 0;
      overflow: hidden; scrollbar-gutter: auto; interpolate-size: allow-keywords;
    }
    [data-dsh-inbox-tree] > * { flex: none; }
    [data-dsh-inbox-tree] ~ span { display: none; }
    [data-dsh-inbox-footer] { background: var(--dsw-specific-sidebar-fill); }
    [data-dsh-inbox-first] { margin-top: 0 !important; }
    /* Closed rows keep their box at zero height, so a heading press animates in
       both directions without moving or cloning React-owned rows. */
    [data-dsh-inbox-footer] > [data-row-key] {
      overflow: hidden;
      transition: height 320ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease-out, visibility 0s;
    }
    [data-dsh-inbox-footer="Archived"] > [data-row-key] {
      transition: height 480ms cubic-bezier(0.4, 0, 0.2, 1), opacity 280ms ease-in-out, visibility 0s;
    }
    [data-dsh-inbox-closed] > [data-row-key] {
      height: 0; opacity: 0; visibility: hidden;
      transition: height 260ms cubic-bezier(0.4, 0, 1, 1), opacity 180ms ease-in, visibility 0s 260ms;
    }
    @media (prefers-reduced-motion: reduce) {
      [data-dsh-inbox-footer] > [data-row-key],
      [data-dsh-inbox-closed] > [data-row-key] { transition: none; }
    }
    /* Collapsed wrappers must not add list margins: their rows already have no
       height, and the leftover row gaps alone can overflow the list. */
    [data-dsh-inbox-tree] > [data-dsh-inbox-closed]:not([data-dsh-inbox-first]) { margin-top: 0; }
    [data-dsh-inbox-heading] {
      display: block; padding: 12px 8px 4px; font-size: 12px; line-height: 20px;
      color: var(--dsw-alias-label-tertiary); font-weight: 500;
    }
    [data-dsh-inbox-heading] button {
      display: flex; align-items: center; width: 100%; padding: 0; border: 0; background: none;
      color: inherit; font: inherit; text-align: start; cursor: pointer;
    }
    [data-dsh-inbox-heading] button > span:first-child { display: flex; flex: 0 0 16px; }
  `
  document.head.append(style)
  const clearWrapper = (wrapper: HTMLElement) => {
    delete wrapper.dataset.dshInboxFooter
    delete wrapper.dataset.dshInboxFirst
    delete wrapper.dataset.dshInboxClosed
    if (originalSlots.has(wrapper)) {
      const slot = originalSlots.get(wrapper)!
      if (slot === null) wrapper.removeAttribute('slot')
      else wrapper.setAttribute('slot', slot)
      originalSlots.delete(wrapper)
    }
  }
  const releasePane = (tree: HTMLElement) => {
    archiveAnimations.get(tree)?.()
    const pane = panes.get(tree)
    if (!pane) return
    // A shadow root cannot detach. A default slot restores the native layout.
    const slot = document.createElement('slot')
    slot.dataset.dshInboxNative = ''
    pane.root.replaceChildren(slot)
    panes.delete(tree)
  }
  const installPane = (tree: HTMLElement) => {
    if (panes.has(tree)) return
    // Slots keep the native rows under their React-owned parents.
    const root = tree.shadowRoot ?? tree.attachShadow({ mode: 'open' })
    const sheet = document.createElement('style')
    sheet.textContent = `
      slot { display: contents; }
      .pane {
        box-sizing: border-box; min-inline-size: 0; min-block-size: 0;
        overflow: auto; overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }
      @supports not selector(::-webkit-scrollbar) {
        .pane { scrollbar-width: thin; scrollbar-color: var(--dsh-scrollbar-thumb) transparent; }
      }
      ::-webkit-scrollbar { width: var(--dsh-scrollbar-width); height: var(--dsh-scrollbar-width); }
      ::-webkit-scrollbar-track { margin-block: var(--dsh-scrollbar-track-margin); background: transparent; }
      ::-webkit-scrollbar-thumb {
        border: var(--dsh-scrollbar-thumb-border) solid transparent; corner-shape: round;
        background: var(--dsh-scrollbar-thumb); background-clip: content-box; border-radius: 999px;
      }
      ::-webkit-scrollbar-thumb:hover { background-color: var(--dsh-scrollbar-thumb-hover); }
      ::-webkit-scrollbar-corner { background: transparent; }
      .main { flex: 1; }
      .footer { flex: none; max-block-size: 50%; }
      @media (prefers-reduced-motion: reduce) { .footer { transition: none !important; } }
      ::slotted(*) { display: block; }
    `
    const main = document.createElement('div')
    main.className = 'pane main'
    main.append(document.createElement('slot'))
    const footer = document.createElement('div')
    footer.className = 'pane footer'
    footer.dataset.dshInboxPane = ''
    const slot = document.createElement('slot')
    slot.name = 'dsh-inbox-footer'
    footer.append(slot)
    // Shadow scroll events do not reach the native portal position listeners.
    const notifyScroll = () => tree.dispatchEvent(new Event('scroll'))
    main.addEventListener('scroll', notifyScroll)
    footer.addEventListener('scroll', notifyScroll)
    root.replaceChildren(sheet, main, footer)
    panes.set(tree, { root, footer })
  }
  const sizeFooters = () => {
    for (const [tree, { footer }] of panes) {
      footer.style.maxBlockSize = `${tree.clientHeight / 2}px`
    }
  }
  const animateArchive = (tree: HTMLElement, from: number) => {
    archiveAnimations.get(tree)?.()
    const footer = panes.get(tree)?.footer
    if (!footer || tree.clientHeight === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let naturalHeight = 0
    for (const wrapper of wrappers) {
      if (wrapper.parentElement !== tree) continue
      const row = wrapper.querySelector<HTMLElement>('[data-row-key]')
      const margins = getComputedStyle(wrapper)
      naturalHeight +=
        (headings.get(wrapper)?.offsetHeight ?? 0) +
        (wrapper.hasAttribute('data-dsh-inbox-closed') ? 0 : (row?.scrollHeight ?? 0)) +
        (Number.parseFloat(margins.marginTop) || 0) +
        (Number.parseFloat(margins.marginBottom) || 0)
    }
    const target = Math.min(naturalHeight, tree.clientHeight / 2)
    if (Math.abs(target - from) < 0.5) return
    const duration = open.Archived ? 480 : 260
    footer.style.transition = 'none'
    footer.style.height = `${from}px`
    footer.getBoundingClientRect()
    footer.style.transition = `height ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`
    footer.style.height = `${target}px`
    const finish = () => {
      clearTimeout(timeout)
      footer.removeEventListener('transitionend', onEnd)
      footer.style.removeProperty('height')
      footer.style.removeProperty('transition')
      archiveAnimations.delete(tree)
    }
    const onEnd = (event: TransitionEvent) => {
      if (event.target === footer && event.propertyName === 'height') finish()
    }
    const timeout = setTimeout(finish, duration + 100)
    footer.addEventListener('transitionend', onEnd)
    archiveAnimations.set(tree, finish)
  }
  const resize = new ResizeObserver(sizeFooters)
  let scheduled = false
  let disposed = false
  const refresh = () => {
    if (scheduled || disposed) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (disposed) return
      const wanted = new Map<HTMLElement, FooterSection>()
      const foldable = archivedCollapsible()
      resize.disconnect()
      for (const tree of trees) {
        delete tree.dataset.dshInboxTree
      }
      trees.clear()
      for (const wrapper of wrappers) clearWrapper(wrapper)
      wrappers.clear()
      if (!active()) {
        for (const tree of panes.keys()) releasePane(tree)
        // The native list owns the order: no footer styles, no headings.
        for (const [wrapper, heading] of headings) {
          icons.get(heading)?.unmount()
          icons.delete(heading)
          heading.remove()
          headings.delete(wrapper)
        }
        return
      }
      for (const tree of document.querySelectorAll<HTMLElement>('[role="tree"]')) {
        // Workspace trees and content-search results retain their native grouping.
        if (tree.querySelector('[data-row-key^="workspace:"]')) continue
        if (tree.shadowRoot && !panes.has(tree) && !tree.shadowRoot.querySelector('[data-dsh-inbox-native]')) continue
        if ([...tree.children].some((child) => child.getAttribute('slot'))) continue
        let previous: FooterSection | undefined
        let firstFooter = true
        for (const row of tree.querySelectorAll<HTMLElement>('[data-row-key^="session:"]')) {
          const placement = placements().get(row.dataset.rowKey!.slice('session:'.length))
          if (placement?.blank) continue
          const section = placement?.section
          const wrapper = row.parentElement
          if (!section || !wrapper || wrapper.parentElement !== tree) continue
          // Archived rows share the footer only in the mixed view.
          // The archived-only view keeps all rows in the main list.
          if (section !== 'Working' && !(section === 'Archived' && foldable)) continue
          trees.add(tree)
          tree.dataset.dshInboxTree = ''
          wrappers.add(wrapper)
          originalSlots.set(wrapper, wrapper.getAttribute('slot'))
          wrapper.slot = 'dsh-inbox-footer'
          wrapper.dataset.dshInboxFooter = section
          if (firstFooter) wrapper.dataset.dshInboxFirst = ''
          firstFooter = false
          if (section !== previous) wanted.set(wrapper, section)
          if (!open[section]) wrapper.dataset.dshInboxClosed = ''
          previous = section
        }
        if (trees.has(tree)) {
          installPane(tree)
          resize.observe(tree)
        }
      }
      for (const tree of panes.keys()) {
        if (!trees.has(tree)) releasePane(tree)
      }
      for (const [wrapper, heading] of headings) {
        if (!wanted.has(wrapper)) {
          icons.get(heading)?.unmount()
          icons.delete(heading)
          heading.remove()
          headings.delete(wrapper)
        }
      }
      for (const [wrapper, section] of wanted) {
        let heading = headings.get(wrapper)
        if (!heading) {
          heading = document.createElement('span')
          heading.dataset.dshInboxHeading = ''
          heading.setAttribute('role', 'heading')
          heading.setAttribute('aria-level', '2')
          headings.set(wrapper, heading)
        }
        // A wrapper can cross sections when a session resumes or is archived.
        if (heading.dataset.dshInboxSection !== section) {
          icons.get(heading)?.unmount()
          icons.delete(heading)
          heading.textContent = ''
          heading.dataset.dshInboxSection = section
        }
        let button = heading.querySelector('button')
        if (!button) {
          button = document.createElement('button')
          button.type = 'button'
          const icon = document.createElement('span')
          icon.setAttribute('aria-hidden', 'true')
          icons.set(heading, createRoot(icon))
          button.append(icon, document.createElement('span'))
          button.onclick = (event) => {
            event.stopPropagation()
            const current = heading.dataset.dshInboxSection
            if (current !== 'Working' && current !== 'Archived') return
            const tree = wrapper.parentElement!
            const footer = panes.get(tree)?.footer
            const from = footer?.getBoundingClientRect().height ?? 0
            const animate = current === 'Archived' || archiveAnimations.has(tree)
            open[current] = !open[current]
            refresh()
            if (animate)
              queueMicrotask(() => {
                if (!disposed && panes.has(tree)) animateArchive(tree, from)
              })
          }
          heading.append(button)
        }
        // Only write changed copy: an unconditional textContent write emits a
        // childList mutation that would re-trigger this refresh forever.
        const text = section === 'Archived' ? labels().archived : labels().working
        const label = button.lastElementChild!
        if (label.textContent !== text) label.textContent = text
        button.setAttribute('aria-label', text)
        const expanded = String(open[section])
        if (button.getAttribute('aria-expanded') !== expanded) {
          button.setAttribute('aria-expanded', expanded)
          icons.get(heading)!.render(
            createElement(open[section] ? IconChevronDownOutlineRegular : IconChevronRightOutlineRegular, {
              size: 16,
            })
          )
        }
        if (wrapper.firstChild !== heading) wrapper.prepend(heading)
      }
      sizeFooters()
    })
  }
  const observer = new MutationObserver((records) => {
    // Conversation streaming also mutates the document. Only scan again when
    // a native navigation tree changes, mounts, or unmounts.
    if (
      records.some((record) => {
        if (record.target instanceof Element && record.target.closest('[role="tree"]')) return true
        return [...record.addedNodes, ...record.removedNodes].some(
          (node) => node instanceof Element && (node.matches('[role="tree"]') || node.querySelector('[role="tree"]'))
        )
      })
    )
      refresh()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  refresh()
  return {
    refresh,
    dispose() {
      disposed = true
      observer.disconnect()
      resize.disconnect()
      for (const root of icons.values()) root.unmount()
      icons.clear()
      for (const heading of headings.values()) heading.remove()
      headings.clear()
      for (const tree of trees) {
        delete tree.dataset.dshInboxTree
      }
      for (const wrapper of wrappers) clearWrapper(wrapper)
      for (const tree of panes.keys()) releasePane(tree)
      style.remove()
    },
  }
}
