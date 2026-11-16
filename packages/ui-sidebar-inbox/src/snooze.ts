/** Storage key of the snooze state: a JSON object from session id to entry. */
export const SNOOZE_KEY = 'dungsil.sidebar-inbox.snooze.v1'

/** Fixed durations listed in the menu. Only `tomorrow` resolves to the next morning. */
export const SNOOZE_CHOICES = ['30m', '1h', '3h', 'tomorrow'] as const

export type SnoozeChoiceId = (typeof SNOOZE_CHOICES)[number]

/** Choice id that lets the agent decide when the session should come back. */
export const AGENT_CHOICE = 'agent'

/** An entry handed to the agent. The value is the request time (epoch ms). */
export interface AgentSnooze {
  readonly agent: number
}

/**
 * Same shape as the stored value. A number is a fixed expiry time and an object
 * is an entry handed to the agent. Builds that predate agent entries drop
 * non-number values, so the same key stays usable.
 */
export type SnoozeEntry = number | AgentSnooze

/** Verdict for one entry. A held entry is checked again at `recheckAt`, or waits for an outside change. */
export type SnoozeVerdict = { readonly wake: true } | { readonly wake: false; readonly recheckAt?: number }

/** Judges an agent entry. Without one injected, agent entries stay until shown again. */
export type AgentJudge = (sessionId: string, requestedAt: number, now: number) => SnoozeVerdict

const MINUTE = 60_000
/** Local hour that `tomorrow` points at. */
const MORNING_HOUR = 9
/** Largest setTimeout delay. A later expiry is checked again after this long. */
const MAX_TIMEOUT = 2_147_483_647
/** Slack added so a timer that fires just before the deadline still reads as expired. */
const EXPIRY_GRACE_MS = 50
const MINUTES: Record<Exclude<SnoozeChoiceId, 'tomorrow'>, number> = { '1h': 60, '30m': 30, '3h': 180 }
const HOLD: SnoozeVerdict = { wake: false }

/** Expiry time of the chosen duration. `tomorrow` is 09:00 local time on the next day. */
export function snoozeDeadline(choice: SnoozeChoiceId, now: number): number {
  if (choice === 'tomorrow') {
    const date = new Date(now)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, MORNING_HOUR).getTime()
  }
  return now + MINUTES[choice] * MINUTE
}

/** Wait until a fixed time. Wake once it has passed. */
export function untilVerdict(until: number, now: number): SnoozeVerdict {
  return until > now ? { recheckAt: until, wake: false } : { wake: true }
}

function isAgentSnooze(value: unknown): value is AgentSnooze {
  if (typeof value !== 'object' || value === null || !('agent' in value)) return false
  return typeof value.agent === 'number' && Number.isFinite(value.agent)
}

/** Read stored text into a map of valid entries. Broken values and fixed times already past are dropped. */
export function parseSnooze(raw: string | null, now: number): Map<string, SnoozeEntry> {
  const active = new Map<string, SnoozeEntry>()
  if (raw === null) return active
  let stored: unknown
  try {
    stored = JSON.parse(raw)
  } catch {
    return active
  }
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return active
  for (const [id, value] of Object.entries(stored)) {
    if (id === '') continue
    if (typeof value === 'number' && Number.isFinite(value) && value > now) {
      active.set(id, value)
    } else if (isAgentSnooze(value)) {
      // An agent entry can only be judged after the automation list is read, so keep it for now.
      active.set(id, { agent: value.agent })
    }
  }
  return active
}

/** Convert to the stored form. */
export function serializeSnooze(entries: ReadonlyMap<string, SnoozeEntry>): string {
  return JSON.stringify(Object.fromEntries(entries))
}

/** Judge one entry at the given time. */
export function judgeSnooze(id: string, entry: SnoozeEntry, now: number, judgeAgent?: AgentJudge): SnoozeVerdict {
  return typeof entry === 'number' ? untilVerdict(entry, now) : (judgeAgent?.(id, entry.agent, now) ?? HOLD)
}

/** Drop the entries that should wake. Returns the same map when nothing changed. */
export function pruneSnooze(
  entries: Map<string, SnoozeEntry>,
  now: number,
  judgeAgent?: AgentJudge
): Map<string, SnoozeEntry> {
  let next: Map<string, SnoozeEntry> | undefined
  for (const [id, entry] of entries) {
    if (!judgeSnooze(id, entry, now, judgeAgent).wake) continue
    next ??= new Map(entries)
    next.delete(id)
  }
  return next ?? entries
}

/** Timer delay until the next check, or undefined when nothing needs a recheck. */
export function snoozeDelay(
  entries: ReadonlyMap<string, SnoozeEntry>,
  now: number,
  judgeAgent?: AgentJudge
): number | undefined {
  let earliest = Number.POSITIVE_INFINITY
  for (const [id, entry] of entries) {
    const verdict = judgeSnooze(id, entry, now, judgeAgent)
    earliest = Math.min(earliest, verdict.wake ? now : (verdict.recheckAt ?? Number.POSITIVE_INFINITY))
  }
  if (!Number.isFinite(earliest)) return undefined
  return Math.min(Math.max(earliest - now, 0) + EXPIRY_GRACE_MS, MAX_TIMEOUT)
}
