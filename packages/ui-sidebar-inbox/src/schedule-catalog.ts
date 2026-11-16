import type { CatalogEntryLike, LinkResult } from './schedule-link.ts'

interface DeliveryPage {
  readonly records: readonly { readonly messageId?: string; readonly targetSessionId: string }[]
  readonly nextBefore?: string
}

export interface ScheduleCatalogRemote {
  readonly catalog: () => Promise<LinkResult<readonly CatalogEntryLike[]>>
  readonly history?: (request: {
    readonly id: string
    readonly limit: number
    readonly before?: string
  }) => Promise<LinkResult<DeliveryPage | { readonly code: string }>>
}

interface CachedDelivery {
  readonly delivery?: string
  readonly head?: string
  readonly ids: readonly string[]
}

export interface CatalogReader {
  readonly read: () => Promise<LinkResult<readonly CatalogEntryLike[]>>
  readonly subscribe: (listener: () => void) => () => void
  readonly reset: () => void
  readonly dispose: () => void
}

function collect(page: DeliveryPage, ids: Set<string>, previousHead: string | undefined): string | undefined {
  const previousIndex =
    previousHead === undefined ? -1 : page.records.findIndex((record) => record.messageId === previousHead)
  const records = previousIndex === -1 ? page.records : page.records.slice(0, previousIndex + 1)
  for (const record of records) ids.add(record.targetSessionId)
  return previousIndex === -1 ? page.nextBefore : undefined
}

function isPage(
  result: LinkResult<DeliveryPage | { readonly code: string }> | undefined
): result is { readonly ok: true; readonly value: DeliveryPage } {
  return result?.ok === true && 'records' in result.value
}

/**
 * Enriches catalog entries with the sessions their deliveries went to. History is only
 * evidence of a target, so it is filled in separately and a slow read never blocks the
 * wake judgment.
 */
export function createCatalogReader(
  remote: ScheduleCatalogRemote,
  historyAvailable: () => boolean = () => true
): CatalogReader {
  const cached = new Map<string, CachedDelivery>()
  const pending = new Map<string, string>()
  const listeners = new Set<() => void>()
  let generation = 0
  let disposed = false

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const deliveries = async (id: string, delivery: string): Promise<void> => {
    const ticket = generation
    const previous = cached.get(id)
    const ids = new Set(previous?.ids)
    const cursors = new Set<string>()
    let before: string | undefined
    let head = previous?.head
    let complete = true
    let more = true
    try {
      while (more) {
        // The next page's cursor only exists in the current response.
        const result = await remote.history?.({ ...(before === undefined ? {} : { before }), id, limit: 100 })
        if (disposed || ticket !== generation) return
        if (isPage(result)) {
          if (before === undefined) head = result.value.records[0]?.messageId
          before = collect(result.value, ids, previous?.head)
          if (before === undefined) {
            more = false
          } else if (cursors.has(before)) {
            complete = false
            more = false
          } else {
            cursors.add(before)
          }
        } else {
          complete = false
          more = false
        }
      }
    } catch {
      complete = false
      // Do not repeat a permission or connection failure for the same delivery; retry after reconnect.
    }
    if (disposed || ticket !== generation) return
    const anchor = complete ? head : previous?.head
    cached.set(id, { delivery, ...(anchor === undefined ? {} : { head: anchor }), ids: [...ids] })
    pending.delete(id)
    notify()
  }

  const enrich = (entry: CatalogEntryLike): CatalogEntryLike => {
    const { id, lastDelivery } = entry
    const previous = id === undefined ? undefined : cached.get(id)
    if (id !== undefined && lastDelivery !== undefined && remote.history !== undefined && historyAvailable()) {
      const needsHistory = previous?.delivery !== lastDelivery.deliveredAt && !pending.has(id)
      if (needsHistory) {
        pending.set(id, lastDelivery.deliveredAt)
        void deliveries(id, lastDelivery.deliveredAt)
      }
    }
    return previous === undefined ? entry : { ...entry, deliveredSessionIds: previous.ids }
  }

  return {
    dispose: () => {
      disposed = true
      generation += 1
      pending.clear()
      cached.clear()
      listeners.clear()
    },
    read: async () => {
      const result = await remote.catalog()
      if (!result.ok || disposed) return result
      return { ok: true, value: result.value.map(enrich) }
    },
    reset: () => {
      generation += 1
      pending.clear()
      for (const [id, entry] of cached) {
        cached.set(id, { ...(entry.head === undefined ? {} : { head: entry.head }), ids: entry.ids })
      }
      notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
