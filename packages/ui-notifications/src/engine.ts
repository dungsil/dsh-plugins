import type { EventKind } from './preferences.ts'

export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** The Session list fields this feature reads; DSH rows carry more. */
export interface ListRow {
  readonly running: boolean
  readonly origin?: 'subagent'
}
export interface ListState {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, ListRow>>
  readonly phase: string
}
export interface Status {
  readonly running: boolean | undefined
  readonly pendingInteraction: { readonly key: string; readonly kind: string; readonly sessionId: string } | undefined
}
interface WindowEvent {
  readonly type: string
  readonly data?: unknown
}
export interface EventWindow {
  readonly change: { readonly kind: string; readonly entries?: readonly { readonly event: WindowEvent }[] }
}
export interface Watch {
  readonly ready: Promise<{ readonly eventSource: Observable<EventWindow> }>
  release(): void
}

export interface SessionEvent {
  /** Stable identity: one request key, or one completed turn of one Session. */
  readonly key: string
  readonly kind: EventKind
  readonly sessionId: string
}

/** Requests published through `uiSession.registerPendingInteraction` by DSH 0.2.2. */
const PENDING_KINDS: Readonly<Record<string, EventKind>> = {
  approval: 'approval',
  question: 'question',
  'plan-review': 'planReview',
}

/** Quiet period after (re)connecting or taking over, while restored requests reappear. */
export const SETTLE_MS = 2_000
/** A turn's closing event can trail the running flag; keep the watch briefly. */
export const RELEASE_GRACE_MS = 5_000
/** Request keys stay remembered so a hidden and revealed question does not repeat. */
const SEEN_LIMIT = 2_000

function turnOf(event: WindowEvent): number | undefined {
  const turn = (event.data as { turn?: unknown } | undefined)?.turn
  return typeof turn === 'number' ? turn : undefined
}

/** Only an explicit `completed` turn end counts; errors, aborts and other endings never do. */
function completedTurn(event: WindowEvent): number | undefined {
  if (event.type !== 'turn/end') return undefined
  const reason = (event.data as { reason?: { kind?: unknown } } | undefined)?.reason
  return reason?.kind === 'completed' ? turnOf(event) : undefined
}

/**
 * Turn live DSH state into notification events. A request that is already
 * present while this tab starts, takes over, or reconnects is history: only
 * keys first seen after the connection settles are reported. Completion comes
 * only from `turn/end` events appended to a watched Session's live window,
 * never from the running or unread flags; those only decide what to watch.
 */
export function createEngine(options: {
  list: Observable<ListState>
  status: Observable<ReadonlyMap<string, Status>>
  connection: Observable<string | undefined>
  watch(sessionId: string): Watch
  emit(event: SessionEvent): void
  /** A reported request was answered, cancelled or withdrawn. */
  withdraw(key: string): void
  schedule(callback: () => void, delay: number): () => void
}): { dispose(): void } {
  const { list, status, connection } = options
  let live = false
  let cancelSettle: (() => void) | undefined
  const seen = new Set<string>()
  const reported = new Set<string>()
  const failed = new Set<string>()
  const watches = new Map<string, { watch: Watch; stop?: () => void; cancelRelease?: () => void; disposed: boolean }>()
  const completed = new Map<string, Set<number>>()

  const remember = (key: string) => {
    seen.add(key)
    // Sets iterate in insertion order, so this drops the oldest keys first.
    for (const old of seen) {
      if (seen.size <= SEEN_LIMIT) break
      seen.delete(old)
    }
  }

  const isRunning = (id: string, state: ListState, statuses: ReadonlyMap<string, Status>) =>
    statuses.get(id)?.running ?? state.byId[id]?.running ?? false

  const release = (id: string) => {
    const entry = watches.get(id)
    if (!entry) return
    entry.disposed = true
    entry.stop?.()
    entry.cancelRelease?.()
    entry.watch.release()
    watches.delete(id)
    completed.delete(id)
  }

  const reportTurn = (id: string, turn: number) => {
    const turns = completed.get(id) ?? new Set<number>()
    completed.set(id, turns)
    if (turns.has(turn)) return
    turns.add(turn)
    options.emit({ key: `completed:${id}:${turn}`, kind: 'completed', sessionId: id })
  }

  const observeWindow = (id: string, window: EventWindow) => {
    const entry = watches.get(id)
    if (!entry || entry.disposed) return
    // Only events appended while watching are news. The opening window and any
    // later replacement (a reconnection baseline) hold history, even when the
    // running flag arrived before the turn that would explain it.
    if (window.change.kind !== 'append') return
    for (const { event } of window.change.entries ?? []) {
      const turn = completedTurn(event)
      if (turn !== undefined) reportTurn(id, turn)
    }
  }

  const startWatch = (id: string) => {
    const watch = options.watch(id)
    const entry: { watch: Watch; stop?: () => void; cancelRelease?: () => void; disposed: boolean } = {
      watch,
      disposed: false,
    }
    watches.set(id, entry)
    watch.ready.then(
      (binding) => {
        if (entry.disposed) return
        // The current snapshot, whatever its last change, predates this watch.
        const source = binding.eventSource
        entry.stop = source.subscribe(() => observeWindow(id, source.getSnapshot()))
      },
      () => {
        // An unreadable Session (removed, refused or offline) is retried only
        // after it stops and runs again, never in a loop.
        if (entry.disposed) return
        failed.add(id)
        release(id)
      }
    )
  }

  const reconcileTurns = (state: ListState, statuses: ReadonlyMap<string, Status>) => {
    const roots = new Set(state.ids.filter((id) => state.byId[id]?.origin !== 'subagent'))
    for (const id of roots) {
      const running = isRunning(id, state, statuses)
      if (!running) failed.delete(id)
      const entry = watches.get(id)
      if (running && !entry && !failed.has(id)) startWatch(id)
      if (running && entry?.cancelRelease) {
        entry.cancelRelease()
        entry.cancelRelease = undefined
      }
    }
    for (const [id, entry] of watches) {
      if (roots.has(id) && isRunning(id, state, statuses)) continue
      if (!roots.has(id) && state.phase === 'ready') release(id)
      else entry.cancelRelease ??= options.schedule(() => release(id), RELEASE_GRACE_MS)
    }
  }

  const reconcile = () => {
    const state = list.getSnapshot()
    const statuses = status.getSnapshot()
    const connected = connection.getSnapshot() === 'connected' && state.phase === 'ready'
    if (!connected) {
      live = false
      cancelSettle?.()
      cancelSettle = undefined
    } else if (!live && cancelSettle === undefined) {
      cancelSettle = options.schedule(() => {
        cancelSettle = undefined
        live = true
        reconcile()
      }, SETTLE_MS)
    }

    const pending = new Set<string>()
    for (const value of statuses.values()) {
      const interaction = value.pendingInteraction
      if (interaction === undefined) continue
      pending.add(interaction.key)
      if (seen.has(interaction.key)) continue
      remember(interaction.key)
      const kind = PENDING_KINDS[interaction.kind]
      if (!live || kind === undefined) continue
      reported.add(interaction.key)
      options.emit({ key: interaction.key, kind, sessionId: interaction.sessionId })
    }
    for (const key of reported) {
      if (pending.has(key)) continue
      reported.delete(key)
      options.withdraw(key)
    }
    reconcileTurns(state, statuses)
  }

  const stops = [list.subscribe(reconcile), status.subscribe(reconcile), connection.subscribe(reconcile)]
  reconcile()
  return {
    dispose() {
      for (const stop of stops) stop()
      cancelSettle?.()
      for (const id of watches.keys()) release(id)
      for (const key of reported) options.withdraw(key)
      reported.clear()
    },
  }
}
