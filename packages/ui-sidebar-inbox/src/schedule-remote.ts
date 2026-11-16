import { createCatalogReader } from './schedule-catalog.ts'
import type { ScheduleCatalogRemote } from './schedule-catalog.ts'
import type { LinkResult, ScheduleLink } from './schedule-link.ts'

/** The session prompt request this plugin sends. The real request id is a branded string. */
interface PromptRequest {
  readonly clientTimeZone?: string
  readonly content: readonly { readonly text: string; readonly type: 'text' }[]
  readonly mode: 'queue'
  readonly requestId: string
  readonly sessionId: string
}

/** Structural minimum of the Remote face the automation link reads. */
interface ScheduleRemoteFace {
  readonly $on: (event: 'schedule/changed', listener: () => void) => () => void
  readonly schedule: ScheduleCatalogRemote
  readonly session: { readonly prompt: (request: PromptRequest) => Promise<LinkResult<unknown>> }
}

/** The part of the child context from `ctx.inject` that this link uses. */
interface ScheduleContext {
  readonly on: (event: 'connection/reset', listener: () => void) => () => void
  readonly remote: ScheduleRemoteFace
  readonly remoteAccess: {
    readonly whenAccess: (action: 'schedule/catalog' | 'schedule/history', callback: () => () => void) => () => void
  }
}

/** Services injected together into the child context. If any is missing, the link is not attached. */
export const SCHEDULE_INJECT = ['remote', 'remote.schedule', 'remote.session', 'remoteAccess']

/** UUID v4. `crypto.randomUUID` only exists in secure contexts, so there is a fallback for plain-HTTP tailnet access. */
function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte, index) => {
      // RFC 4122 version (4) and variant (10xx) bits.
      if (index === 6) return (byte % 16) + 64
      return index === 8 ? (byte % 64) + 128 : byte
    })
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/**
 * Attach the link while read access to the automation catalog is held. This is the only
 * place that uses Remote. The prompt carries the browser time zone so the agent can pick
 * a local time such as "tomorrow morning".
 */
export function connectSchedule(child: object, link: ScheduleLink): () => void {
  const scoped = child as ScheduleContext
  const { remote } = scoped

  return scoped.remoteAccess.whenAccess('schedule/catalog', () => {
    let historyAvailable = false
    const reader = createCatalogReader(remote.schedule, () => historyAvailable)
    const stopHistory = scoped.remoteAccess.whenAccess('schedule/history', () => {
      historyAvailable = true
      reader.reset()
      return () => {
        historyAvailable = false
        reader.reset()
      }
    })
    const detach = link.attach({
      list: reader.read,
      prompt: async (sessionId, text) => {
        const zone = timeZone()
        return await remote.session.prompt({
          ...(zone === undefined ? {} : { clientTimeZone: zone }),
          content: [{ text, type: 'text' }],
          mode: 'queue',
          requestId: newRequestId(),
          sessionId,
        })
      },
      subscribeChanged: (listener) => {
        const stops = [remote.$on('schedule/changed', listener), reader.subscribe(listener)]
        return () => {
          for (const stop of stops) stop()
        }
      },
      subscribeReset: (listener) =>
        scoped.on('connection/reset', () => {
          reader.reset()
          listener()
        }),
    })
    return () => {
      detach()
      stopHistory()
      reader.dispose()
    }
  })
}
