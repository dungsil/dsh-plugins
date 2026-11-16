/** The fields of one automation task that the wake judgment uses. */
export interface WakeTask {
  /** Existing session this task delivers to. */
  readonly sessionId: string
  readonly active: boolean
  /** Next run time (epoch ms). */
  readonly scheduledAt: number
  /** Last delivery time (epoch ms). Absent when it was never delivered. */
  readonly deliveredAt?: number
}

export interface ScheduleSnapshot {
  /** The automation service is mounted and readable, so the agent choice can be shown. */
  readonly available: boolean
  /** A list read has succeeded at least once. Until then, absence of tasks is not assumed. */
  readonly settled: boolean
  readonly tasks: readonly WakeTask[]
  /** Scheduled and actually delivered targets only. The session that created a task is not a target. */
  readonly sessionIds: ReadonlySet<string>
}

/** The fields of a host automation catalog entry that this plugin reads. */
export interface CatalogEntryLike {
  readonly id?: string
  readonly deliveredSessionIds?: readonly string[]
  readonly status: string
  readonly scheduledAt: string
  readonly target: { readonly kind: string; readonly sessionId?: string }
  readonly lastDelivery?: { readonly deliveredAt: string; readonly targetSessionId?: string }
}

/** Minimal contract of a Remote call result. */
export type LinkResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false }

/** Remote calls and invalidation subscriptions handed over when the automation service attaches. */
export interface ScheduleDeps {
  readonly list: () => Promise<LinkResult<readonly CatalogEntryLike[]>>
  /** Queue one user message into a session. */
  readonly prompt: (sessionId: string, text: string) => Promise<LinkResult<unknown>>
  readonly subscribeChanged: (listener: () => void) => () => void
  readonly subscribeReset: (listener: () => void) => () => void
}

export interface ScheduleLink {
  readonly getSnapshot: () => ScheduleSnapshot
  readonly subscribe: (listener: () => void) => () => void
  /** Attach once the service is usable. The return value detaches. */
  readonly attach: (deps: ScheduleDeps) => () => void
  /** Send a message to the agent. False while detached or when the host refuses. */
  readonly request: (sessionId: string, text: string) => Promise<boolean>
}

const DETACHED: ScheduleSnapshot = { available: false, sessionIds: new Set(), settled: false, tasks: [] }

/** Classify scheduled new-session targets and the last actual delivery too, leaving manual wake tasks unchanged. */
export function automationSessionIds(entries: readonly CatalogEntryLike[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const entry of entries) {
    for (const id of entry.deliveredSessionIds ?? []) ids.add(id)
    if ((entry.target.kind === 'session' || entry.target.kind === 'new_once') && entry.target.sessionId !== undefined) {
      ids.add(entry.target.sessionId)
    }
    if (entry.lastDelivery?.targetSessionId !== undefined) ids.add(entry.lastDelivery.targetSessionId)
  }
  return ids
}

function parseTime(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : undefined
}

/** Keep only tasks delivered to an existing session. A task that creates a new session never wakes this row. */
export function toWakeTasks(entries: readonly CatalogEntryLike[]): WakeTask[] {
  const tasks: WakeTask[] = []
  for (const entry of entries) {
    const { sessionId } = entry.target
    const scheduledAt = parseTime(entry.scheduledAt)
    if (entry.target.kind !== 'session' || sessionId === undefined || scheduledAt === undefined) continue
    const deliveredAt = parseTime(entry.lastDelivery?.deliveredAt)
    tasks.push({
      active: entry.status === 'active',
      ...(deliveredAt === undefined ? {} : { deliveredAt }),
      scheduledAt,
      sessionId,
    })
  }
  return tasks
}

/**
 * Turns the automation catalog into a snapshot the sidebar can subscribe to. The
 * service is an optional dependency with its own mount and lifetime, so the link
 * answers "unavailable" before attaching and after detaching. A late earlier read
 * is dropped, and a failed read keeps the last successful result.
 */
export function createScheduleLink(): ScheduleLink {
  const listeners = new Set<() => void>()
  let snapshot = DETACHED
  let current: ScheduleDeps | null = null
  let generation = 0

  const publish = (next: ScheduleSnapshot): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  const read = async (deps: ScheduleDeps): Promise<void> => {
    generation += 1
    const ticket = generation
    let result: LinkResult<readonly CatalogEntryLike[]>
    try {
      result = await deps.list()
    } catch {
      return
    }
    if (current !== deps || ticket !== generation || !result.ok) return
    publish({
      available: true,
      sessionIds: automationSessionIds(result.value),
      settled: true,
      tasks: toWakeTasks(result.value),
    })
  }

  return {
    attach: (deps) => {
      current = deps
      publish({ ...DETACHED, available: true })
      const refresh = (): void => {
        void read(deps)
      }
      const stops = [deps.subscribeChanged(refresh), deps.subscribeReset(refresh)]
      refresh()
      return () => {
        for (const stop of stops) stop()
        if (current === deps) {
          current = null
          publish(DETACHED)
        }
      }
    },
    getSnapshot: () => snapshot,
    request: async (sessionId, text) => {
      if (current === null) return false
      try {
        const result = await current.prompt(sessionId, text)
        return result.ok
      } catch {
        return false
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
