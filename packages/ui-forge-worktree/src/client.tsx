import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, MenuItemButton, Tooltip } from '@dungsil/dsh-ui'
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { ComposerTrigger } from '@dungsil/dsh-ui/composer'
import {
  IconBranchOutlineRegular,
  IconCheckOutlineRegular,
  IconPlusOutlineRegular,
  IconWarningTriangleOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import { copy } from './copy.js'
import { WORKTREES_PAGE_SIZE, rowsOf, type MenuRow, type WorktreeList } from './menu.js'
import { styles } from './styles.js'
import { createDefaultCheckout, readMethod, type Checkout } from './default-checkout.js'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'

export const name = 'dungsil-ui-forge-worktree'
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.forgePanel']
type Props = PropsRuntime<'conversation.input.left'>
// The Remote is mounted by Forge; this adapter neither mounts nor replaces it.
export interface Panel {
  directory: string
  checkout: { state: string; checkout?: { branch: string | null; commit: string | null } }
  worktree: {
    editable: boolean
    blocker: string | null
    request: { from: string | null } | null
    created: { branch: string } | null
    creation: { phase: 'prepare' | 'checkout' } | null
    restoration: { phase: 'prepare' | 'checkout' } | null
    waiting: string | null
    failure: { message: string } | null
    missing: { branchExists: boolean | null } | null
  }
}
type Result = { ok: true; value?: unknown } | { ok: false; error: unknown }
interface Stream extends AsyncIterable<Panel> {
  dispose(): void
}
export interface ForgeRemote {
  follow(id: string, signal: AbortSignal): Stream
  requestWorktree(id: string, from: string | null, signal: AbortSignal): Promise<Result>
  cancelWorktree(id: string, signal: AbortSignal): Promise<Result>
}
type Snapshot = { panel?: Panel; busy: boolean; error: boolean }

/** One serialized writer, with selection receipts taken from a fresh Host stream. */
export class SelectionController {
  private snapshot: Snapshot = { busy: false, error: false }
  private listeners = new Set<() => void>()
  private lifetime = new AbortController()
  private feed?: { controller: AbortController; stream: Stream; timer?: ReturnType<typeof setTimeout> }
  private writing = false
  constructor(
    private remote: ForgeRemote,
    private id: string
  ) {}
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(next: Snapshot) {
    if (this.lifetime.signal.aborted) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
  private stopFeed() {
    const feed = this.feed
    this.feed = undefined
    if (!feed) return
    clearTimeout(feed.timer)
    feed.controller.abort()
    try {
      feed.stream.dispose()
    } catch {
      /* Disposal must not escape plugin cleanup. */
    }
  }
  // React StrictMode replays an effect's setup after its cleanup on the same instance.
  activate() {
    if (this.lifetime.signal.aborted) this.lifetime = new AbortController()
    this.writing = false
    this.follow()
  }
  refresh = () => {
    if (!this.writing) this.follow()
  }
  private follow(expected?: 'new' | 'current') {
    this.stopFeed()
    if (this.lifetime.signal.aborted) return
    this.publish({ ...this.snapshot, busy: true, error: false })
    const controller = new AbortController()
    let stream: Stream
    try {
      stream = this.remote.follow(this.id, controller.signal)
    } catch {
      this.writing = false
      this.publish({ ...this.snapshot, busy: false, error: true })
      return
    }
    const feed = { controller, stream, timer: undefined as ReturnType<typeof setTimeout> | undefined }
    this.feed = feed
    const fail = () => {
      if (this.feed !== feed) return
      this.stopFeed()
      this.writing = false
      this.publish({ ...this.snapshot, busy: false, error: true })
    }
    feed.timer = setTimeout(fail, 15000)
    void (async () => {
      try {
        for await (const panel of stream) {
          if (this.feed !== feed || controller.signal.aborted) return
          const confirmed =
            expected === undefined ||
            (expected === 'new'
              ? panel.worktree.request !== null || panel.worktree.created !== null
              : panel.worktree.request === null)
          if (confirmed) {
            expected = undefined
            this.writing = false
            clearTimeout(feed.timer)
          }
          this.publish({ panel, busy: !confirmed, error: false })
        }
        fail()
      } catch {
        fail()
      }
    })()
  }
  async choose(choice: 'new' | 'current') {
    const { panel, busy, error } = this.snapshot
    if (
      this.writing ||
      busy ||
      error ||
      !panel ||
      !panel.worktree.editable ||
      panel.worktree.creation ||
      panel.worktree.restoration ||
      panel.worktree.created ||
      (choice === 'new' && panel.worktree.blocker)
    )
      return
    if ((choice === 'new') === (panel.worktree.request !== null)) return
    this.writing = true
    this.stopFeed()
    const lifetime = this.lifetime
    this.publish({ ...this.snapshot, busy: true, error: false })
    try {
      const result =
        choice === 'new'
          ? await this.remote.requestWorktree(this.id, null, lifetime.signal)
          : await this.remote.cancelWorktree(this.id, lifetime.signal)
      if (lifetime.signal.aborted) return
      if (!result.ok) throw result.error
      // RPC success is not a state receipt. Re-follow reads the Host's current state
      // after the mutation, avoiding acceptance of a pre-write buffered frame.
      this.follow(choice)
    } catch {
      if (!lifetime.signal.aborted) {
        this.writing = false
        this.stopFeed()
        this.publish({ ...this.snapshot, busy: false, error: true })
      }
    }
  }
  async enter(path: string, connection: ConnectionHandle) {
    const { panel, busy, error } = this.snapshot
    if (
      this.writing ||
      busy ||
      error ||
      !panel?.worktree.editable ||
      panel.worktree.created ||
      panel.worktree.creation ||
      panel.worktree.restoration
    )
      return
    this.writing = true
    this.stopFeed()
    this.publish({ ...this.snapshot, busy: true, error: false })
    const lifetime = this.lifetime
    const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)])
    try {
      if (panel.worktree.request) {
        const cancelled = await this.remote.cancelWorktree(this.id, signal)
        if (!cancelled.ok) throw cancelled.error
        const stream = this.remote.follow(this.id, signal)
        const stop = () => stream.dispose()
        signal.addEventListener('abort', stop, { once: true })
        let confirmed = false
        try {
          for await (const next of stream) {
            if (
              next.worktree.request === null &&
              next.worktree.editable &&
              !next.worktree.creation &&
              !next.worktree.created &&
              !next.worktree.restoration
            ) {
              confirmed = true
              break
            }
          }
        } finally {
          signal.removeEventListener('abort', stop)
          stream.dispose()
        }
        if (!confirmed) throw Error('Cancellation was not confirmed')
      }
      signal.throwIfAborted()
      const moved = await connection.rpc.call(
        '/api',
        'dungsil-worktree-picker/enter',
        { sessionId: this.id, path },
        signal
      )
      signal.throwIfAborted()
      if (!moved.ok) throw Error('Worktree move failed')
      if (!lifetime.signal.aborted) this.follow()
    } catch {
      if (!lifetime.signal.aborted) {
        this.writing = false
        this.stopFeed()
        this.publish({ ...this.snapshot, busy: false, error: true })
      }
    }
  }
  dispose() {
    this.lifetime.abort()
    this.stopFeed()
    this.listeners.clear()
  }
}

export function apply(ctx: Context) {
  const remote = (ctx as unknown as { remote: { forgePanel: ForgeRemote } }).remote.forgePanel
  const controllers = new Set<SelectionController>()
  const defaults = createDefaultCheckout()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  ctx.effect(() => () => {
    for (const controller of controllers) controller.dispose()
    controllers.clear()
  })
  function Picker({ sessionId, useSession, useInput, useProjection }: Props) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = localizedCopy(copy, active)
    const t = (key: keyof (typeof copy)['en']): string => text[key]
    const [controller] = useState(() => new SelectionController(remote, sessionId))
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const inputBusy = useInput((input) => input.phase !== 'plain')
    const blank = useSession((s) => s.blank && !s.promptAttempted)
    const touched = useProjection('dungsilCheckoutTouched')
    const [preferred, setPreferred] = useState<Checkout | null>(null)
    useEffect(() => {
      const abort = new AbortController()
      void connection.rpc
        .call('/api', readMethod, {}, abort.signal)
        .then((result) => {
          if (abort.signal.aborted || !result.ok) return
          const value = (result.value as { defaultCheckout?: unknown } | null)?.defaultCheckout
          if (value === 'current' || value === 'worktree') setPreferred(value)
        })
        .catch(() => {})
      return () => abort.abort()
    }, [])
    const [open, setOpen] = useState(false)
    const [list, setList] = useState<WorktreeList | undefined>()
    const [listError, setListError] = useState(false)
    const [visibleCount, setVisibleCount] = useState(WORKTREES_PAGE_SIZE)
    const status = useId()
    const available = useRef(false)
    const worktree = state.panel?.worktree
    const disabled =
      unavailable ||
      inputBusy ||
      state.busy ||
      state.error ||
      !worktree?.editable ||
      !!worktree.created ||
      !!worktree.creation ||
      !!worktree.restoration
    available.current = !disabled
    const branch = state.panel?.checkout.checkout?.branch ?? text.detached
    const requested = !!worktree?.request
    const label = state.busy
      ? state.panel
        ? text.saving
        : text.loading
      : (worktree?.created?.branch ?? (requested ? text.create : branch))
    useEffect(() => {
      controllers.add(controller)
      controller.activate()
      const reset = ctx.on('connection/reset', () => controller.refresh())
      return () => {
        reset()
        controller.dispose()
        controllers.delete(controller)
      }
    }, [controller])
    useEffect(() => {
      if (disabled) setOpen(false)
    }, [disabled])
    useEffect(() => {
      if (touched === undefined) return
      defaults.apply(
        sessionId,
        preferred,
        state.panel,
        !disabled && !open,
        blank && !touched,
        () => void controller.choose('new')
      )
    }, [sessionId, preferred, state.panel, disabled, open, blank, touched, controller])
    useEffect(() => {
      if (!open) return
      const abort = new AbortController()
      setList(undefined)
      setListError(false)
      setVisibleCount(WORKTREES_PAGE_SIZE)
      void connection.rpc
        .call('/api', 'dungsil-worktree-picker/list', { sessionId }, abort.signal)
        .then((result) => {
          if (abort.signal.aborted) return
          if (result.ok) setList(result.value as WorktreeList)
          else setListError(true)
        })
        .catch(() => {
          if (!abort.signal.aborted) setListError(true)
        })
      return () => abort.abort()
    }, [open, sessionId])
    const rows = rowsOf({ blocked: !!worktree?.blocker, list, listError, requested, t, visibleCount })
    const inWorktree = list !== undefined && list.current !== list.origin.root
    const statusText = state.error
      ? text.error
      : state.busy
        ? label
        : worktree?.blocker
          ? text.blocked
          : requested
            ? text.reserved
            : inWorktree
              ? text.attached
              : ''
    const iconOf = (row: MenuRow) => {
      if (row.kind === 'new') return <IconPlusOutlineRegular />
      if (row.kind === 'origin' || row.kind === 'existing') return <IconBranchOutlineRegular />
      return undefined
    }
    const choose = (row: MenuRow): void => {
      // 더 불러오기는 메뉴를 연 채로 페이지만 늘린다. 안내 행은 아무것도 하지 않는다.
      if (row.kind === 'more') {
        setVisibleCount((count) => count + WORKTREES_PAGE_SIZE)
        return
      }
      if (row.kind === 'info') return
      defaults.mark(sessionId)
      setOpen(false)
      if (!available.current) return
      if (row.kind === 'new') void controller.choose('new')
      else if (row.kind === 'origin' && list !== undefined && list.current !== list.origin.root)
        void controller.enter(list.origin.directory, connection)
      else if (row.kind === 'origin') void controller.choose('current')
      else if (row.path !== undefined && (requested || row.path !== list?.current))
        void controller.enter(row.path, connection)
    }
    return (
      <div className="dsh-forge-worktree">
        <Menu
          open={open}
          side="top"
          portal
          className="dsh-forge-worktree-picker"
          listClassName="dsh-forge-worktree-menu"
          onClose={() => setOpen(false)}
          anchor={
            <ComposerTrigger
              icon={<IconBranchOutlineRegular />}
              label={label}
              disabled={disabled}
              className="dsh-forge-worktree-trigger"
              aria-label={`${text.title}: ${label}`}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-busy={state.busy}
              aria-describedby={status}
              title={worktree && !worktree.editable ? text.locked : `${text.title}: ${label}`}
              onClick={() => {
                if (available.current) {
                  defaults.mark(sessionId)
                  setOpen((value) => !value)
                }
              }}
              onKeyDown={(event) => {
                if (available.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault()
                  defaults.mark(sessionId)
                  setOpen(true)
                }
              }}
            />
          }
        >
          {rows.map((row) => {
            const icon = iconOf(row)
            return (
              <MenuItemButton
                key={row.id}
                icon={icon}
                current={row.current}
                disabled={row.disabled ?? false}
                separatorBefore={row.kind === 'new'}
                onSelect={() => choose(row)}
              >
                {row.kind === 'more' ? (
                  <span className="dsh-forge-worktree-more">{row.text}</span>
                ) : (
                  <span className="dsh-forge-worktree-option" title={row.path}>
                    <span>{row.text}</span>
                    {row.badge === undefined ? null : <span className="dsh-forge-worktree-badge">{row.badge}</span>}
                    {row.current && <IconCheckOutlineRegular />}
                  </span>
                )}
              </MenuItemButton>
            )
          })}
        </Menu>
        <span id={status} className="dsh-forge-worktree-sr" role={state.error ? 'alert' : 'status'}>
          {statusText}
        </span>
        {state.error && (
          <Tooltip label={text.error} portal side="top" maxWidth={280} openOnClick>
            <button type="button" className="dsh-forge-worktree-warning" aria-label={text.error}>
              <IconWarningTriangleOutlineRegular />
            </button>
          </Tooltip>
        )}
      </div>
    )
  }
  // Shadow this ID in this slot only. Forge's dock card and all sidebar entries
  // remain registered; unloading this contribution restores the original option.
  ctx.slots.inject('conversation.hero.options', () =>
    ctx.slots.register(
      {
        name: 'conversation.hero.options',
        id: 'forge-panel.worktree',
        priority: -100,
      },
      () => null
    )
  )
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: name,
        order: -100,
      },
      (props) => <Picker key={props.sessionId} {...props} />
    )
  )
  ctx.effect(() => installStyles(styles), 'ui-forge-worktree: composer styles')
}
