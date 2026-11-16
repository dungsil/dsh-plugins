import type { ScheduleLink } from './schedule-link.ts'
import type { SnoozeState, SnoozeStorage } from './snooze-state.ts'
import type { SnoozeEntry } from './snooze.ts'

/** Storage key of the automation targets the user kept visible: a JSON array of session ids. */
export const AUTOMATION_VISIBLE_KEY = 'dungsil.sidebar-inbox.automation-visible.v1'

type MenuState = Pick<SnoozeState, 'getSnapshot' | 'snooze' | 'subscribe' | 'wake'>

export interface AutomationVisibilityOptions {
  readonly storage: SnoozeStorage
  readonly snooze: MenuState
  readonly automation: Pick<ScheduleLink, 'getSnapshot' | 'subscribe'>
  readonly placement: {
    readonly isSnoozed: (sessionId: string) => boolean
    readonly subscribe: (listener: () => void) => () => void
  }
  readonly onChange: () => void
}

export interface AutomationVisibility {
  /** Automation targets the user has not kept visible. Idle ones are placed as snoozed. */
  readonly getAutomationIds: () => ReadonlySet<string>
  /** Snooze state seen by the menu: idle automation targets read as snoozed until woken. */
  readonly menuState: MenuState
  readonly keepVisible: (sessionId: string) => void
}

/**
 * Tracks which automation destinations are hidden by default and which the user chose to
 * keep. Waking an automation target keeps it visible; snoozing it again hides it again.
 */
export function createAutomationVisibility({
  storage,
  snooze,
  automation,
  placement,
  onChange,
}: AutomationVisibilityOptions): AutomationVisibility {
  const read = (): Set<string> => {
    try {
      const raw = storage.read()
      const value: unknown = raw === null ? null : JSON.parse(raw)
      return new Set(
        Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && id !== '') : []
      )
    } catch {
      return new Set()
    }
  }
  const visible = read()
  const listeners = new Set<() => void>()

  const save = (): void => {
    try {
      storage.write(JSON.stringify([...visible]))
    } catch {
      // Keep this page's exceptions even when storage is blocked.
    }
  }
  const notify = (): void => {
    for (const listener of listeners) listener()
    onChange()
  }
  const addVisible = (id: string): boolean => {
    if (id === '' || visible.has(id)) return false
    visible.add(id)
    save()
    return true
  }
  const getAutomationIds = (): ReadonlySet<string> =>
    new Set([...automation.getSnapshot().sessionIds].filter((id) => !visible.has(id)))

  return {
    getAutomationIds,
    keepVisible: (id) => {
      if (addVisible(id)) notify()
    },
    menuState: {
      getSnapshot: () => {
        const entries = new Map<string, SnoozeEntry>(snooze.getSnapshot())
        for (const id of getAutomationIds()) {
          if (!entries.has(id) && placement.isSnoozed(id)) entries.set(id, Number.POSITIVE_INFINITY)
        }
        return entries
      },
      snooze: (id, choice) => {
        const changed = visible.delete(id)
        if (changed) save()
        snooze.snooze(id, choice)
        if (changed) notify()
      },
      subscribe: (listener) => {
        listeners.add(listener)
        const stopSnooze = snooze.subscribe(listener)
        const stopAutomation = automation.subscribe(listener)
        const stopPlacement = placement.subscribe(listener)
        return () => {
          listeners.delete(listener)
          stopSnooze()
          stopAutomation()
          stopPlacement()
        }
      },
      wake: (id) => {
        const changed = automation.getSnapshot().sessionIds.has(id) && addVisible(id)
        snooze.wake(id)
        if (changed) notify()
      },
    },
  }
}
