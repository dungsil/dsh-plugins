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
