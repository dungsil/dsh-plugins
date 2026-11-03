import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import { placeSessions, type Placement } from './inbox.js'
import { installHeadings } from './headings.js'
import { en, ko, NS } from './locale.js'

export const name = 'dungsil-sidebar-inbox'
export const inject = ['slots', 'sessions', 'workspaces', 'uiSession', 'locale']

const FLAT_ORDER = '__flat_session_order__'

type View = Parameters<Parameters<WorkspaceBrowserProps['useStore']>[0]>[0]
type Ordering = Pick<View, 'groupBy' | 'orderBy' | 'sessionOrderByAccount'>
interface ViewInstance {
  getSnapshot(): View
  subscribe(listener: () => void): () => void
  store: { set(view: View): void }
}

/** Keep native React rows, search, menus, selection and keyboard order intact. */
export function apply(ctx: Context) {
  // This plugin owns its dictionaries, so the labels follow the UI language on
  // their own: Korean needs no separate language pack to be installed.
  ctx.effect(() => ctx.locale.register(NS, 'en', en), 'sidebar-inbox: English copy')
  ctx.effect(() => ctx.locale.register(NS, 'ko', ko), 'sidebar-inbox: Korean copy')
  const translate = ctx.locale.bind(NS)
  let placements = new Map<string, Placement>()
  let view: ViewInstance | undefined
  let original: Ordering | undefined
  let refreshHeadings = () => {}

  const reconcile = () => {
    const list = ctx.sessions.list.getSnapshot()
    const workspace = ctx.workspaces.list.getSnapshot()
    const result = placeSessions(
      list,
      ctx.uiSession.sessionStatus.getSnapshot(),
      workspace.pinnedSessionIds,
      workspace.archivedSessionIds
    )
    const changed =
      placements.size !== result.placements.size ||
      [...result.placements].some(([id, value]) => {
        const previous = placements.get(id)
        return previous === undefined || previous.section !== value.section || previous.blank !== value.blank
      })
    if (changed) placements = result.placements
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

  // This declaration is owned by ui-workspace, so both loading orders and HMR
  // are covered. The v0.2.1 browser explicitly shares one create() instance.
  // DSH already archives sessions from its own row menu, so this plugin adds no
  // menu item and only reads that state.
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
    // Restore the persisted native preference before reload. Suspend subscriptions
    // first, otherwise they would immediately reapply inbox ordering.
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
    const headings = installHeadings(
      () => placements,
      () => ({ working: translate('heading.working'), archived: translate('heading.archived') }),
      () => (view?.getSnapshot().archivedFilter ?? 'default') === 'show'
    )
    refreshHeadings = headings.refresh
    const disposers = [
      ctx.sessions.list.subscribe(sync),
      ctx.workspaces.list.subscribe(sync),
      ctx.uiSession.sessionStatus.subscribe(sync),
      view.subscribe(sync),
      // Relabel mounted headings and the archived toggle when the UI language changes.
      ctx.locale.subscribe(() => refreshHeadings()),
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
