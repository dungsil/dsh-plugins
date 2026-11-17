import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-forge/remote'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { ForgePanelState } from '@deepseek-ai/dsh-experimental-client-ui-forge/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, Pill } from '@dungsil/dsh-ui'
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { IconBranchOutlineRegular, IconChevronDownOutlineRegular } from '@dungsil/dsh-ui/icons'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import ja from '../locale/ja.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import de from '../locale/de.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }
import { canCreatePr, localKey, nextIndex, requestForCheckout } from './model.js'
import {
  channel,
  inspectMethod,
  methods,
  runMethod,
  type ActionErrorCode,
  type DefaultAction,
  type IntegrationBlocker,
  type IntegrationMethod,
  type IntegrationProposal,
} from './protocol.js'
import { styles } from './styles.js'

export const name = 'dungsil-ui-forge-chip'
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.forgePanel', 'sidebarRight', 'shortcuts']

const translations: Record<string, typeof en> = { en, ko, zh, ja, es, fr, de, ru, pt }
type Copy = Omit<typeof en, 'meta'>
type Busy = DefaultAction | 'pr'
type Local = { readonly key: string; readonly failed: boolean; readonly dirty: boolean }
/** Per-session state that outlives the chip, so switching sessions neither blanks nor repeats anything. */
type Entry = {
  readonly panel?: ForgePanelState
  readonly local?: Local
  readonly busy?: Busy
  readonly error?: keyof Copy
  readonly nonce?: number
}
type Shortcut = { readonly run: () => void; readonly secondary?: () => void; readonly disabled: boolean }
type ShortcutResolution =
  | { status: 'handled'; run(): void }
  | { status: 'blocked'; reason: string }
  | { status: 'pass' }
type Bar = {
  readonly element: () => HTMLElement | null
  readonly resolve: (index: number, secondary: boolean) => ShortcutResolution
}

/** PR state stays current while the composer is visible without hammering the code host. */
const PR_POLL_MS = 60000
const SHORTCUT_SLOTS = 9
const ITEM = '[data-forge-chip-item]:not(:disabled)'
const shortcutId = (slot: number, secondary: boolean) =>
  `dungsil.forge-chip.${secondary ? 'alternate' : 'action'}-${slot}` as ShortcutCommandId

const errorKeys: Record<ActionErrorCode, keyof Copy> = {
  unavailable: 'errorUnavailable',
  'nothing-to-commit': 'errorNothingToCommit',
  'message-failed': 'errorMessageFailed',
  'commit-failed': 'errorCommitFailed',
  'no-remote': 'errorNoRemote',
  'push-failed': 'errorPushFailed',
  'not-pushed': 'errorNotPushed',
  unsupported: 'errorUnsupported',
  'pr-unavailable': 'errorPrUnavailable',
  'pr-failed': 'errorPrFailed',
}

const methodLabels: Record<IntegrationMethod, keyof Copy> = {
  ff: 'integrateFf',
  'cherry-pick': 'integrateCherryPick',
  merge: 'integrateMerge',
  rebase: 'integrateRebase',
  squash: 'integrateSquash',
}
const blockerLabels: Record<IntegrationBlocker, keyof Copy> = {
  'read-only': 'blockedReadOnly',
  detached: 'blockedDetached',
  'in-progress': 'blockedInProgress',
  staged: 'blockedStaged',
  overlap: 'blockedOverlap',
}
const failureLabels: Record<string, keyof Copy> = {
  stale: 'integrationStale',
  busy: 'integrationBusy',
  blocked: 'integrationStale',
  failed: 'integrationFailed',
  'cleanup-refused': 'integrationCleanupRefused',
}
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{(\w+)\}/gu, (match, name: string) => values[name] ?? match)

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const call = async (method: string, payload: Record<string, unknown>, signal?: AbortSignal) => {
    const result = await connection.rpc.call(channel, method, payload, signal)
    if (!result.ok) throw Object.assign(new Error('rpc'), { code: (result.error as { code?: string }).code })
    return result.value
  }
  const entries = new Map<string, Entry>()
  const listeners = new Set<() => void>()
  const bars = new Set<Bar>()
  // useSyncExternalStore needs a stable snapshot, including for a session with no entry yet.
  const empty: Entry = {}
  let defaultAction: DefaultAction = 'commit'
  const read = (sessionId: string): Entry => entries.get(sessionId) ?? empty
  const notify = () => {
    for (const listener of listeners) listener()
  }
  const write = (sessionId: string, patch: Partial<Entry>) => {
    entries.set(sessionId, { ...read(sessionId), ...patch })
    notify()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const defaultSnapshot = () => defaultAction
  ctx.effect(() => () => entries.clear(), 'ui-forge-chip: session cache')

  /** Run one host Git action. It lives here, not in the chip, so leaving the session cannot repeat it. */
  async function start(sessionId: string, operation: Busy) {
    if (read(sessionId).busy) return
    write(sessionId, { busy: operation, error: undefined })
    try {
      if (operation === 'pr') await call(methods.pr, { sessionId })
      else await call(methods.commit, { sessionId, push: operation === 'push' })
    } catch (failure) {
      const code = (failure as { code?: ActionErrorCode }).code
      write(sessionId, { error: (code && errorKeys[code]) || 'error' })
    } finally {
      void ctx.remote.forgePanel.refresh(sessionId as never).catch(() => {})
      write(sessionId, { busy: undefined, nonce: (read(sessionId).nonce ?? 0) + 1 })
    }
  }

  ctx.effect(() => {
    const text = () => localizedCopy(translations, ctx.locale.getSnapshot().active)
    // Only an unambiguous, visible chip row answers a shortcut.
    const resolve = (index: number, secondary: boolean): ShortcutResolution => {
      const visible = [...bars].filter((bar) => {
        const element = bar.element()
        return !!element && element.isConnected && element.getClientRects().length > 0
      })
      return visible.length === 1 ? visible[0]!.resolve(index, secondary) : { status: 'pass' }
    }
    const disposers: (() => void)[] = []
    for (let n = 1; n <= SHORTCUT_SLOTS; n++) {
      for (const secondary of [false, true]) {
        const binding = {
          code: `Digit${n}`,
          modifiers: secondary ? (['primary', 'shift'] as const) : (['primary'] as const),
        }
        try {
          disposers.push(
            ctx.shortcuts.register({
              id: shortcutId(n, secondary),
              label: () => fill(secondary ? text().shortcutAlt : text().shortcut, { n: String(n) }),
              aliases: ['git', 'forge', 'commit', 'PR'],
              // Web admits only Mod+Alt or Mod+Shift pairs, so the Web binding is left to the user.
              defaults: { 'desktop:windows': binding, 'desktop:macos': binding, 'desktop:linux': binding },
              regions: ['page', 'editable'],
              modals: [],
              resolve: () => resolve(n - 1, secondary),
            })
          )
        } catch {
          // Another feature already owns this default; the user can still bind the action in settings.
        }
      }
    }
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'ui-forge-chip: shortcuts')

  /** The one integration the Host proposes for a Session working in a linked worktree. */
  function Integration({
    sessionId,
    panel,
    blocked,
    text,
  }: {
    sessionId: string
    panel: ForgePanelState
    blocked: boolean
    text: Copy
  }) {
    const linked = panel.checkout.state === 'ready' && panel.checkout.checkout.linked
    const [proposal, setProposal] = useState<IntegrationProposal | null>(null)
    const [notice, setNotice] = useState<{ text: string; alert: boolean; diagnostic?: string }>()
    const [busy, setBusy] = useState(false)
    const [open, setOpen] = useState(false)
    const [tick, setTick] = useState(0)
    const pending = useRef(false)
    useEffect(() => {
      // Returning to the window re-reads both checkouts, so an earlier result no longer describes them.
      const refresh = () => {
        if (pending.current) return
        setNotice(undefined)
        setTick((n) => n + 1)
      }
      window.addEventListener('focus', refresh)
      return () => window.removeEventListener('focus', refresh)
    }, [])
    useEffect(() => {
      if (!linked) {
        setProposal(null)
        return
      }
      if (blocked) return
      const abort = new AbortController()
      connection.rpc
        .call('/api', inspectMethod, { sessionId }, abort.signal)
        .then((result) => {
          if (!abort.signal.aborted) setProposal(result.ok ? (result.value as IntegrationProposal | null) : null)
        })
        .catch(() => {
          if (!abort.signal.aborted) setProposal(null)
        })
      return () => abort.abort()
    }, [sessionId, panel, linked, blocked, tick])
    const disabled = blocked || busy || !proposal || !!proposal.blocker
    useEffect(() => {
      if (disabled) setOpen(false)
    }, [disabled])
    const branch = proposal?.target.branch ?? 'HEAD'
    const label = (method: IntegrationMethod) => fill(text[methodLabels[method]], { branch })
    const integrate = async (method: IntegrationMethod) => {
      if (disabled || pending.current || !proposal) return
      pending.current = true
      setBusy(true)
      setOpen(false)
      setNotice(undefined)
      try {
        const result = await connection.rpc.call('/api', runMethod, {
          sessionId,
          method,
          targetBranch: proposal.target.branch,
          targetHead: proposal.target.head,
          sourceHead: proposal.source.head,
        })
        if (result.ok) setNotice({ text: fill(text.integrationDone, { branch }), alert: false })
        else {
          const diagnostic = (result.error.details as { diagnostic?: unknown }).diagnostic
          setNotice({
            text: text[failureLabels[result.error.code] ?? 'integrationError'],
            alert: true,
            diagnostic: typeof diagnostic === 'string' ? diagnostic : undefined,
          })
        }
      } catch {
        setNotice({ text: text.integrationError, alert: true })
      } finally {
        pending.current = false
        setBusy(false)
        setTick((n) => n + 1)
      }
    }
    if (!linked || (!proposal && !notice)) return null
    return (
      <>
        {proposal && (
          <div className="dsh-forge-chip-actions">
            <Pill
              className="dsh-forge-chip-trigger"
              data-forge-chip-item=""
              disabled={disabled}
              title={text.integrationHint}
              aria-busy={busy}
              onClick={() => void integrate(proposal.method)}
            >
              <IconBranchOutlineRegular aria-hidden="true" />
              {busy ? text.integrating : label(proposal.method)}
            </Pill>
            <Menu
              open={open}
              side="top"
              portal
              compact
              onClose={() => setOpen(false)}
              items={proposal.methods.map((method) => ({ id: method, label: label(method) }))}
              onSelect={(id) => void integrate(id as IntegrationMethod)}
              anchor={
                <Pill
                  className="dsh-forge-chip-trigger dsh-forge-chip-menu"
                  data-forge-chip-item=""
                  disabled={disabled}
                  aria-label={text.integrationMenu}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={() => setOpen((value) => !value)}
                >
                  <IconChevronDownOutlineRegular aria-hidden="true" />
                </Pill>
              }
            />
          </div>
        )}
        {proposal?.blocker && (
          <span className="dsh-forge-chip-note">
            {fill(text[blockerLabels[proposal.blocker]], { paths: proposal.paths.join(', ') })}
          </span>
        )}
        {notice && (
          <span className="dsh-forge-chip-note" role={notice.alert ? 'alert' : 'status'} title={notice.diagnostic}>
            {notice.text}
          </span>
        )}
      </>
    )
  }

  function Chip({ sessionId, useSession, useAccess, useProjection }: PropsRuntime<'conversation.input.dock'>) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = localizedCopy(translations, active)
    const entry = useSyncExternalStore(subscribe, () => read(sessionId))
    const preferred = useSyncExternalStore(subscribe, defaultSnapshot)
    const hidden = useSession(
      (s) => s.blank || s.awaitingFirstTurn || s.removed || s.openState !== 'open' || !!s.subagent
    )
    const unavailable = useSession(
      (s) => s.running || s.pendingSubmissions.length > 0 || s.removed || s.openState !== 'open'
    )
    const turn = useSession((s) => !!s.running)
    const canPrompt = useAccess('session.prompt')
    const cwd = useProjection('workingDirectory')
    const [streamFresh, setStreamFresh] = useState(false)
    const [streamError, setStreamError] = useState(false)
    const [open, setOpen] = useState(false)
    const [generation, setGeneration] = useState(0)
    const [tick, setTick] = useState(0)
    const toolbar = useRef<HTMLDivElement | null>(null)
    const focusIndex = useRef(0)
    const wasTurn = useRef(turn)
    const shortcuts = useRef<Shortcut[]>([])
    const openRef = useRef(open)
    openRef.current = open
    const panel = entry.panel
    useEffect(() => {
      const dispose = ctx.on('connection/reset', () => setGeneration((n) => n + 1))
      return () => {
        dispose()
      }
    }, [])
    useEffect(() => {
      const controller = new AbortController()
      void call(methods.settings, {}, controller.signal)
        .then((value) => {
          const action = (value as { defaultAction?: unknown } | null)?.defaultAction
          if (!controller.signal.aborted && (action === 'commit' || action === 'push') && action !== defaultAction) {
            defaultAction = action
            notify()
          }
        })
        .catch(() => {})
      return () => controller.abort()
    }, [generation])

    // A finished turn may have changed anything the agent touched; read it again.
    useEffect(() => {
      if (wasTurn.current && !turn) {
        setTick((n) => n + 1)
        void ctx.remote.forgePanel.refresh(sessionId).catch(() => {})
      }
      wasTurn.current = turn
    }, [sessionId, turn])

    // The cached panel stays visible on return; writes wait for this stream's first frame.
    useEffect(() => {
      setStreamFresh(false)
      setStreamError(false)
      setOpen(false)
      if (hidden) return
      const controller = new AbortController()
      const stream = ctx.remote.forgePanel.follow(sessionId, controller.signal)
      void (async () => {
        try {
          for await (const state of stream) {
            if (controller.signal.aborted) return
            write(sessionId, { panel: state })
            setStreamFresh(true)
            setStreamError(false)
          }
          if (!controller.signal.aborted) setStreamError(true)
        } catch {
          if (!controller.signal.aborted) setStreamError(true)
        } finally {
          stream.dispose()
        }
      })()
      return () => {
        controller.abort()
        stream.dispose()
      }
    }, [sessionId, cwd, hidden, generation])

    // Changes are read only while the Session is idle, and only when the checkout facts change.
    const key = panel && streamFresh ? localKey(panel) : null
    const wanted = key === null ? null : `${key}#${tick}#${entry.nonce ?? 0}`
    useEffect(() => {
      if (wanted === null || unavailable || read(sessionId).local?.key === wanted) return
      const controller = new AbortController()
      void Promise.resolve(ctx.remote.forgePanel.localDiff(sessionId, { kind: 'uncommitted' }, controller.signal))
        .then(
          (local): Local =>
            local.ok
              ? { key: wanted, failed: false, dirty: local.value.files.length > 0 || local.value.omitted > 0 }
              : { key: wanted, failed: true, dirty: false },
          (): Local => ({ key: wanted, failed: true, dirty: false })
        )
        .then((local) => {
          if (controller.signal.aborted) return
          // A failed read keeps the last known changes so the chips do not vanish.
          write(sessionId, { local: local.failed ? { ...local, dirty: !!read(sessionId).local?.dirty } : local })
        })
      return () => controller.abort()
    }, [sessionId, wanted, unavailable])

    const request = panel && requestForCheckout(panel)
    // The slow PR state refreshes on focus, on becoming visible, and on a poll while a PR is shown.
    useEffect(() => {
      if (hidden) return
      const refreshPr = () => {
        if (request && document.visibilityState === 'visible')
          void ctx.remote.forgePanel.refresh(sessionId).catch(() => {})
      }
      const onFocus = () => {
        setTick((n) => n + 1)
        refreshPr()
      }
      const timer = setInterval(refreshPr, PR_POLL_MS)
      window.addEventListener('focus', onFocus)
      document.addEventListener('visibilitychange', refreshPr)
      return () => {
        clearInterval(timer)
        window.removeEventListener('focus', onFocus)
        document.removeEventListener('visibilitychange', refreshPr)
      }
    }, [hidden, sessionId, !!request])

    useEffect(() => {
      const bar: Bar = {
        element: () => toolbar.current,
        resolve(index, secondary) {
          if (openRef.current) return { status: 'blocked', reason: 'Git action menu is open' }
          const shortcut = shortcuts.current[index]
          if (!shortcut || (secondary && !shortcut.secondary)) return { status: 'pass' }
          if (shortcut.disabled) return { status: 'blocked', reason: 'Git action is unavailable' }
          return { status: 'handled', run: secondary ? shortcut.secondary! : shortcut.run }
        },
      }
      bars.add(bar)
      return () => {
        bars.delete(bar)
      }
    }, [])

    // Roving focus: one Tab stop for the row; arrow keys, Home and End move between its chips.
    useEffect(() => {
      const items = [...(toolbar.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])]
      const current = Math.min(focusIndex.current, items.length - 1)
      items.forEach((item, index) => (item.tabIndex = index === current ? 0 : -1))
    })

    const local = entry.local
    const fresh = !!local && local.key === wanted
    const lookupError = streamError || (fresh && local.failed)
    const busy = entry.busy
    const error = entry.error
    const disabled = !canPrompt || unavailable || !!busy || !fresh || lookupError
    useEffect(() => {
      if (disabled) setOpen(false)
    }, [disabled])
    if (hidden || !panel || panel.checkout.state !== 'ready') {
      shortcuts.current = []
      return null
    }
    const showPanel = () => ctx.sidebarRight.openTab('forge-panel')
    const openRequest = request ? () => window.open(request.url, '_blank', 'noopener,noreferrer') : undefined
    // Shift+click is the pointer form of the alternate shortcut.
    const viewRequest = (event?: MouseEvent) => (event?.shiftKey && openRequest ? openRequest() : showPanel())
    const act = (operation: Busy) => {
      setOpen(false)
      // Re-checked at call time: a shortcut and a stale render can both reach here.
      if (disabled) return
      void start(sessionId, operation)
    }
    const saveDefault = (action: DefaultAction) => {
      const previous = defaultAction
      defaultAction = action
      notify()
      void call(methods.saveDefault, { defaultAction: action }).catch(() => {
        defaultAction = previous
        write(sessionId, { error: 'error' })
      })
    }
    const dirty = !!local?.dirty
    const showCreate = !dirty && fresh && canCreatePr(panel)
    const linked = panel.checkout.checkout.linked
    const rows: Shortcut[] = []
    if (dirty) rows.push({ run: () => act(preferred), disabled })
    if (showCreate) rows.push({ run: () => act('pr'), disabled })
    if (request) rows.push({ run: showPanel, secondary: openRequest, disabled: false })
    if (request) rows.push({ run: showPanel, secondary: openRequest, disabled: false })
    if (lookupError) rows.push({ run: showPanel, disabled: false })
    shortcuts.current = rows
    if (!dirty && !showCreate && !request && !lookupError && !error && !linked) return null
    const commitLabel =
      busy === 'commit'
        ? text.committing
        : busy === 'push'
          ? text.pushing
          : text[preferred === 'push' ? 'commitPush' : 'commit']
    const checks = request?.snapshot?.checksRollup ?? 'unknown'
    const stale = !!request?.update && 'error' in request.update
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      const items = [...(toolbar.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])]
      const next = nextIndex(event.key, items.indexOf(event.target as HTMLElement), items.length)
      if (next === null || items.indexOf(event.target as HTMLElement) < 0) return
      event.preventDefault()
      focusIndex.current = next
      items[next]!.focus()
    }
    return (
      <div
        ref={toolbar}
        className="dsh-forge-chip"
        role="toolbar"
        aria-label={text.toolbar}
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          const items = [...(toolbar.current?.querySelectorAll<HTMLElement>(ITEM) ?? [])]
          const index = items.indexOf(event.target as HTMLElement)
          if (index >= 0) focusIndex.current = index
        }}
      >
        {dirty && (
          <div className="dsh-forge-chip-actions">
            <Pill
              className="dsh-forge-chip-trigger dsh-forge-chip-commit"
              data-forge-chip-item=""
              disabled={disabled}
              aria-busy={busy === 'commit' || busy === 'push'}
              onClick={() => act(preferred)}
            >
              <IconBranchOutlineRegular aria-hidden="true" />
              {commitLabel}
            </Pill>
            <Menu
              open={open}
              side="top"
              portal
              compact
              onClose={() => setOpen(false)}
              selectedId={`default-${preferred}`}
              items={[
                { id: 'commit', label: text.commit },
                ...(panel.repository ? [{ id: 'push', label: text.commitPush }] : []),
                { type: 'separator', id: 'separator' },
                { type: 'label', id: 'default', text: text.defaultAction },
                { id: 'default-commit', label: text.commit },
                { id: 'default-push', label: text.commitPush },
              ]}
              onSelect={(id) => {
                setOpen(false)
                if (id === 'default-commit' || id === 'default-push')
                  saveDefault(id === 'default-push' ? 'push' : 'commit')
                else act(id as DefaultAction)
              }}
              anchor={
                <Pill
                  className="dsh-forge-chip-trigger dsh-forge-chip-menu"
                  data-forge-chip-item=""
                  disabled={disabled}
                  aria-label={text.menu}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  onClick={() => setOpen((value) => !value)}
                  onKeyDown={(event) => {
                    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                      event.preventDefault()
                      setOpen(true)
                    }
                  }}
                >
                  <IconChevronDownOutlineRegular aria-hidden="true" />
                </Pill>
              }
            />
          </div>
        )}
        {showCreate && (
          <Pill
            className="dsh-forge-chip-trigger dsh-forge-chip-create"
            data-forge-chip-item=""
            disabled={disabled}
            aria-busy={busy === 'pr'}
            onClick={() => act('pr')}
          >
            <IconBranchOutlineRegular aria-hidden="true" />
            {busy === 'pr' ? text.creatingPr : text.pr}
          </Pill>
        )}
        {/* Viewing is read-only, so it stays available while a turn runs. */}
        {request && (
          <Pill className="dsh-forge-chip-trigger dsh-forge-chip-view" data-forge-chip-item="" onClick={viewRequest}>
            {text.viewPr}
          </Pill>
        )}
        {request && (
          <Pill className="dsh-forge-chip-trigger dsh-forge-chip-checks" data-forge-chip-item="" onClick={viewRequest}>
            {text.checks}: {stale ? text.unknown : text[checks]}
          </Pill>
        )}
        {lookupError && (
          <Pill className="dsh-forge-chip-trigger" data-forge-chip-item="" onClick={showPanel}>
            {text.lookupError}
          </Pill>
        )}
        {error && <span role="alert">{text[error]}</span>}
        <Integration sessionId={sessionId} panel={panel} blocked={!canPrompt || unavailable} text={text} />
      </div>
    )
  }
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({ name: 'conversation.input.dock', id: name, order: -100 }, (props) => (
      <Chip key={props.sessionId} {...props} />
    ))
  )
  ctx.effect(() => installStyles(styles), 'ui-forge-chip: composer styles')
}
