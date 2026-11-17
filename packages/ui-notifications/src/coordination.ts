interface LockManagerLike {
  request(name: string, options: { signal: AbortSignal }, callback: () => Promise<void>): Promise<unknown>
}

/**
 * Hold one endpoint-wide Web Lock for as long as this tab lives, so exactly
 * one tab per endpoint delivers notifications. When the holder closes, the
 * browser hands the lock to the next waiting tab.
 * Without Web Locks (insecure origins) every tab delivers on its own; browser
 * notifications are unavailable there anyway, so only sounds can repeat.
 */
export function electLeader(
  locks: LockManagerLike | undefined,
  name: string,
  onChange: (leader: boolean) => void
): () => void {
  if (locks === undefined) {
    onChange(true)
    return () => onChange(false)
  }
  const abort = new AbortController()
  let leader = false
  let resign: (() => void) | undefined
  locks
    .request(name, { signal: abort.signal }, () => {
      if (abort.signal.aborted) return Promise.resolve()
      leader = true
      onChange(true)
      return new Promise<void>((resolve) => {
        resign = resolve
      })
    })
    // An aborted wait rejects with AbortError; that is the normal teardown.
    .catch(() => undefined)
  return () => {
    abort.abort()
    resign?.()
    if (leader) onChange(false)
    leader = false
  }
}

interface ChannelLike {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
}

type PresenceMessage =
  | { readonly type: 'presence'; readonly tab: string; readonly session: string | null }
  | { readonly type: 'presence?' }

function isPresence(value: unknown): value is PresenceMessage {
  if (typeof value !== 'object' || value === null) return false
  const message = value as Record<string, unknown>
  if (message.type === 'presence?') return true
  return (
    message.type === 'presence' &&
    typeof message.tab === 'string' &&
    (message.session === null || typeof message.session === 'string')
  )
}

/**
 * Which Session each tab of this endpoint shows in the foreground. The
 * delivering tab skips a Session the user is already looking at, even when it
 * is open in another tab.
 */
export function createPresence(options: {
  channel: ChannelLike | undefined
  tab: string
  /** The Session this tab shows while it is visible and focused, otherwise null. */
  local(): string | null
}) {
  const { channel, tab } = options
  const remote = new Map<string, string>()
  let last: string | null | undefined
  const post = (session: string | null) => channel?.postMessage({ type: 'presence', tab, session })
  const listener = (event: { data: unknown }) => {
    const message = event.data
    if (!isPresence(message)) return
    if (message.type === 'presence?') {
      post(options.local())
      return
    }
    if (message.session === null) remote.delete(message.tab)
    else remote.set(message.tab, message.session)
  }
  channel?.addEventListener('message', listener)
  return {
    /** Announce this tab's foreground Session after it may have changed. */
    publish() {
      const session = options.local()
      if (session === last) return
      last = session
      post(session)
    },
    /** Ask the other tabs to announce themselves; a new delivering tab starts empty. */
    refresh() {
      channel?.postMessage({ type: 'presence?' })
    },
    isViewing(sessionId: string) {
      return options.local() === sessionId || [...remote.values()].includes(sessionId)
    },
    dispose() {
      channel?.removeEventListener('message', listener)
      post(null)
      remote.clear()
    },
  }
}
