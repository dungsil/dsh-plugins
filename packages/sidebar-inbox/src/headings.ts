import type { Placement, Section } from './inbox.js'

/** Section copy resolved at render time so a language switch relabels live DOM. */
export interface HeadingLabels {
  working: string
  settled: string
}

/** Add labels without moving, cloning or replacing any React-owned row. */
export function installHeadings(placements: () => ReadonlyMap<string, Placement>, labels: () => HeadingLabels) {
  const headings = new Map<HTMLElement, HTMLSpanElement>()
  const trees = new Set<HTMLElement>()
  const wrappers = new Set<HTMLElement>()
  let settledOpen = false
  const style = document.createElement('style')
  style.textContent = `
    [data-dsh-inbox-tree] { display: flex; flex-direction: column; padding-bottom: 0; }
    [data-dsh-inbox-tree] > * { flex: none; }
    [data-dsh-inbox-tree] ~ span { display: none; }
    [data-dsh-inbox-footer] {
      position: sticky; z-index: 1; background: var(--dsw-specific-sidebar-fill);
      bottom: var(--dsh-inbox-bottom, 0px);
    }
    [data-dsh-inbox-first] { margin-top: auto !important; }
    [data-dsh-inbox-hidden] { display: none !important; }
    [data-dsh-inbox-collapsed] > :not([data-dsh-inbox-heading]) { display: none !important; }
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
    delete wrapper.dataset.dshInboxHidden
    delete wrapper.dataset.dshInboxCollapsed
    wrapper.style.removeProperty('--dsh-inbox-bottom')
  }
  const positionFooters = () => {
    for (const tree of trees) {
      let bottom = 0
      const footers = [...tree.querySelectorAll<HTMLElement>('[data-dsh-inbox-footer]')]
      for (const wrapper of footers.reverse()) {
        wrapper.style.setProperty('--dsh-inbox-bottom', `${bottom}px`)
        if (!wrapper.hasAttribute('data-dsh-inbox-hidden')) bottom += wrapper.offsetHeight + 2
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
      const wanted = new Map<HTMLElement, Section>()
      resize.disconnect()
      for (const tree of trees) delete tree.dataset.dshInboxTree
      trees.clear()
      for (const wrapper of wrappers) clearWrapper(wrapper)
      wrappers.clear()
      for (const tree of document.querySelectorAll<HTMLElement>('[role="tree"]')) {
        // Workspace trees and content-search results retain their native grouping.
        if (tree.querySelector('[data-row-key^="workspace:"]')) continue
        let previous: Section | undefined
        let firstFooter = true
        for (const row of tree.querySelectorAll<HTMLElement>('[data-row-key^="session:"]')) {
          const placement = placements().get(row.dataset.rowKey!.slice('session:'.length))
          if (placement?.blank) continue
          const section = placement?.section
          const wrapper = row.parentElement
          if (!section || !wrapper || wrapper.parentElement !== tree) continue
          if (section !== 'Working' && section !== 'Settled') continue
          trees.add(tree)
          tree.dataset.dshInboxTree = ''
          wrappers.add(wrapper)
          wrapper.dataset.dshInboxFooter = ''
          if (firstFooter) wrapper.dataset.dshInboxFirst = ''
          firstFooter = false
          if (section !== previous) wanted.set(wrapper, section)
          if (section === 'Settled' && !settledOpen) {
            if (section !== previous) wrapper.dataset.dshInboxCollapsed = ''
            else wrapper.dataset.dshInboxHidden = ''
          }
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
        const text = section === 'Settled' ? labels().settled : labels().working
        if (section === 'Settled') {
          let button = heading.querySelector('button')
          if (!button) {
            heading.textContent = ''
            button = document.createElement('button')
            button.type = 'button'
            button.onclick = (event) => {
              event.stopPropagation()
              settledOpen = !settledOpen
              refresh()
            }
            heading.append(button)
          }
          // Only write changed copy: an unconditional textContent write emits a
          // childList mutation that would re-trigger this refresh forever.
          if (button.textContent !== text) button.textContent = text
          button.setAttribute('aria-label', text)
          button.setAttribute('aria-expanded', String(settledOpen))
        } else if (heading.textContent !== text || heading.querySelector('button')) {
          heading.textContent = text
        }
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
