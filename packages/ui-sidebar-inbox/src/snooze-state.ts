import { parseSnooze, pruneSnooze, serializeSnooze, snoozeDeadline, snoozeDelay } from './snooze.ts'
import type { AgentJudge, SnoozeChoiceId, SnoozeEntry } from './snooze.ts'

/** Storage accessors. The state swallows exceptions and keeps this page's behavior. */
export interface SnoozeStorage {
  readonly read: () => string | null
  readonly write: (raw: string) => void
}

/** Arms an expiry timer. The return value cancels it. */
export type SnoozeScheduler = (callback: () => void, delayMs: number) => () => void

export interface SnoozeStateOptions {
  readonly now: () => number
  readonly storage: SnoozeStorage
  readonly schedule: SnoozeScheduler
  /** Called when expiry changed the placement, so the caller can reconcile the view. */
  readonly onChange: () => void
  /** Judges entries handed to the agent. Without it those entries stay until shown again. */
  readonly judgeAgent?: AgentJudge
}

export interface SnoozeState {
  readonly getSnapshot: () => ReadonlyMap<string, SnoozeEntry>
  readonly subscribe: (listener: () => void) => () => void
  readonly snooze: (sessionId: string, choice: SnoozeChoiceId) => void
  /** Hand the wake time to the agent. The injected judge reads it from the automation list. */
  readonly snoozeAgent: (sessionId: string) => void
  readonly wake: (sessionId: string) => void
  /** Due check that reconciliation runs before placing rows. It does not call onChange. */
  readonly prune: () => void
  readonly dispose: () => void
}

/**
 * Owns the per-session snooze entries and their expiry timer. The clock, storage
 * and timer are injected so the same paths run without a browser; placing rows
 * is left to the caller.
 */
export function createSnoozeState({ now, storage, schedule, onChange, judgeAgent }: SnoozeStateOptions): SnoozeState {
  const listeners = new Set<() => void>()
  const read = (): Map<string, SnoozeEntry> => {
    try {
      return parseSnooze(storage.read(), now())
    } catch {
      return new Map()
    }
  }

  let entries = read()
  let cancel: (() => void) | null = null
  // A late agent-request rejection after disposal must not revive the timer or the view.
  let disposed = false
  /** Expiry callback. It and the due check call each other, so it is filled in below. */
  const pending = { expire: (): void => undefined }

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const persist = (): void => {
    try {
      storage.write(serializeSnooze(entries))
    } catch {
      // Only restoring after a restart is lost; this page keeps its state.
    }
  }

  /** Re-arm the timer for the next check. Without one, only clear the old timer. */
  const arm = (): void => {
    cancel?.()
    cancel = null
    if (disposed) return
    const delay = snoozeDelay(entries, now(), judgeAgent)
    if (delay !== undefined) cancel = schedule(pending.expire, delay)
  }

  /** Drop the entries that should wake, then arm the next check. */
  const pruneDue = (): void => {
    const active = pruneSnooze(entries, now(), judgeAgent)
    if (active !== entries) {
      entries = active
      persist()
      notify()
    }
    arm()
  }

  const commit = (next: Map<string, SnoozeEntry>): void => {
    entries = next
    persist()
    notify()
    arm()
    if (!disposed) onChange()
  }

  const put = (sessionId: string, entry: SnoozeEntry): void => {
    commit(new Map([...entries, [sessionId, entry]]))
  }

  pending.expire = () => {
    cancel = null
    pruneDue()
    onChange()
  }
  arm()

  return {
    dispose: () => {
      disposed = true
      cancel?.()
      cancel = null
      listeners.clear()
    },
    getSnapshot: () => entries,
    prune: pruneDue,
    snooze: (sessionId, choice) => {
      put(sessionId, snoozeDeadline(choice, now()))
    },
    snoozeAgent: (sessionId) => {
      put(sessionId, { agent: now() })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    wake: (sessionId) => {
      if (!entries.has(sessionId)) return
      commit(new Map([...entries].filter(([id]) => id !== sessionId)))
    },
  }
}
