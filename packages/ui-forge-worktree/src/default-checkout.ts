import type { Panel } from './client.js'

export type Checkout = 'current' | 'worktree'
export const readMethod = 'dungsil-worktree-preference/read'

/** Client-lifetime decisions only; never persist session IDs. */
export function createDefaultCheckout() {
  const settled = new Set<string>()
  return {
    mark(id: string) {
      settled.add(id)
    },
    apply(
      id: string,
      preferred: Checkout | null,
      panel: Panel | undefined,
      available: boolean,
      blank: boolean,
      request: () => void
    ) {
      if (settled.has(id) || !blank) {
        if (!blank) settled.add(id)
        return
      }
      if (preferred === null || !panel || !available || panel.checkout.state === 'pending') return
      settled.add(id)
      const w = panel.worktree
      if (
        preferred === 'worktree' &&
        panel.checkout.state === 'ready' &&
        w.editable &&
        !w.blocker &&
        !w.request &&
        !w.created &&
        !w.creation &&
        !w.restoration
      )
        request()
    },
  }
}
