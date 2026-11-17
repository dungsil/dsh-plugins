/** Display state of one paragraph translation. */
export type TranslationStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'pending' }
  | { readonly state: 'done'; readonly text: string }
  | { readonly state: 'failed' }

interface Entry {
  status: TranslationStatus
  controller?: AbortController
  holders: number
}

const IDLE: TranslationStatus = { state: 'idle' }

/**
 * Paragraph translations shared by every mounted row, keyed by Session, provider, language, and text.
 * One key never has two requests in flight. Rows that disappear release their keys: pending requests are
 * aborted and failures are forgotten, while finished translations stay for remounts up to `limit` entries.
 */
export class TranslationRequests {
  private readonly entries = new Map<string, Entry>()
  private readonly expanded = new Map<string, boolean>()
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(
    private readonly run: (key: string, signal: AbortSignal) => Promise<string>,
    private readonly limit = 200
  ) {}

  status(key: string): TranslationStatus {
    return this.entries.get(key)?.status ?? IDLE
  }

  /** Whether the reader left this paragraph's translation open; survives virtualized remounts. */
  isExpanded(paragraph: string): boolean {
    return this.expanded.get(paragraph) ?? false
  }

  setExpanded(paragraph: string, open: boolean) {
    this.expanded.delete(paragraph)
    if (open) {
      this.expanded.set(paragraph, true)
      this.trim(this.expanded)
    }
    this.emit()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Keep a key alive while a row shows it. @returns idempotent release. */
  retain(key: string) {
    const entry = this.entry(key)
    entry.holders += 1
    let released = false
    return () => {
      if (released) return
      released = true
      entry.holders -= 1
      if (entry.holders > 0 || this.entries.get(key) !== entry) return
      if (entry.status.state === 'pending') entry.controller?.abort()
      if (entry.status.state !== 'done') this.entries.delete(key)
    }
  }

  /** Start the translation unless it is already pending or finished. */
  request(key: string) {
    if (this.disposed) return
    const entry = this.entry(key)
    if (entry.status.state === 'pending' || entry.status.state === 'done') return
    const controller = new AbortController()
    entry.controller = controller
    entry.status = { state: 'pending' }
    this.emit()
    this.run(key, controller.signal).then(
      (text) => this.settle(key, entry, controller, { state: 'done', text }),
      () => this.settle(key, entry, controller, { state: 'failed' })
    )
  }

  dispose() {
    this.disposed = true
    for (const entry of this.entries.values()) entry.controller?.abort()
    this.entries.clear()
    this.expanded.clear()
    this.listeners.clear()
  }

  private settle(key: string, entry: Entry, controller: AbortController, status: TranslationStatus) {
    if (controller.signal.aborted || this.entries.get(key) !== entry) return
    entry.controller = undefined
    entry.status = status
    if (status.state === 'done') {
      // Most recently finished last, so trimming drops the oldest results.
      this.entries.delete(key)
      this.entries.set(key, entry)
      this.trim(this.entries, (candidate) => candidate.holders === 0)
    }
    this.emit()
  }

  private entry(key: string) {
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { status: IDLE, holders: 0 }
      this.entries.set(key, entry)
    }
    return entry
  }

  private trim<T>(map: Map<string, T>, removable: (value: T) => boolean = () => true) {
    for (const [key, value] of map) {
      if (map.size <= this.limit) return
      if (removable(value)) map.delete(key)
    }
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
