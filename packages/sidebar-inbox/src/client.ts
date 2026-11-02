import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { SessionRowOwnerProps, WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import { createElement, useSyncExternalStore } from 'react'
import { placeSessions, type Placement, type Settled } from './inbox.js'
import { installHeadings } from './headings.js'

export const name = 'dungsil-sidebar-inbox'
export const inject = ['slots', 'sessions', 'workspaces', 'uiSession']

const FLAT_ORDER = '__flat_session_order__'
const STORAGE_KEY = 'dungsil.sidebar-inbox.v1'

type View = Parameters<Parameters<WorkspaceBrowserProps['useStore']>[0]>[0]
type Ordering = Pick<View, 'groupBy' | 'orderBy' | 'sessionOrderByAccount'>
interface ViewInstance {
  getSnapshot(): View
  subscribe(listener: () => void): () => void
  store: { set(view: View): void }
}

function readSettled(): Settled {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(
      Object.entries(value).filter(([, time]) => typeof time === 'number' && Number.isFinite(time))
    )
  } catch {
    return {}
  }
}

/** Keep native React rows, search, menus, selection and keyboard order intact. */
export function apply(ctx: Context) {
  let settled = readSettled()
  let placements = new Map<string, Placement>()
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const getSnapshot = () => placements
  let view: ViewInstance | undefined
  let original: Ordering | undefined
  let refreshHeadings = () => {}

  const save = (next: Settled) => {
    if (JSON.stringify(next) === JSON.stringify(settled)) return
    // Persist before claiming success: a denied/quota-full store must not silently lose a settlement.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    settled = next
  }
  const reconcile = () => {
    const list = ctx.sessions.list.getSnapshot()
    const workspace = ctx.workspaces.list.getSnapshot()
    const result = placeSessions(
      list,
      ctx.uiSession.sessionStatus.getSnapshot(),
      workspace.pinnedSessionIds.filter((id) => !workspace.archivedSessionIds.includes(id)),
      settled
    )
    save(result.settled)
    const changed =
      placements.size !== result.placements.size ||
      [...result.placements].some(([id, value]) => {
        const previous = placements.get(id)
        return (
          previous?.section !== value.section ||
          previous.canSettle !== value.canSettle ||
          previous.settled !== value.settled ||
          previous.blank !== value.blank
        )
      })
    if (changed) {
      placements = result.placements
      for (const listener of listeners) listener()
    }
    if (view && list.phase === 'ready' && workspace.phase === 'ready') {
      const current = view.getSnapshot()
      const previous = current.sessionOrderByAccount[FLAT_ORDER] ?? []
      if (
        current.groupBy !== 'flat' ||
        current.orderBy !== 'manual' ||
        previous.length !== result.order.length ||
        previous.some((id, index) => id !== result.order[index])
      ) {
        view.store.set({
          ...current,
          groupBy: 'flat',
          orderBy: 'manual',
          sessionOrderByAccount: { ...current.sessionOrderByAccount, [FLAT_ORDER]: result.order },
        })
      }
    }
    refreshHeadings()
  }

  function SettleMenu({
    sessionId,
    useMenuOpenState,
  }: {
    sessionId: SessionRowOwnerProps['sessionId']
    useMenuOpenState: () => readonly [boolean, (open: boolean) => void]
  }) {
    const state = useSyncExternalStore(subscribe, getSnapshot).get(sessionId)
    const [, close] = useMenuOpenState()
    if (!state) return null
    return createElement(MenuItemButton, {
      children: state.settled ? 'Unsettle' : state.section === 'Pinned' ? 'Unpin to settle' : 'Settle',
      disabled: !state.canSettle,
      onSelect: () => {
        // Recheck live facts: activity can start while the menu is open.
        reconcile()
        const latest = placements.get(sessionId)
        if (!latest?.canSettle) return
        const next = { ...settled }
        if (latest.settled) delete next[sessionId]
        else next[sessionId] = ctx.sessions.list.getSnapshot().byId[sessionId].updatedAt
        save(next)
        close(false)
        reconcile()
      },
    })
  }

  // This declaration is owned by ui-workspace, so both loading orders and HMR
  // are covered. The v0.2.1 browser explicitly shares one create() instance.
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => {
    const entry =
      ctx.slots
        .entries('sidebar.workspaces')
        .find((candidate) => candidate.registrant === '@deepseek-ai/dsh-client-ui-workspace') ??
      ctx.slots.entries('sidebar.workspaces').find((candidate) => (candidate.options.priority ?? 0) === 0)
    if (!entry?.store || typeof entry.store === 'function')
      throw new Error('Sidebar Inbox requires the DSH 0.2.1 workspace view store')
    view = entry.store.create() as unknown as ViewInstance
    const current = view.getSnapshot()
    original = {
      groupBy: current.groupBy,
      orderBy: current.orderBy,
      sessionOrderByAccount: current.sessionOrderByAccount,
    }
    const restore = () => {
      if (view && original) view.store.set({ ...view.getSnapshot(), ...original })
    }
    // Restore the persisted native preference before reload; settlement has its own key.
    // Suspend subscriptions first, otherwise they would immediately reapply inbox ordering.
    let leaving = false
    const sync = () => {
      if (!leaving) reconcile()
    }
    const onPageHide = () => {
      leaving = true
      restore()
    }
    const onPageShow = () => {
      leaving = false
      reconcile()
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    const headings = installHeadings(() => placements)
    refreshHeadings = headings.refresh
    const disposers = [
      ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item', id: 'dungsil-settle', order: 50 }, SettleMenu),
      ctx.sessions.list.subscribe(sync),
      ctx.workspaces.list.subscribe(sync),
      ctx.uiSession.sessionStatus.subscribe(sync),
      view.subscribe(sync),
    ]
    reconcile()
    return () => {
      for (const dispose of disposers.reverse()) dispose()
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      headings.dispose()
      refreshHeadings = () => {}
      // Restore ordering only; keep pin/archive/filter changes made while enabled.
      restore()
      view = undefined
      original = undefined
    }
  })
}
