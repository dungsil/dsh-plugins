import type { SessionEvent } from './engine.ts'
import type { Preferences, Volume } from './preferences.ts'

interface NotificationLike {
  onclick: ((event: Event) => void) | null
  close(): void
}
export interface NotificationApi {
  readonly permission: NotificationPermission
  create(title: string, options: { body: string; tag: string; lang: string }): NotificationLike
}

export interface Text {
  title(kind: SessionEvent['kind']): string
  body(workspace: string | undefined): string
  lang: string
}

/** The top-level Session that owns a subagent; mute applies to the whole conversation. */
export function rootOf(
  byId: Readonly<Record<string, { readonly parentId?: string } | undefined>>,
  sessionId: string
): string {
  let current = sessionId
  const visited = new Set<string>()
  while (!visited.has(current)) {
    visited.add(current)
    const parent = byId[current]?.parentId
    if (parent === undefined || byId[parent] === undefined) return current
    current = parent
  }
  return current
}

/** Last path segment only; a directory name identifies the workspace, never the conversation. */
export function workspaceName(cwd: string | undefined): string | undefined {
  const name = cwd?.split(/[\\/]+/).findLast((part) => part !== '')
  return name === undefined || name === '' ? undefined : name
}

/**
 * Deliver one event as a browser notification and/or a sound. Copy contains
 * only the event kind and the workspace folder name: titles, prompts, answers,
 * tool names, and approval reasons can all carry conversation content.
 */
export function createDelivery(options: {
  preferences: () => Preferences
  notifications: () => NotificationApi | undefined
  playSound(volume: Volume): Promise<boolean>
  byId: () => Readonly<Record<string, { readonly parentId?: string; readonly cwd?: string } | undefined>>
  isViewing(sessionId: string): boolean
  text: () => Text
  open(sessionId: string): void
}) {
  const shown = new Map<string, NotificationLike>()
  return {
    deliver(event: SessionEvent) {
      const preferences = options.preferences()
      if (!preferences.events[event.kind]) return
      const byId = options.byId()
      const root = rootOf(byId, event.sessionId)
      if (preferences.muted.includes(root)) return
      if (options.isViewing(event.sessionId) || options.isViewing(root)) return
      if (preferences.sound) void options.playSound(preferences.volume)
      const api = options.notifications()
      if (!preferences.desktop || api?.permission !== 'granted') return
      const text = options.text()
      try {
        const notification = api.create(text.title(event.kind), {
          body: text.body(workspaceName(byId[root]?.cwd ?? byId[event.sessionId]?.cwd)),
          // The tag also lets the OS replace a repeat of the same event.
          tag: event.key,
          lang: text.lang,
        })
        notification.onclick = (click) => {
          click.preventDefault()
          options.open(event.sessionId)
          notification.close()
          shown.delete(event.key)
        }
        shown.get(event.key)?.close()
        shown.set(event.key, notification)
      } catch {
        // Some browsers allow notifications only from a service worker; the sound still played.
      }
    },
    /** Close the notification of a request that is no longer waiting. */
    withdraw(key: string) {
      shown.get(key)?.close()
      shown.delete(key)
    },
    dispose() {
      for (const notification of shown.values()) notification.close()
      shown.clear()
    },
  }
}
