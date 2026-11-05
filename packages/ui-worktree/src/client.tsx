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
import { channel, currentWorktree, endpointPrefix, isWorktreeView, type WorktreeView } from './protocol.js'
import { failureCode, type WorktreeFailure, type WorktreeOperation } from './errors.js'
import { copy } from './requests.js'
import { settingsLabel, WorktreeSettingsSection } from './settings.js'
import { styles } from './styles.js'
import { installSidebarLabel } from './sidebar.js'
import { installProgress } from './progress.js'

export const name = 'dungsil-ui-worktree'
export const inject = ['slots', 'locale', 'connection', 'uiConversation']

type Props = PropsRuntime<'conversation.input.left'>

export function apply(ctx: Context) {
  ctx.effect(() => installSettingsIcon(name, ['en', 'ko', 'zh'].map(settingsLabel), worktreeSettingsIconSvg))
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const synced = new Map<string, WorktreeView>()
  installProgress(ctx)
  function Picker({ sessionId, useSession, useProjection }: Props) {
    const { active: language } = useLocaleSnapshot(ctx.locale)
    const text = copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
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
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<WorktreeFailure>()
    const [changed, setChanged] = useState(false)
    const [open, setOpen] = useState(false)
    const needsSync = useRef(true)
    needsSync.current = !view || !!view.needsInitialization || !!view.pendingCreation
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
    const disabled = locked || unavailable || loading || busy || !!error || !view
    const detailError: WorktreeFailure | undefined =
      error ?? (creation?.failed ? { operation: 'create', code: 'operation_failed', uncertain: true } : undefined)
    const errorLabel = detailError?.uncertain ? text.mutationError : text.lookupError

    const recordFailure = (operation: WorktreeOperation, cause: unknown) => {
      const code = failureCode(cause)
      needsRefresh.current = true
      setError((previous) => ({ operation, code, uncertain: operation !== 'describe' || !!previous?.uncertain }))
      console.warn('[dungsil-ui-worktree]', { operation, code })
    }

    const request = async (operation: WorktreeOperation, payload: object, signal: AbortSignal) => {
      if (typeof connection?.rpc?.call !== 'function') throw { code: 'client_unavailable' }
      const result = await connection.rpc.call(channel, endpointPrefix + operation, payload, signal)
      signal.throwIfAborted()
      if (!result.ok) throw result.error
      if (!isWorktreeView(result.value)) throw { code: 'invalid_response' }
      return result.value
    }

    // Serialize reads and writes. Never automatically retry an uncertain mutation,
    // and ignore replies after unmount (including navigation to another Session).
    const load = async (explicit = false) => {
      const controller = lifetime.current
      if (!controller || controller.signal.aborted || unreadableRef.current || (needsRefresh.current && !explicit))
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
        setView(view)
        if (view.needsInitialization && !unavailableRef.current) {
          operation = 'initialize'
          const initialized = await request('initialize', { sessionId, cwd: view.cwd }, controller.signal)
          if (controller.signal.aborted) return
          setView(initialized)
        }
        needsRefresh.current = false
        setError(undefined)
      } catch (cause) {
        // A busy response changes nothing. Keep prior errors until verification succeeds.
        if (!controller.signal.aborted && failureCode(cause) !== 'busy') recordFailure(operation, cause)
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
      const focus = () => {
        if (needsSync.current) void load()
      }
      const resize = () => {
        setOpen(false)
      }
      window.addEventListener('focus', focus)
      window.addEventListener('resize', resize)
      return () => {
        controller.abort()
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
      if (locked && view && !view.needsInitialization && !creation && view.cwd === cwd)
        synced.set(sessionId, { ...view, locked: true })
      else synced.delete(sessionId)
    }, [sessionId, view, locked, creation, cwd])

    useEffect(() => {
      if (disabled) setOpen(false)
    }, [disabled])

    const change = async (endpoint: 'create' | 'cancel') => {
      const controller = lifetime.current
      if (disabled || pending.current || needsRefresh.current || !view || !controller || controller.signal.aborted)
        return
      pending.current = true
      setBusy(true)
      setChanged(false)
      try {
        // ConnectionHandle exposes no authenticated principal. Owner-only access
        // is enforced by the server, not by unrelated session/prompt permission.
        const nextView = await request(endpoint, { sessionId, cwd: view.cwd }, controller.signal)
        if (controller.signal.aborted) return
        setView(nextView)
        setChanged(true)
      } catch (cause) {
        if (!controller.signal.aborted) recordFailure(endpoint, cause)
      } finally {
        if (!controller.signal.aborted) {
          pending.current = false
          setBusy(false)
          if (reloadRequested.current) {
            reloadRequested.current = false
            void load()
          }
        }
      }
    }

    useEffect(() => {
      if (!busy && changed) trigger.current?.focus()
    }, [busy, changed])

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

    const branch = creation
      ? creation.failed
        ? text.mutationError
        : text.create
      : current
        ? (current.branch ?? text.detached)
        : text.unknown
    const label = detailError ? errorLabel : view ? branch : loading ? text.loading : text.title
    const notice = loading
      ? text.loading
      : busy
        ? text.busy
        : error
          ? errorLabel
          : unavailable
            ? text.wait
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
              disabled={detailError ? loading || busy : disabled}
              aria-label={`${text.title}: ${label}`}
              aria-haspopup={detailError ? 'dialog' : locked ? undefined : 'menu'}
              aria-expanded={detailError || locked ? undefined : open}
              aria-describedby={status}
              aria-busy={loading || busy}
              title={locked ? text.locked : label}
              onClick={() => {
                if (detailError) errorDialog.current?.showModal()
                else if (!disabled) setOpen(!open)
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
          <MenuItemButton
            icon={<IconPlusOutlineRegular />}
            current={!!creation}
            onSelect={() => {
              setOpen(false)
              if (!creation || creation.failed) void change('create')
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
              onSelect={() => {
                setOpen(false)
                if (creation) void change('cancel')
              }}
            >
              <span className="dsh-worktree-option">
                <span>{current.branch ?? text.detached}</span>
                <span className="dsh-worktree-badge">{text.primaryBranch}</span>
                {!creation && <IconCheckOutlineRegular />}
              </span>
            </MenuItemButton>
          )}
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
            {creation?.failed && !error && (
              <>
                <button type="button" disabled={disabled} onClick={() => void change('cancel')}>
                  {text.primaryBranch}
                </button>
                <button type="button" disabled={disabled} onClick={() => void change('create')}>
                  {text.create}
                </button>
              </>
            )}
            <button type="button" data-worktree-retry disabled={loading || busy} onClick={() => void load(true)}>
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
