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
import { installSortOption } from './menu.js'
import { en, ko, NS } from './locale.js'

export const name = 'dungsil-sidebar-inbox'
export const inject = ['slots', 'sessions', 'workspaces', 'uiSession', 'locale']

/** Native flat-list account key from ui-workspace. */
const FLAT_ORDER = '__flat_session_order__'
/**
 * Plugin-owned sort mode persisted through the shared view store. Native
 * projections treat every non-'updated' value like 'manual', so the saved flat
 * order is what the sidebar renders while this mode is selected.
 */
const AGENT_ACTIVITY = 'agent-activity'
/** Remembers the native sort; its presence also marks first-use setup complete. */
const PREVIOUS_SORT_KEY = 'dungsil.sidebar-inbox.sort.v1'

type View = Parameters<Parameters<WorkspaceBrowserProps['useStore']>[0]>[0]
type NativeSort = Extract<View['orderBy'], 'manual' | 'updated'>
interface ViewInstance {
  getSnapshot(): View
  subscribe(listener: () => void): () => void
  store: { set(view: View): void }
}

function isAgentActivity(orderBy: View['orderBy']): boolean {
  return String(orderBy) === AGENT_ACTIVITY
}

/** The native sort the plugin mode replaced, so opting out returns to it. */
function readPreviousSort(): NativeSort {
  try {
    return localStorage.getItem(PREVIOUS_SORT_KEY) === 'updated' ? 'updated' : 'manual'
  } catch {
    return 'manual'
  }
}

function writePreviousSort(mode: NativeSort) {
  try {
    localStorage.setItem(PREVIOUS_SORT_KEY, mode)
  } catch {
    // A denied store only loses the remembered mode; the opt-out still works.
  }
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
  let refreshHeadings = () => {}
  let refreshSortOption = () => {}

  const isActive = () => view !== undefined && isAgentActivity(view.getSnapshot().orderBy)
  /** The agent-activity order only fits the hierarchy-free single list. */
  const isFlat = () => view !== undefined && view.getSnapshot().groupBy === 'flat'
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
        return previous?.section !== value.section || previous.blank !== value.blank
      })
    if (changed) placements = result.placements
    // Only the selected plugin mode writes an order, and only for the flat list;
    // native group, sort and filter choices are otherwise left exactly as the
    // user set them.
    if (view !== undefined && list.phase === 'ready' && workspace.phase === 'ready' && isActive() && isFlat()) {
      const current = view.getSnapshot()
      const previous = current.sessionOrderByAccount[FLAT_ORDER] ?? []
      if (previous.length !== result.order.length || previous.some((id, index) => id !== result.order[index])) {
        view.store.set({
          ...current,
          sessionOrderByAccount: { ...current.sessionOrderByAccount, [FLAT_ORDER]: result.order },
        })
      }
    }
    refreshHeadings()
    refreshSortOption()
  }

  const toggleSort = () => {
    if (view === undefined || !isFlat()) return
    const current = view.getSnapshot()
    if (isAgentActivity(current.orderBy)) {
      view.store.set({ ...current, orderBy: readPreviousSort() })
      return
    }
    if (current.orderBy === 'manual' || current.orderBy === 'updated') writePreviousSort(current.orderBy)
    // The native store persists this value; native projections read it as manual.
    view.store.set({ ...current, orderBy: AGENT_ACTIVITY as View['orderBy'] })
  }

  // This declaration is owned by ui-workspace, so both loading orders and HMR
  // are covered. The v0.2.1 browser explicitly shares one create() instance.
  // DSH already archives sessions from its own row menu, so this plugin adds no
  // session menu item and only reads that state; the injection is the lifecycle
  // anchor that exposes the shared view store.
  ctx.slots.inject('sidebar.workspaces.session.menu.item', () => {
    const entry =
      ctx.slots
        .entries('sidebar.workspaces')
        .find((candidate) => candidate.registrant === '@deepseek-ai/dsh-client-ui-workspace') ??
      ctx.slots.entries('sidebar.workspaces').find((candidate) => (candidate.options.priority ?? 0) === 0)
    if (!entry?.store || typeof entry.store === 'function')
      throw new Error('Sidebar Inbox requires the DSH 0.2.1 workspace view store')
    view = entry.store.create() as unknown as ViewInstance
    // Default new installations to the supported flat-list mode once. Existing
    // users already have a remembered sort, including those who opted out.
    try {
      if (localStorage.getItem(PREVIOUS_SORT_KEY) === null && !isActive()) {
        const current = view.getSnapshot()
        if (current.orderBy === 'manual' || current.orderBy === 'updated') {
          localStorage.setItem(PREVIOUS_SORT_KEY, current.orderBy)
          view.store.set({ ...current, groupBy: 'flat', orderBy: AGENT_ACTIVITY as View['orderBy'] })
        }
      }
    } catch {
      // Without persistent storage, leave the choice to the user on each load.
    }
    const headings = installHeadings(
      () => placements,
      () => ({ working: translate('heading.working'), archived: translate('heading.archived') }),
      () => (view?.getSnapshot().archivedFilter ?? 'default') === 'show',
      isActive
    )
    refreshHeadings = () => headings.refresh()
    const sortOption = installSortOption({
      label: () => translate('sort.agentActivity'),
      isActive,
      isEnabled: isFlat,
      onToggle: toggleSort,
    })
    refreshSortOption = () => sortOption.refresh()
    const sync = () => {
      // Switching the native group by away from the single list releases the
      // plugin mode: the state order has no meaning inside Workspace groups.
      if (view !== undefined && isActive() && !isFlat()) {
        view.store.set({ ...view.getSnapshot(), orderBy: readPreviousSort() })
      }
      reconcile()
    }
    const disposers = [
      ctx.sessions.list.subscribe(sync),
      ctx.workspaces.list.subscribe(sync),
      ctx.uiSession.sessionStatus.subscribe(sync),
      view.subscribe(sync),
      // Relabel mounted headings and the sort row when the UI language changes.
      ctx.locale.subscribe(() => {
        refreshHeadings()
        refreshSortOption()
      }),
    ]
    sync()
    return () => {
      for (const dispose of disposers.reverse()) dispose()
      headings.dispose()
      sortOption.dispose()
      refreshHeadings = () => {}
      refreshSortOption = () => {}
      // Leaving the plugin releases its own sort mode; native group, sort,
      // filter and pin/archive choices stay as the user left them.
      if (isActive()) {
        const current = view!.getSnapshot()
        view!.store.set({ ...current, orderBy: readPreviousSort() })
      }
      view = undefined
    }
  })
}
