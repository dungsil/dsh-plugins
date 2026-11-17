/** Events the user can enable or disable one by one. */
export const EVENT_KINDS = ['approval', 'question', 'planReview', 'completed'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export const VOLUMES = ['low', 'medium', 'high'] as const
export type Volume = (typeof VOLUMES)[number]

export interface Preferences {
  /** Browser notifications; they also need the browser's permission. */
  readonly desktop: boolean
  readonly sound: boolean
  readonly volume: Volume
  readonly events: Readonly<Record<EventKind, boolean>>
  /** Top-level sessions whose notifications and sounds stay off. */
  readonly muted: readonly string[]
}

export const DEFAULT_PREFERENCES: Preferences = {
  desktop: false,
  sound: true,
  volume: 'medium',
  events: { approval: true, question: true, planReview: true, completed: true },
  muted: [],
}

const PREFIX = 'dungsil.notifications.v1'

/**
 * Identity of the DSH Host this page talks to. The Web client resolves its API
 * against the document base, so one browser origin can host several endpoints
 * behind a prefix-stripping proxy; every stored key and channel includes it.
 */
export function endpointOf(baseURI: string): string {
  const url = new URL('.', baseURI)
  return `${url.origin}${url.pathname}`
}

export function scopedName(endpoint: string, part: string): string {
  return `${PREFIX}:${part}:${endpoint}`
}

/** Accept only known fields, so a damaged or older record falls back field by field. */
export function parsePreferences(raw: string | null): Preferences {
  if (raw === null) return DEFAULT_PREFERENCES
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return DEFAULT_PREFERENCES
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_PREFERENCES
  const record = value as Record<string, unknown>
  const events = (typeof record.events === 'object' && record.events !== null ? record.events : {}) as Record<
    string,
    unknown
  >
  const flag = (input: unknown, fallback: boolean) => (typeof input === 'boolean' ? input : fallback)
  return {
    desktop: flag(record.desktop, DEFAULT_PREFERENCES.desktop),
    sound: flag(record.sound, DEFAULT_PREFERENCES.sound),
    volume: VOLUMES.includes(record.volume as Volume) ? (record.volume as Volume) : DEFAULT_PREFERENCES.volume,
    events: Object.fromEntries(
      EVENT_KINDS.map((kind) => [kind, flag(events[kind], DEFAULT_PREFERENCES.events[kind])])
    ) as Record<EventKind, boolean>,
    muted: Array.isArray(record.muted)
      ? [...new Set(record.muted.filter((id): id is string => typeof id === 'string' && id !== ''))]
      : [],
  }
}

export interface PreferenceStore {
  getSnapshot(): Preferences
  subscribe(listener: () => void): () => void
  update(change: (current: Preferences) => Preferences): void
  dispose(): void
}

/**
 * Preferences shared by every tab of one endpoint. Another tab's write arrives
 * through the `storage` event; a denied store keeps working in memory.
 */
export function createPreferenceStore(options: {
  key: string
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined
  onStorage?: (listener: (event: { key: string | null; newValue: string | null }) => void) => () => void
}): PreferenceStore {
  const read = () => {
    try {
      return options.storage?.getItem(options.key) ?? null
    } catch {
      return null
    }
  }
  let snapshot = parsePreferences(read())
  const listeners = new Set<() => void>()
  const publish = (next: Preferences) => {
    if (JSON.stringify(next) === JSON.stringify(snapshot)) return
    snapshot = next
    for (const listener of listeners) listener()
  }
  const stop = options.onStorage?.((event) => {
    // `key === null` means another tab cleared the whole store.
    if (event.key === options.key || event.key === null) publish(parsePreferences(event.newValue))
  })
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(change) {
      const next = parsePreferences(JSON.stringify(change(snapshot)))
      try {
        options.storage?.setItem(options.key, JSON.stringify(next))
      } catch {
        // Quota or privacy settings only lose persistence; this tab keeps the choice.
      }
      publish(next)
    },
    dispose() {
      stop?.()
      listeners.clear()
    },
  }
}

export function toggleMuted(preferences: Preferences, sessionId: string, muted: boolean): Preferences {
  const rest = preferences.muted.filter((id) => id !== sessionId)
  return { ...preferences, muted: muted ? [...rest, sessionId] : rest }
}
