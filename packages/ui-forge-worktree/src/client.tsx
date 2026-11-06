import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, MenuItemButton } from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { ComposerTrigger } from '@dungsil/dsh-ui/composer'
import { IconBranchOutlineRegular, IconCheckOutlineRegular, IconPlusOutlineRegular } from '@dungsil/dsh-ui/icons'
import { copy } from './copy.js'
import { styles } from './styles.js'

export const name = 'dungsil-ui-forge-worktree'
export const inject = ['slots', 'locale', 'remote', 'remote.forgePanel']
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
  dispose() {
    this.lifetime.abort()
    this.stopFeed()
    this.listeners.clear()
  }
}

export function apply(ctx: Context) {
  const remote = (ctx as unknown as { remote: { forgePanel: ForgeRemote } }).remote.forgePanel
  const controllers = new Set<SelectionController>()
  ctx.effect(() => () => {
    for (const controller of controllers) controller.dispose()
    controllers.clear()
  })
  function Picker({ sessionId, useSession, useInput }: Props) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = copy[active.startsWith('ko') ? 'ko' : active.startsWith('zh') ? 'zh' : 'en']
    const [controller] = useState(() => new SelectionController(remote, sessionId))
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const inputBusy = useInput((input) => input.phase !== 'plain')
    const [open, setOpen] = useState(false)
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
    const choose = (choice: 'new' | 'current') => {
      setOpen(false)
      if (available.current) void controller.choose(choice)
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
                if (available.current) setOpen((value) => !value)
              }}
              onKeyDown={(event) => {
                if (available.current && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault()
                  setOpen(true)
                }
              }}
            />
          }
        >
          <MenuItemButton
            icon={<IconPlusOutlineRegular />}
            current={requested}
            disabled={!!worktree?.blocker}
            onSelect={() => choose('new')}
          >
            <span className="dsh-forge-worktree-option">
              <span>{text.create}</span>
              {requested && <IconCheckOutlineRegular />}
            </span>
          </MenuItemButton>
          <MenuItemButton icon={<IconBranchOutlineRegular />} current={!requested} onSelect={() => choose('current')}>
            <span className="dsh-forge-worktree-option">
              <span>{branch}</span>
              <span className="dsh-forge-worktree-badge">{text.current}</span>
              {!requested && <IconCheckOutlineRegular />}
            </span>
          </MenuItemButton>
        </Menu>
        <span
          id={status}
          className={state.error ? 'dsh-forge-worktree-error' : 'dsh-forge-worktree-sr'}
          role={state.error ? 'alert' : 'status'}
        >
          {state.error
            ? text.error
            : state.busy
              ? label
              : worktree?.blocker
                ? text.blocked
                : requested
                  ? text.reserved
                  : ''}
        </span>
        {state.error && (
          <button type="button" className="dsh-forge-worktree-refresh" onClick={controller.refresh}>
            {text.refresh}
          </button>
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
