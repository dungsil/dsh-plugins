/** Add passive metadata before the native trailing controls without replacing React-owned rows. */
export function installSidebarLabel(sessionId: string, name: string, path: string) {
  const labels = new Map<Element, HTMLSpanElement>()
  const refresh = () => {
    for (const [row, label] of labels) {
      if (!row.isConnected || row.getAttribute('data-row-key') !== `session:${sessionId}`) {
        label.remove()
        labels.delete(row)
      }
    }
    for (const row of document.querySelectorAll<HTMLElement>('[data-row-key]')) {
      if (row.dataset.rowKey !== `session:${sessionId}`) continue
      // The last child is the native action strip, including its More button.
      const actions = row.lastElementChild
      if (!actions || actions === labels.get(row)) continue
      let label = labels.get(row)
      if (!label) {
        label = document.createElement('span')
        label.className = 'dsh-worktree-sidebar-name'
        label.textContent = name
        label.title = path
        labels.set(row, label)
      }
      if (label.nextElementSibling !== actions) row.insertBefore(label, actions)
    }
  }
  const observer = new document.defaultView!.MutationObserver(refresh)
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-row-key'],
  })
  refresh()
  return () => {
    observer.disconnect()
    for (const label of labels.values()) label.remove()
  }
}
