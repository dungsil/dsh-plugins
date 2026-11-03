import type { Placement, Section } from './inbox.js'

/** Section copy resolved at render time so a language switch relabels live DOM. */
export interface HeadingLabels {
  working: string
  archived: string
}

/** Sections rendered as sticky footers, each heading folding its own rows. */
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
  const trees = new Set<HTMLElement>()
  const wrappers = new Set<HTMLElement>()
  /** Each footer opens independently; a reload resets to these defaults. */
  const open: Record<FooterSection, boolean> = { Working: true, Archived: false }
  const style = document.createElement('style')
  style.textContent = `
    [data-dsh-inbox-tree] { display: flex; flex-direction: column; padding-bottom: 0; interpolate-size: allow-keywords; }
    [data-dsh-inbox-tree] > * { flex: none; }
    [data-dsh-inbox-tree] ~ span { display: none; }
    [data-dsh-inbox-footer] {
      position: sticky; z-index: 1; background: var(--dsw-specific-sidebar-fill);
      bottom: var(--dsh-inbox-bottom, 0px);
    }
    [data-dsh-inbox-first] { margin-top: auto !important; }
    /* Closed rows keep their box at zero height, so a heading press animates in
       both directions without moving or cloning React-owned rows. */
    [data-dsh-inbox-footer] > [data-row-key] {
      overflow: hidden;
      transition: height 180ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 140ms ease-out, visibility 0s;
    }
    [data-dsh-inbox-closed] > [data-row-key] {
      height: 0; opacity: 0; visibility: hidden;
      transition: height 160ms cubic-bezier(0.4, 0, 1, 1), opacity 120ms ease-in, visibility 0s 160ms;
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
      display: block; width: 100%; padding: 0; border: 0; background: none;
      color: inherit; font: inherit; text-align: left; cursor: pointer;
    }
    [data-dsh-inbox-heading] button::before { content: '▸'; display: inline-block; width: 16px; }
    [data-dsh-inbox-heading] button[aria-expanded="true"]::before { content: '▾'; }
  `
  document.head.append(style)
  const clearWrapper = (wrapper: HTMLElement) => {
    delete wrapper.dataset.dshInboxFooter
    delete wrapper.dataset.dshInboxFirst
    delete wrapper.dataset.dshInboxClosed
    wrapper.style.removeProperty('--dsh-inbox-bottom')
  }
  const positionFooters = () => {
    for (const tree of trees) {
      let bottom = 0
      const footers = [...tree.querySelectorAll<HTMLElement>('[data-dsh-inbox-footer]')]
      for (const wrapper of footers.reverse()) {
        wrapper.style.setProperty('--dsh-inbox-bottom', `${bottom}px`)
        // A row inside a closing section shrinks through this measurement.
        const height = wrapper.offsetHeight
        if (height > 0) bottom += height + 2
      }
    }
  }
  const resize = new ResizeObserver(positionFooters)
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
      for (const tree of trees) delete tree.dataset.dshInboxTree
      trees.clear()
      for (const wrapper of wrappers) clearWrapper(wrapper)
      wrappers.clear()
      if (!active()) {
        // The native list owns the order: no footer styles, no headings.
        for (const [wrapper, heading] of headings) {
          heading.remove()
          headings.delete(wrapper)
        }
        return
      }
      for (const tree of document.querySelectorAll<HTMLElement>('[role="tree"]')) {
        // Workspace trees and content-search results retain their native grouping.
        if (tree.querySelector('[data-row-key^="workspace:"]')) continue
        let previous: FooterSection | undefined
        let firstFooter = true
        for (const row of tree.querySelectorAll<HTMLElement>('[data-row-key^="session:"]')) {
          const placement = placements().get(row.dataset.rowKey!.slice('session:'.length))
          if (placement?.blank) continue
          const section = placement?.section
          const wrapper = row.parentElement
          if (!section || !wrapper || wrapper.parentElement !== tree) continue
          // Archived rows join the sticky bottom only in the mixed view. The
          // archived-only view is the whole list, so folding it would hide everything.
          if (section !== 'Working' && !(section === 'Archived' && foldable)) continue
          trees.add(tree)
          tree.dataset.dshInboxTree = ''
          wrappers.add(wrapper)
          wrapper.dataset.dshInboxFooter = ''
          if (firstFooter) wrapper.dataset.dshInboxFirst = ''
          firstFooter = false
          if (section !== previous) wanted.set(wrapper, section)
          if (!open[section]) wrapper.dataset.dshInboxClosed = ''
          previous = section
          resize.observe(wrapper)
        }
        if (trees.has(tree)) resize.observe(tree)
      }
      for (const [wrapper, heading] of headings) {
        if (!wanted.has(wrapper)) {
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
          heading.textContent = ''
          heading.dataset.dshInboxSection = section
        }
        let button = heading.querySelector('button')
        if (!button) {
          button = document.createElement('button')
          button.type = 'button'
          button.onclick = (event) => {
            event.stopPropagation()
            const current = heading.dataset.dshInboxSection
            if (current !== 'Working' && current !== 'Archived') return
            open[current] = !open[current]
            refresh()
          }
          heading.append(button)
        }
        // Only write changed copy: an unconditional textContent write emits a
        // childList mutation that would re-trigger this refresh forever.
        const text = section === 'Archived' ? labels().archived : labels().working
        if (button.textContent !== text) button.textContent = text
        button.setAttribute('aria-label', text)
        button.setAttribute('aria-expanded', String(open[section]))
        if (wrapper.firstChild !== heading) wrapper.prepend(heading)
      }
      positionFooters()
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
      for (const heading of headings.values()) heading.remove()
      headings.clear()
      for (const tree of trees) delete tree.dataset.dshInboxTree
      for (const wrapper of wrappers) clearWrapper(wrapper)
      style.remove()
    },
  }
}
