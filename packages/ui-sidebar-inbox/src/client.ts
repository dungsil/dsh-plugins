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
import { dictionaries, NS, type SidebarInboxKey } from './locale.js'

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
/** Native fallback used while the plugin is unavailable. */
const PREVIOUS_SORT_KEY = 'dungsil.sidebar-inbox.sort.v1'
/** Separate from the fallback: teardown must not overwrite the user's choice. */
const SELECTED_SORT_KEY = 'dungsil.sidebar-inbox.selected-sort.v1'

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
  // Ship dictionaries independently of separately installed language packs.
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => ctx.locale.register(NS, language, dictionary), `sidebar-inbox: ${language} copy`)
  }
  const bound = ctx.locale.bind(NS)
  const translate = (key: SidebarInboxKey) => {
    const base = ctx.locale.getSnapshot().active.toLowerCase().split(/[-_]/)[0]!
    // A regional language can declare an English fallback rather than its primary subtag.
    // Resolve our shipped base copy first, preserving host dictionaries for other languages.
    return Object.hasOwn(dictionaries, base) ? dictionaries[base as keyof typeof dictionaries][key] : bound(key)
  }
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

  // The browser declares this slot together with its shared view store, so
  // both loading orders and HMR are covered. The session menu is not an anchor:
  // DSH 0.2.2 declares it independently, before the browser entry can exist.
  ctx.slots.inject('sidebar.workspaces.session.row.action', () => {
    const entry =
      ctx.slots
        .entries('sidebar.workspaces')
        .find((candidate) => candidate.registrant === '@deepseek-ai/dsh-client-ui-workspace') ??
      ctx.slots.entries('sidebar.workspaces').find((candidate) => (candidate.options.priority ?? 0) === 0)
    if (!entry?.store || typeof entry.store === 'function')
      throw new Error('Sidebar Inbox requires the DSH 0.2.1 workspace view store')
    view = entry.store.create() as unknown as ViewInstance
    const current = view.getSnapshot()
    let selectedSort: string | null = null
    let hasPreviousSort = false
    try {
      selectedSort = localStorage.getItem(SELECTED_SORT_KEY)
      hasPreviousSort = localStorage.getItem(PREVIOUS_SORT_KEY) !== null
    } catch {
      // The default still works for this mount when storage is unavailable.
    }
    const validSelection = selectedSort === AGENT_ACTIVITY || selectedSort === 'manual' || selectedSort === 'updated'
    // Migrate existing users without overriding a native sort they chose. A new
    // installation starts in Agent activity, even if the host was grouped.
    const initialSort = validSelection
      ? selectedSort
      : isAgentActivity(current.orderBy) || !hasPreviousSort
        ? AGENT_ACTIVITY
        : current.orderBy
    if (initialSort === AGENT_ACTIVITY && !isAgentActivity(current.orderBy)) {
      if (current.orderBy === 'manual' || current.orderBy === 'updated') writePreviousSort(current.orderBy)
    }
    const rememberSelection = () => {
      const mode = String(view!.getSnapshot().orderBy)
      if (mode === selectedSort) return
      try {
        localStorage.setItem(SELECTED_SORT_KEY, mode)
        selectedSort = mode
      } catch {
        // Storage denial must not prevent sorting or teardown.
      }
    }
    view.store.set({
      ...current,
      ...(initialSort === AGENT_ACTIVITY ? { groupBy: 'flat' as const } : {}),
      orderBy: initialSort as View['orderBy'],
    })
    rememberSelection()
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
      rememberSelection()
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
      // Unsubscribe before restoring a host-safe fallback, so teardown does not
      // save that fallback as the user's selection. The next mount restores it;
      // native group, filter and pin/archive choices stay as the user left them.
      if (isActive()) {
        const current = view!.getSnapshot()
        view!.store.set({ ...current, orderBy: readPreviousSort() })
      }
      view = undefined
    }
  })
}
