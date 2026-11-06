import type { ForgePanelState } from '@deepseek-ai/dsh-experimental-client-ui-forge/types'

export type Operation = 'commit' | 'push' | 'pr'

export function requestForCheckout(panel: ForgePanelState) {
  if (panel.checkout.state !== 'ready' || !panel.checkout.checkout.branch) return undefined
  const branch = panel.checkout.checkout.branch
  return panel.changeRequests.find((entry) => entry.snapshot?.headBranch === branch && entry.snapshot.state === 'open')
}

export function primaryOperation(panel: ForgePanelState): Operation {
  if (panel.checkout.state !== 'ready' || !panel.checkout.checkout.branch || !panel.repository) return 'commit'
  const branch = panel.checkout.checkout.branch
  // A missing fork point does not establish a feature branch. Never assume main/master names.
  const base = panel.local?.base.replace(/^refs\/remotes\//u, '').replace(/^[^/]+\//u, '')
  return requestForCheckout(panel) || (base && branch !== base) ? 'pr' : 'push'
}
