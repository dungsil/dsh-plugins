import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, SettingsPicker, SettingsRow, Switch, installSettingsIcon, settingsStyles } from '@dungsil/dsh-ui'
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { IconBellOffOutlineRegular, IconBellOutlineRegular, bellIconSvg } from '@dungsil/dsh-ui/icons'
import { createPresence, electLeader } from './coordination.ts'
import { copy, format } from './copy.ts'
import { createDelivery, rootOf, type NotificationApi, type Text } from './deliver.ts'
import { createEngine, type EventWindow, type Observable, type Watch } from './engine.ts'
import {
  EVENT_KINDS,
  VOLUMES,
  createPreferenceStore,
  endpointOf,
  scopedName,
  toggleMuted,
  type PreferenceStore,
} from './preferences.ts'
import { createChime } from './sound.ts'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Running Sessions watched for their live `turn/end` events. */
    dungsilNotifications: unknown
  }
}

export const name = 'dungsil-ui-notifications'
export const inject = ['sessions', 'uiSession', 'locale', 'slots', 'connection']

type Chime = ReturnType<typeof createChime>
type Permission = NotificationPermission | 'unsupported'

/** Notifications need a secure context; `isSecureContext` also covers localhost. */
function notificationApi(): NotificationApi | undefined {
  if (typeof Notification !== 'function' || !window.isSecureContext) return undefined
  return {
    get permission() {
      return Notification.permission
    },
    create: (title, options) => new Notification(title, options),
  }
}

const permissionNow = (): Permission => notificationApi()?.permission ?? 'unsupported'

function storage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

function NotificationSettings({
  ctx,
  preferences,
  chime,
}: {
  ctx: Context
  preferences: PreferenceStore
  chime: Chime
}) {
  const { active } = useLocaleSnapshot(ctx.locale)
  const text = localizedCopy(copy, active)
  const id = useId()
  const current = useSyncExternalStore(
    (listener) => preferences.subscribe(listener),
    () => preferences.getSnapshot()
  )
  const [permission, setPermission] = useState(permissionNow)
  const [requesting, setRequesting] = useState(false)
  const [soundBlocked, setSoundBlocked] = useState(false)
  useEffect(() => {
    // Site settings can change while the page stays open.
    const refresh = () => setPermission(permissionNow())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const toggleDesktop = (on: boolean) => {
    if (!on) {
      preferences.update((value) => ({ ...value, desktop: false }))
      return
    }
    const api = notificationApi()
    if (api === undefined) return
    if (api.permission === 'granted') {
      preferences.update((value) => ({ ...value, desktop: true }))
      return
    }
    if (api.permission === 'denied') {
      setPermission('denied')
      return
    }
    // The only permission request: this switch's own click.
    setRequesting(true)
    void Notification.requestPermission()
      .then((result) => {
        setPermission(result)
        if (result === 'granted') preferences.update((value) => ({ ...value, desktop: true }))
      })
      .catch(() => setPermission(permissionNow()))
      .finally(() => setRequesting(false))
  }

  const permissionHint =
    permission === 'unsupported'
      ? text.permissionUnsupported
      : permission === 'denied'
        ? text.permissionDenied
        : permission === 'default'
          ? text.permissionDefault
          : undefined

  return (
    <section className="dsh-notifications" aria-label={text.nav}>
      <p>{text.intro}</p>
      <SettingsRow
        label={
          <>
            <span id={`${id}-desktop`}>{text.desktop}</span>
            <p>{text.desktopHint}</p>
            {permissionHint && (
              <p role={permission === 'denied' ? 'alert' : undefined} data-permission={permission}>
                {permissionHint}
              </p>
            )}
          </>
        }
      >
        <Switch
          label={text.desktop}
          checked={current.desktop && permission === 'granted'}
          disabled={permission === 'unsupported' || requesting}
          onChange={toggleDesktop}
        />
      </SettingsRow>
      <SettingsRow
        label={
          <>
            <span>{text.sound}</span>
            <p>{text.soundHint}</p>
          </>
        }
      >
        <Switch
          label={text.sound}
          checked={current.sound}
          onChange={(on) => {
            if (on) chime.unlock()
            preferences.update((value) => ({ ...value, sound: on }))
          }}
        />
      </SettingsRow>
      <SettingsRow label={<span id={`${id}-volume`}>{text.volume}</span>}>
        <div className="dsh-notifications-actions">
          <Button
            type="button"
            disabled={!current.sound}
            onClick={() => {
              setSoundBlocked(false)
              void chime.play(current.volume).then((played) => setSoundBlocked(!played))
            }}
          >
            {text.test}
          </Button>
          <SettingsPicker
            aria-labelledby={`${id}-volume`}
            disabled={!current.sound}
            value={text[`volume.${current.volume}`]}
            selectedId={current.volume}
            items={VOLUMES.map((volume) => ({ id: volume, label: text[`volume.${volume}`] }))}
            onSelect={(volume) =>
              preferences.update((value) => ({ ...value, volume: volume as (typeof VOLUMES)[number] }))
            }
          />
        </div>
      </SettingsRow>
      {soundBlocked && <p role="alert">{text.soundBlocked}</p>}
      <h3 className="dsh-notifications-heading">{text.events}</h3>
      {EVENT_KINDS.map((kind) => (
        <SettingsRow key={kind} label={<span>{text[`event.${kind}`]}</span>}>
          <Switch
            label={text[`event.${kind}`]}
            checked={current.events[kind]}
            onChange={(on) => preferences.update((value) => ({ ...value, events: { ...value.events, [kind]: on } }))}
          />
        </SettingsRow>
      ))}
      <SettingsRow
        label={
          <>
            <span>{format(text.mutedCount, { count: current.muted.length })}</span>
            <p>{text.mutedHint}</p>
          </>
        }
      >
        <Button
          type="button"
          disabled={current.muted.length === 0}
          onClick={() => preferences.update((value) => ({ ...value, muted: [] }))}
        >
          {text.unmuteAll}
        </Button>
      </SettingsRow>
    </section>
  )
}

const styles = `${settingsStyles}
.dsh-notifications { color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-notifications p { color: var(--dsw-alias-label-secondary); margin: 0; overflow-wrap: anywhere; }
.dsh-notifications .dsh-plugin-settings-text p { font-size: 12px; line-height: 20px; margin: 4px 0 0; }
.dsh-notifications [role=alert] { color: var(--dsw-alias-state-error-primary); }
.dsh-notifications-heading { margin: 24px 0 0; font-size: 14px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-notifications-actions { display: flex; align-items: center; gap: 8px; flex: none; }
@media (max-width: 520px) { .dsh-notifications .dsh-plugin-settings-row { align-items: stretch; flex-direction: column; gap: 8px; } }
`

interface MenuAction {
  id: string
  label: string
  icon?: { key: string }
  run?: () => void
}
interface ContextMenus {
  register(source: {
    id: string
    order: number
    target: 'session'
    observe(): Observable<unknown>[]
    resolve(target: { sessionId: string }): MenuAction[]
  }): () => void
}
interface IconSlots {
  inject(name: 'contextMenu.icon', callback: () => Generator<() => void>): void
  register(options: { name: 'contextMenu.icon'; key: string }, icon: typeof IconBellOutlineRegular): () => void
}

export function apply(ctx: Context) {
  const endpoint = endpointOf(document.baseURI)
  const preferences = createPreferenceStore({
    key: scopedName(endpoint, 'preferences'),
    storage: storage(),
    onStorage: (listener) => {
      const handle = (event: StorageEvent) => listener(event)
      window.addEventListener('storage', handle)
      return () => window.removeEventListener('storage', handle)
    },
  })
  ctx.effect(() => () => preferences.dispose(), 'notifications: preferences')
  const language = () => ctx.locale.getSnapshot().active
  const text = () => localizedCopy(copy, language())

  const chime = createChime(() => new AudioContext())
  ctx.effect(() => {
    // Browsers start audio only after a gesture on this page; remember one.
    const unlock = () => {
      if (preferences.getSnapshot().sound) chime.unlock()
    }
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
      chime.dispose()
    }
  }, 'notifications: sound')

  const sessions = ctx.sessions
  const mainSession = () =>
    Object.values(sessions.list.getSnapshot().byId).find((row) => (row.retainedBy.mainView ?? 0) > 0)?.id ?? null
  const channel =
    typeof BroadcastChannel === 'function' ? new BroadcastChannel(scopedName(endpoint, 'tabs')) : undefined
  const presence = createPresence({
    channel,
    tab: crypto.randomUUID(),
    local: () => (document.visibilityState === 'visible' && document.hasFocus() ? mainSession() : null),
  })
  ctx.effect(() => {
    const publish = () => presence.publish()
    window.addEventListener('focus', publish)
    window.addEventListener('blur', publish)
    document.addEventListener('visibilitychange', publish)
    const stopList = sessions.list.subscribe(publish)
    publish()
    return () => {
      stopList()
      window.removeEventListener('focus', publish)
      window.removeEventListener('blur', publish)
      document.removeEventListener('visibilitychange', publish)
      presence.dispose()
      channel?.close()
    }
  }, 'notifications: presence')

  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const open = (sessionId: string) => {
    window.focus()
    const target = sessions.subagentAddress(sessionId as SessionId) ?? (sessionId as SessionId)
    ctx.get('uiWorkspace')?.openSession(target)
  }
  const watch = (sessionId: string): Watch => {
    try {
      const reference = sessions.retain(sessionId as SessionId, { source: 'dungsilNotifications' })
      return {
        ready: reference.ready.then((binding) => ({
          eventSource: binding.eventSource as unknown as Observable<EventWindow>,
        })),
        release: () => reference.release(),
      }
    } catch (error) {
      return { ready: Promise.reject(error), release: () => {} }
    }
  }
  const notificationText = (): Text => {
    const words = text()
    return {
      title: (kind) => words[`title.${kind}`],
      body: (workspace) => (workspace === undefined ? words.bodyGeneric : format(words.body, { workspace })),
      lang: language(),
    }
  }

  ctx.effect(
    () =>
      electLeader(
        (navigator as Navigator & { locks?: Parameters<typeof electLeader>[0] }).locks,
        scopedName(endpoint, 'leader'),
        (() => {
          let stop: (() => void) | undefined
          return (leader: boolean) => {
            stop?.()
            stop = undefined
            if (!leader) return
            presence.refresh()
            const delivery = createDelivery({
              preferences: () => preferences.getSnapshot(),
              notifications: notificationApi,
              playSound: (volume) => chime.play(volume),
              byId: () => sessions.list.getSnapshot().byId,
              isViewing: (id) => presence.isViewing(id),
              text: notificationText,
              open,
            })
            const engine = createEngine({
              list: sessions.list,
              status: ctx.uiSession.sessionStatus,
              connection: connection.state,
              watch,
              emit: (event) => delivery.deliver(event),
              withdraw: (key) => delivery.withdraw(key),
              schedule: (callback, delay) => {
                const timer = setTimeout(callback, delay)
                return () => clearTimeout(timer)
              },
            })
            stop = () => {
              engine.dispose()
              delivery.dispose()
            }
          }
        })()
      ),
    'notifications: delivering tab'
  )

  ctx.effect(() => installStyles(styles), 'notifications: styles')
  ctx.effect(
    () =>
      installSettingsIcon(
        name,
        Object.values(copy).map((words) => words.nav),
        bellIconSvg
      ),
    'notifications: settings icon'
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 19,
        label: () => text().nav,
        inject: () => ({ ctx, preferences, chime }),
      },
      NotificationSettings
    )
  )

  ctx.inject(['contextMenus'], (child) => {
    const slots = child.slots as unknown as IconSlots
    slots.inject('contextMenu.icon', function* () {
      yield slots.register({ name: 'contextMenu.icon', key: 'notifications.mute' }, IconBellOffOutlineRegular)
      yield slots.register({ name: 'contextMenu.icon', key: 'notifications.unmute' }, IconBellOutlineRegular)
    })
    const contextMenus = (child as unknown as { contextMenus: ContextMenus }).contextMenus
    return contextMenus.register({
      id: 'dungsil.notifications',
      order: 450,
      target: 'session',
      observe: () => [preferences, ctx.locale, sessions.list],
      resolve: ({ sessionId }) => {
        const byId = sessions.list.getSnapshot().byId
        const row = byId[sessionId as SessionId]
        if (row === undefined || row.blank) return []
        const root = rootOf(byId, sessionId)
        const muted = preferences.getSnapshot().muted.includes(root)
        const words = text()
        return [
          {
            id: muted ? 'unmute' : 'mute',
            label: muted ? words.unmute : words.mute,
            icon: { key: muted ? 'notifications.unmute' : 'notifications.mute' },
            run: () => preferences.update((value) => toggleMuted(value, root, !muted)),
          },
        ]
      },
    })
  })
}
