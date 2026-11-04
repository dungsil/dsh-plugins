import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'

/** Sections render top to bottom; only Working and Archived get labels. */
export type Section = 'Pinned' | 'Inbox' | 'Working' | 'Archived'

export interface Placement {
  section: Section
  blank: boolean
}

/**
 * Archive is DSH's own explicit state, not a synonym for completion or viewing a
 * reply, so this projection only reads it: an archived session keeps the Archived
 * slot until the user unarchives it in the native menu.
 */
export function placeSessions(
  list: SessionListState,
  statuses: SessionStatusSnapshot,
  pinned: readonly string[],
  archived: readonly string[]
): { order: string[]; placements: Map<string, Placement> } {
  const pins = new Set(pinned)
  const archives = new Set(archived)
  const placements = new Map<string, Placement>()
  for (const id of list.ids) {
    const row = list.byId[id]
    const status = statuses.get(id)
    const pending = status?.pendingInteraction !== undefined
    const children = list.projectionsBySession[id]?.values.subagentCatalog ?? []
    const running =
      (status?.running ?? row.running) ||
      children.some((child) => statuses.get(child.id)?.running ?? list.byId[child.id]?.running)
    // Archive wins over the pin set and live status: DSH never leads with archived
    // rows and does not open them, so they stay at the bottom until restored.
    const section: Section = archives.has(id)
      ? 'Archived'
      : pins.has(id)
        ? 'Pinned'
        : pending
          ? 'Inbox'
          : running
            ? 'Working'
            : 'Inbox'
    placements.set(id, { section, blank: row.blank })
  }
  const rank: Record<Section, number> = { Pinned: 0, Inbox: 1, Working: 2, Archived: 3 }
  const order = list.ids
    .filter((id) => {
      const row = list.byId[id]
      return row.origin !== 'subagent' && (!row.blank || (row.retainedBy.mainView ?? 0) > 0)
    })
    .sort((a, b) => {
      // Preserve host conventions for the selected blank and pinned rows; only the
      // section placement and recency inside a section are ours.
      const left = list.byId[a]
      const right = list.byId[b]
      return (
        Number(right.blank) - Number(left.blank) ||
        rank[placements.get(a)!.section] - rank[placements.get(b)!.section] ||
        right.updatedAt - left.updatedAt ||
        a.localeCompare(b)
      )
    })
  return { order, placements }
}
