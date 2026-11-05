import type { ConnectionView, QuotaAccount, QuotaResult } from './protocol.js'

export const quotaKey = (account: QuotaAccount) => JSON.stringify([account.name, account.authIndex])
export type QuotaValues = Record<string, QuotaResult | null | undefined>

export interface QuotaSnapshot {
  accounts: QuotaAccount[]
  quotas: QuotaValues
  fetchedAt: number
}

const connectionKey = (view: ConnectionView) => JSON.stringify([view.baseURL, view.revision, view.managementKeySaved])

export class QuotaCache {
  private entry?: { key: string; view: ConnectionView; snapshot: QuotaSnapshot }

  get connection() {
    return this.entry?.view
  }

  read(view: ConnectionView) {
    if (this.entry?.key !== connectionKey(view)) {
      this.clear()
      return undefined
    }
    return this.entry.snapshot
  }

  write(view: ConnectionView, snapshot: QuotaSnapshot) {
    this.entry = { key: connectionKey(view), view, snapshot }
  }

  update(view: ConnectionView, account: QuotaAccount, value: QuotaResult | null) {
    const snapshot = this.read(view)
    if (snapshot) this.write(view, { ...snapshot, quotas: { ...snapshot.quotas, [quotaKey(account)]: value } })
  }

  clear() {
    this.entry = undefined
  }
}

export function subscribeQuotaGeneration(
  generation: { subscribe: (listener: () => void) => () => void; getSnapshot: () => unknown },
  cache: QuotaCache,
  cancel: () => void,
  changed: (connected: boolean) => void
) {
  return generation.subscribe(() => {
    cancel()
    cache.clear()
    changed(!!generation.getSnapshot())
  })
}

export async function loadQuotaSnapshot(
  list: () => Promise<QuotaAccount[]>,
  fetch: (account: QuotaAccount) => Promise<QuotaResult>,
  signal: AbortSignal,
  publish: (snapshot: QuotaSnapshot) => void
): Promise<QuotaSnapshot> {
  signal.throwIfAborted()
  const accounts = await list()
  signal.throwIfAborted()
  let snapshot: QuotaSnapshot = { accounts, quotas: {}, fetchedAt: Date.now() }
  publish(snapshot)
  const pending = accounts.filter((account) => account.supported && !account.disabled && account.authIndex)
  let cursor = 0
  const worker = async () => {
    while (cursor < pending.length) {
      signal.throwIfAborted()
      const account = pending[cursor++]
      let result: QuotaResult | null
      try {
        result = await fetch(account)
      } catch {
        signal.throwIfAborted()
        result = null
      }
      signal.throwIfAborted()
      snapshot = { ...snapshot, quotas: { ...snapshot.quotas, [quotaKey(account)]: result } }
      publish(snapshot)
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker))
  signal.throwIfAborted()
  return snapshot
}
