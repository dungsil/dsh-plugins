import { AGENT_CHOICE, SNOOZE_CHOICES, type SnoozeEntry } from './snooze.ts'
import type { SidebarInboxKey } from './locale.js'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'

interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}
interface MenuAction {
  id: string
  label: string
  run?: () => void | Promise<void>
  failureLabel?: string
  icon?: { key: string }
  children?: MenuAction[]
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

/** Register against the native session context-menu source, not React-owned rows. */
export function installSnoozeMenu(options: {
  contextMenus: ContextMenus
  sessions: Pick<ISessions, 'list'>
  workspaces: {
    list: Observable<{ pinnedSessionIds: readonly string[]; archivedSessionIds: readonly string[] }>
  }
  state: Observable<ReadonlyMap<string, SnoozeEntry>> & {
    snooze(id: string, choice: (typeof SNOOZE_CHOICES)[number]): void
    wake(id: string): void
  }
  agent: { available(): boolean; subscribe(listener: () => void): () => void; choose(id: string): Promise<void> }
  locale: Observable<unknown>
  isActive: () => boolean
  isFlat: () => boolean
  translate: (key: SidebarInboxKey) => string
}): () => void {
  const { contextMenus, sessions, workspaces, state, agent, locale, isActive, isFlat, translate } = options
  return contextMenus.register({
    id: 'dungsil.sidebar-snooze',
    order: 400,
    target: 'session',
    observe: () => [
      state,
      locale,
      sessions.list,
      workspaces.list,
      { getSnapshot: () => agent.available(), subscribe: (listener) => agent.subscribe(listener) },
    ],
    resolve: ({ sessionId }) => {
      const list = sessions.list.getSnapshot()
      const key = list.ids.find((id) => id === sessionId)
      const row = key === undefined ? undefined : list.byId[key]
      const workspace = workspaces.list.getSnapshot()
      if (
        !isActive() ||
        !isFlat() ||
        !row ||
        row.blank ||
        row.origin === 'subagent' ||
        workspace.pinnedSessionIds.includes(sessionId) ||
        workspace.archivedSessionIds.includes(sessionId)
      )
        return []
      if (state.getSnapshot().has(sessionId)) {
        return [
          {
            id: 'wake',
            label: translate('snooze.wake'),
            icon: { key: 'sidebar-inbox.wake' },
            run: () => state.wake(sessionId),
          },
        ]
      }
      const children: MenuAction[] = SNOOZE_CHOICES.map((choice) => ({
        id: choice,
        label: translate(`snooze.${choice}`),
        run: () => state.snooze(sessionId, choice),
      }))
      if (agent.available())
        children.push({
          id: AGENT_CHOICE,
          label: translate('snooze.agent'),
          failureLabel: translate('snooze.agentFailure'),
          run: () => agent.choose(sessionId),
        })
      return [{ id: 'snooze', label: translate('snooze.action'), icon: { key: 'sidebar-inbox.snooze' }, children }]
    },
  })
}
