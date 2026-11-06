import { useEffect, useId, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { ComposerTrigger } from '@dungsil/dsh-ui/composer'
import {
  IconBranchOutlineRegular,
  IconCheckOutlineRegular,
  IconPlusOutlineRegular,
  IconCloseOutlineRegular,
  worktreeSettingsIconSvg,
} from '@dungsil/dsh-ui/icons'
import { installSettingsIcon, Menu, MenuItemButton } from '@dungsil/dsh-ui'
import {
  channel,
  currentWorktree,
  endpointPrefix,
  isWorktreeSelectionView,
  isWorktreeView,
  type WorktreeSelectionView,
  type WorktreeView,
} from './protocol.js'
import { failureCode, type WorktreeFailure, type WorktreeOperation } from './errors.js'
import { copy } from './requests.js'
import { settingsLabel, WorktreeSettingsSection } from './settings.js'
import { styles } from './styles.js'
import { installSidebarLabel } from './sidebar.js'
import { installProgress } from './progress.js'

export const name = 'dungsil-ui-worktree'
export const inject = ['slots', 'locale', 'connection', 'uiConversation', 'conversation', 'configForms']

type Props = PropsRuntime<'conversation.input.left'>

export function apply(ctx: Context) {
  ctx.effect(() => installSettingsIcon(name, ['en', 'ko', 'zh'].map(settingsLabel), worktreeSettingsIconSvg))
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  installProgress(ctx)
  const synced = new Map<Props['sessionId'], WorktreeView>()
  // Keep unresolved gates across keyed navigation until that session is reconciled.
  // ComposerBlocks is a shared single-value registry, not an owner-keyed stack.
  const ownedBlocks = new Map<Props['sessionId'], { reason: string }>()
  const blocks = ctx.conversation.blocks
  ctx.effect(() => () => {
    const owned = [...ownedBlocks]
    ownedBlocks.clear()
    for (const [id, block] of owned) {
      if (blocks.storeFor(id).getSnapshot() === block) blocks.set(id, undefined)
    }
  })
  function Picker({ sessionId, useSession, useProjection, useInput }: Props) {
    const { active: language } = useLocaleSnapshot(ctx.locale)
    const text = copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
    const inputBusy = useInput((input) => input.phase !== 'plain')
    const sessionBusy = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const unavailable = sessionBusy || inputBusy
    const unavailableRef = useRef(unavailable)
    unavailableRef.current = unavailable
    const unreadable = useSession((s) => s.removed || s.openState !== 'open')
    const unreadableRef = useRef(unreadable)
    unreadableRef.current = unreadable
    const cwd = useProjection('workingDirectory')
    const started = useProjection('sessionListMetadata')?.blank === false
    const cached = synced.get(sessionId)
    const initialView = cached?.cwd === cwd ? cached : undefined
    const previousReadiness = useRef({ unreadable: true, unavailable, cwd })
    const [view, setView] = useState<WorktreeView | undefined>(initialView)
    const [loading, setLoading] = useState(!initialView)
    const viewRef = useRef(view)
    viewRef.current = view
    type Selection = { version: number; cwd: string; choice: 'current' | 'new' }
    const selected = useRef<Selection>()
    const saving = useRef(false)
    const version = useRef(0)
    const [error, setError] = useState<WorktreeFailure>()
    const [changed, setChanged] = useState(false)
    const [open, setOpen] = useState(false)
    const needsSync = useRef(true)
    needsSync.current = !view || (!view.locked && (!!view.needsInitialization || !!view.pendingCreation))
    const pending = useRef(false)
    const reloadRequested = useRef(false)
    const needsRefresh = useRef(false)
    const lifetime = useRef<AbortController | null>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    const errorDialog = useRef<HTMLDialogElement>(null)
    const errorTitle = useId()
    const errorDescription = useId()
    const status = useId()
    const creation = view?.pendingCreation
    const locked = !!view?.locked || (started && !creation)
    const disabled = locked || unavailable || loading || !view
    const detailError: WorktreeFailure | undefined =
      error ?? (creation?.failed ? { operation: 'create', code: 'operation_failed', uncertain: true } : undefined)
    const errorLabel = detailError?.uncertain ? text.mutationError : text.lookupError

    const gate = (reason?: string) => {
      const store = blocks.storeFor(sessionId)
      const owned = ownedBlocks.get(sessionId)
      const current = store.getSnapshot()
      if (!reason) {
        ownedBlocks.delete(sessionId)
        if (owned && current === owned) blocks.set(sessionId, undefined)
      } else {
        synced.delete(sessionId)
        const block = owned?.reason === reason ? owned : { reason }
        ownedBlocks.set(sessionId, block)
        if (!current || current === owned) blocks.set(sessionId, block)
      }
    }

    const recordFailure = (operation: WorktreeOperation, cause: unknown) => {
      const code = failureCode(cause)
      needsRefresh.current = true
      const uncertain = operation !== 'describe' || ownedBlocks.has(sessionId)
      if (uncertain) gate(text.selectionError)
      setError((previous) => ({ operation, code, uncertain: uncertain || !!previous?.uncertain }))
      console.warn('[dungsil-ui-worktree]', { operation, code })
    }

    const call = async (operation: WorktreeOperation, payload: object, signal: AbortSignal) => {
      if (typeof connection?.rpc?.call !== 'function') throw { code: 'client_unavailable' }
      const result = await connection.rpc.call(channel, endpointPrefix + operation, payload, signal)
      signal.throwIfAborted()
      if (!result.ok) throw result.error
      return result.value
    }
    const request = async (operation: 'describe' | 'initialize', payload: object, signal: AbortSignal) => {
      const value = await call(operation, payload, signal)
      if (!isWorktreeView(value)) throw { code: 'invalid_response' }
      return value
    }
    const updateView = (next: WorktreeView) => {
      viewRef.current = next
      setView(next)
    }
    const mergeSelection = (next: WorktreeSelectionView) => {
      const previous = viewRef.current
      if (!previous) return
      updateView({
        ...previous,
        cwd: next.cwd,
        pendingCreation: next.pendingCreation,
        locked: next.locked,
        needsInitialization: false,
      })
    }

    // Serialize reads and writes. Never automatically retry an uncertain mutation,
    // and ignore replies after unmount (including navigation to another Session).
    const load = async (explicit = false) => {
      const controller = lifetime.current
      if (
        !controller ||
        controller.signal.aborted ||
        unreadableRef.current ||
        saving.current ||
        (needsRefresh.current && !explicit)
      )
        return
      if (pending.current) {
        reloadRequested.current = true
        return
      }
      reloadRequested.current = false
      pending.current = true
      setLoading(true)
      let operation: WorktreeOperation = 'describe'
      try {
        const view = await request('describe', { sessionId }, controller.signal)
        if (controller.signal.aborted) return
        updateView(view)
        if (view.needsInitialization && !view.locked && !unavailableRef.current) {
          operation = 'initialize'
          gate(text.savingSelection)
          const initialized = await request('initialize', { sessionId, cwd: view.cwd }, controller.signal)
          if (controller.signal.aborted) return
          updateView(initialized)
        }
        needsRefresh.current = false
        setError(undefined)
        gate()
      } catch (cause) {
        // A busy response changes nothing. Keep prior errors until verification succeeds.
        if (!controller.signal.aborted) {
          if (failureCode(cause) !== 'busy') recordFailure(operation, cause)
          else if (!needsRefresh.current && operation === 'initialize') gate()
        }
      } finally {
        if (!controller.signal.aborted) {
          pending.current = false
          setLoading(false)
          if (reloadRequested.current) {
            reloadRequested.current = false
            void load()
          }
        }
      }
    }

    useEffect(() => {
      const controller = new AbortController()
      lifetime.current = controller
      pending.current = false
      const store = blocks.storeFor(sessionId)
      const restoreGate = () => {
        const block = ownedBlocks.get(sessionId)
        if (block && !store.getSnapshot()) blocks.set(sessionId, block)
      }
      restoreGate()
      const unsubscribe = store.subscribe(restoreGate)
      const focus = () => {
        if (needsSync.current && !pending.current) void load()
      }
      const resize = () => {
        setOpen(false)
      }
      window.addEventListener('focus', focus)
      window.addEventListener('resize', resize)
      return () => {
        controller.abort()
        unsubscribe()
        window.removeEventListener('focus', focus)
        window.removeEventListener('resize', resize)
      }
    }, [])

    useEffect(() => {
      const previous = previousReadiness.current
      previousReadiness.current = { unreadable, unavailable, cwd }
      if (
        !unreadable &&
        (((previous.unreadable || (previous.unavailable && !unavailable)) && needsSync.current) || previous.cwd !== cwd)
      )
        void load()
    }, [unreadable, unavailable, cwd])

    useEffect(() => {
      if (locked && view && !creation && view.cwd === cwd && !error && !ownedBlocks.has(sessionId))
        synced.set(sessionId, { ...view, locked: true, needsInitialization: false })
      else synced.delete(sessionId)
    }, [sessionId, view, locked, creation, cwd, error])

    useEffect(() => {
      if (disabled) setOpen(false)
    }, [disabled])

    const change = async (choice: Selection['choice']) => {
      const controller = lifetime.current
      const currentView = viewRef.current
      if (
        locked ||
        unavailableRef.current ||
        loading ||
        pending.current ||
        !currentView ||
        !controller ||
        controller.signal.aborted
      )
        return
      const intent = { version: ++version.current, cwd: currentView.cwd, choice }
      selected.current = intent
      mergeSelection({
        cwd: currentView.cwd,
        pendingCreation: choice === 'new' ? { name: text.create, failed: false } : undefined,
      })
      setError(undefined)
      setChanged(true)
      needsRefresh.current = false
      gate(text.savingSelection)
      if (saving.current) return
      saving.current = true
      // Only the latest intent may update the UI or release send admission. An
      // older response (including failure) cannot overtake a more recent click.
      try {
        while (selected.current && !controller.signal.aborted) {
          const next: Selection = selected.current
          try {
            const value = await call(
              'select',
              {
                sessionId,
                cwd: next.cwd,
                choice: next.choice,
              },
              controller.signal
            )
            if (!isWorktreeSelectionView(value)) throw { code: 'invalid_response' }
            if (selected.current?.version !== next.version) continue
            mergeSelection(value)
            selected.current = undefined
            gate()
          } catch (cause) {
            if (controller.signal.aborted) return
            if (selected.current?.version !== next.version) continue
            selected.current = undefined
            recordFailure('select', cause)
            return
          }
        }
      } finally {
        saving.current = false
      }
    }

    useEffect(() => {
      if (changed) trigger.current?.focus()
    }, [changed])

    useEffect(() => {
      if (!detailError && errorDialog.current?.open) errorDialog.current.close()
    }, [error, creation?.failed])

    const restoreErrorFocus = () => {
      trigger.current?.focus()
    }

    const current = currentWorktree(view)
    useEffect(() => {
      // Git lists the main checkout first. Only linked worktrees need a sidebar hint.
      if (!current || current === view?.worktrees[0]) return
      const name = current.branch ?? current.path.split(/[\\/]/).filter(Boolean).at(-1) ?? current.path
      return installSidebarLabel(sessionId, name, current.path)
    }, [sessionId, current, view])

    const selectCurrent = () => {
      setOpen(false)
      if (disabled) return
      const latest = viewRef.current
      if (latest?.pendingCreation || needsRefresh.current) void change('current')
    }
    const branch = creation ? text.create : current ? (current.branch ?? text.detached) : text.unknown
    const label = detailError ? errorLabel : view ? branch : loading ? text.loading : text.title
    const notice = loading
      ? text.loading
      : error
        ? errorLabel
        : unavailable
          ? text.wait
          : locked
            ? text.locked
            : creation
              ? creation.failed
                ? text.creationError
                : text.reservationHint
              : changed
                ? text.changed
                : view?.worktrees.length === 0
                  ? text.empty
                  : ''

    return (
      <div className="dsh-worktree">
        <Menu
          className="dsh-worktree-picker"
          open={open}
          side="top"
          portal
          listClassName="dsh-worktree-menu"
          onClose={() => setOpen(false)}
          anchor={
            <ComposerTrigger
              ref={trigger}
              className="dsh-worktree-trigger"
              icon={<IconBranchOutlineRegular />}
              label={label}
              disabled={detailError ? loading : disabled}
              aria-label={`${text.title}: ${label}`}
              aria-haspopup={detailError ? 'dialog' : locked ? undefined : 'menu'}
              aria-expanded={detailError || locked ? undefined : open}
              aria-describedby={status}
              aria-busy={loading}
              title={locked ? text.locked : `${text.title}: ${branch}${creation ? ` — ${text.reservationHint}` : ''}`}
              onClick={() => {
                if (detailError) errorDialog.current?.showModal()
                else if (!disabled) setOpen((value) => !value)
              }}
              onKeyDown={(event) => {
                if (!detailError && !disabled && !open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault()
                  setOpen(true)
                }
              }}
            />
          }
        >
          <div className="dsh-worktree-pinned">
            <MenuItemButton
              icon={<IconPlusOutlineRegular />}
              current={!!creation}
              onSelect={() => {
                setOpen(false)
                const latest = viewRef.current?.pendingCreation
                if (!disabled && (!latest || latest.failed || needsRefresh.current)) void change('new')
              }}
            >
              <span className="dsh-worktree-option">
                <span>{text.create}</span>
                {creation && <IconCheckOutlineRegular />}
              </span>
            </MenuItemButton>
            {current && (
              <MenuItemButton
                key={current.path}
                icon={<IconBranchOutlineRegular />}
                current={!creation}
                onSelect={selectCurrent}
              >
                <span className="dsh-worktree-option">
                  <span>{current.branch ?? text.detached}</span>
                  <span className="dsh-worktree-badge">{text.primaryBranch}</span>
                  {!creation && <IconCheckOutlineRegular />}
                </span>
              </MenuItemButton>
            )}
          </div>
        </Menu>
        <span id={status} className="dsh-worktree-sr" role="status">
          {notice}
        </span>
        <dialog
          ref={errorDialog}
          className="dsh-worktree-dialog dsh-worktree-error-dialog"
          aria-labelledby={errorTitle}
          aria-describedby={errorDescription}
          onClose={restoreErrorFocus}
        >
          <header>
            <h2 id={errorTitle}>{text.errorTitle}</h2>
            <button type="button" aria-label={text.close} onClick={() => errorDialog.current?.close()}>
              <IconCloseOutlineRegular aria-hidden="true" />
            </button>
          </header>
          <p id={errorDescription}>
            {creation?.failed ? text.creationError : error?.uncertain ? text.error : text.readError}
          </p>
          {detailError && (
            <>
              <p>{text.reasons[detailError.code]}</p>
              <dl>
                <dt>{text.errorOperation}</dt>
                <dd>{text.operations[detailError.operation]}</dd>
                <dt>{text.errorCode}</dt>
                <dd>
                  <code>{detailError.code}</code>
                </dd>
              </dl>
            </>
          )}
          <footer>
            {view && (
              <button
                type="button"
                data-worktree-choose
                disabled={disabled}
                onClick={() => {
                  errorDialog.current?.close()
                  setOpen(true)
                }}
              >
                {text.choose}
              </button>
            )}
            <button type="button" data-worktree-retry disabled={loading} onClick={() => void load(true)}>
              {loading ? text.loading : text.refresh}
            </button>
          </footer>
        </dialog>
      </div>
    )
  }

  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register({ name: 'conversation.input.left', id: 'dungsil-ui-worktree', order: -100 }, (props) => (
      <Picker key={props.sessionId} {...props} />
    ))
  )
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 16,
        label: () => settingsLabel(ctx.locale.getSnapshot().active),
        inject: () => ({ ctx }),
      },
      WorktreeSettingsSection
    )
  )
  ctx.effect(() => installStyles(styles), 'ui-worktree: composer styles')
}
