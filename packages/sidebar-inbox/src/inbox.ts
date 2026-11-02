import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'

export type Section = 'Pinned' | 'Inbox' | 'Working' | 'Settled'
export type Settled = Record<string, number>
export interface Placement {
  section: Section
  canSettle: boolean
  settled: boolean
  blank: boolean
}

/** Settlement is explicit, not synonymous with completion or viewing a reply. */
export function placeSessions(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  pinned: readonly string[],
  settled: Settled
): { order: string[]; placements: Map<string, Placement>; settled: Settled } {
  const pins = new Set(pinned)
  const placements = new Map<string, Placement>()
  const next = { ...settled }
  for (const id of list.ids) {
    const row = list.byId[id]
    const status = statuses.get(id)
    const pending = status?.pendingInteraction !== undefined
    const children = list.projectionsBySession[id]?.values.subagentCatalog ?? []
    const running =
      (status?.running ?? row.running) ||
      children.some((child) => statuses.get(child.id)?.running ?? list.byId[child.id]?.running)
    // A running edge clears the marker even if the host timestamp has not advanced yet.
    if (running || pending || (next[id] !== undefined && row.updatedAt > next[id])) delete next[id]
    const isSettled = next[id] !== undefined
    placements.set(id, {
      section: pins.has(id) ? 'Pinned' : pending ? 'Inbox' : running ? 'Working' : isSettled ? 'Settled' : 'Inbox',
      canSettle: !row.blank && !running && !pending && (!pins.has(id) || isSettled),
      settled: isSettled,
      blank: row.blank,
    })
  }
  const rank: Record<Section, number> = { Pinned: 0, Inbox: 1, Working: 2, Settled: 3 }
  const order = list.ids
    .filter((id) => {
      const row = list.byId[id]
      return row.origin !== 'subagent' && (!row.blank || (row.retainedBy.mainView ?? 0) > 0)
    })
    .sort((a, b) => {
      // Preserve the host's selected blank and pin conventions; no pin/archive writes.
      const left = list.byId[a]
      const right = list.byId[b]
      return (
        Number(right.blank) - Number(left.blank) ||
        rank[placements.get(a)!.section] - rank[placements.get(b)!.section] ||
        right.updatedAt - left.updatedAt ||
        a.localeCompare(b)
      )
    })
  return { order, placements, settled: next }
}
