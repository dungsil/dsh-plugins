import type { ForgePanelState } from '@deepseek-ai/dsh-experimental-client-ui-forge/types'

/** The open PR whose head branch is the checked-out branch; PRs of other branches are never offered. */
export function requestForCheckout(panel: ForgePanelState) {
  if (panel.checkout.state !== 'ready' || !panel.checkout.checkout.branch) return undefined
  const branch = panel.checkout.checkout.branch
  return panel.changeRequests.find((entry) => entry.snapshot?.headBranch === branch && entry.snapshot.state === 'open')
}

/** Whether a feature branch with a code host repository can open a PR. */
export function canCreatePr(panel: ForgePanelState) {
  if (panel.checkout.state !== 'ready' || !panel.checkout.checkout.branch || !panel.repository) return false
  if (requestForCheckout(panel)) return false
  const branch = panel.checkout.checkout.branch
  // A missing fork point does not establish a feature branch. Never assume main/master names.
  const base = panel.local?.base.replace(/^refs\/remotes\//u, '').replace(/^[^/]+\//u, '')
  return !!base && branch !== base
}

/**
 * Identity of the facts the uncommitted-changes lookup depends on. Panel frames
 * with the same key reuse the previous answer instead of asking Git again.
 */
export function localKey(panel: ForgePanelState) {
  if (panel.checkout.state !== 'ready') return null
  const { root, branch, commit } = panel.checkout.checkout
  const files = panel.local?.files?.map((file) => `${file.path}:${file.additions}:${file.deletions}`).join('|') ?? ''
  return JSON.stringify([panel.directory, root, branch, commit, files])
}

/** Next roving focus index for a toolbar key, or null when the key does not move focus. */
export function nextIndex(key: string, current: number, count: number) {
  if (count === 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight') return (current + 1) % count
  if (key === 'ArrowLeft') return (current - 1 + count) % count
  return null
}
