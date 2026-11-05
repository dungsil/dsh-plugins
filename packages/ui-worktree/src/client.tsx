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
  IconPlusOutlineRegular,
  IconCloseOutlineRegular,
  worktreeSettingsIconSvg,
} from '@dungsil/dsh-ui/icons'
import { installSettingsIcon, Menu } from '@dungsil/dsh-ui'
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
  installProgress(ctx)
  function Picker({ sessionId, useSession }: Props) {
    const { active: language } = useLocaleSnapshot(ctx.locale)
    const text = copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const unavailableRef = useRef(unavailable)
    unavailableRef.current = unavailable
    const [view, setView] = useState<WorktreeView>()
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<WorktreeFailure>()
    const [changed, setChanged] = useState(false)
    const [open, setOpen] = useState(false)
    const pending = useRef(false)
    const reloadRequested = useRef(false)
    const needsRefresh = useRef(false)
    const lifetime = useRef<AbortController | null>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    const errorDialog = useRef<HTMLDialogElement>(null)
    const errorTitle = useId()
    const errorDescription = useId()
    const status = useId()
    const disabled = unavailable || loading || busy || !!error || !view
    const creation = view?.pendingCreation
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
      if (!controller || controller.signal.aborted || unavailableRef.current || (needsRefresh.current && !explicit))
        return
      if (pending.current) {
        reloadRequested.current = true
        return
      }
      reloadRequested.current = false
      pending.current = true
      setLoading(true)
      try {
        const view = await request('describe', { sessionId }, controller.signal)
        if (controller.signal.aborted) return
        setView(view)
        needsRefresh.current = false
        setError(undefined)
      } catch (cause) {
        // A busy read changes nothing. Keep prior errors until an explicit read succeeds.
        if (!controller.signal.aborted && failureCode(cause) !== 'busy') recordFailure('describe', cause)
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
        void load()
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
      if (!unavailable) void load()
    }, [unavailable])

    useEffect(() => {
      if (disabled) setOpen(false)
    }, [disabled])

    const change = async (endpoint: 'create' | 'switch', path?: string) => {
      const controller = lifetime.current
      if (disabled || pending.current || needsRefresh.current || !view || !controller || controller.signal.aborted)
        return
      pending.current = true
      setBusy(true)
      setChanged(false)
      try {
        const payload = endpoint === 'create' ? { sessionId, cwd: view.cwd } : { sessionId, cwd: view.cwd, path }
        // ConnectionHandle exposes no authenticated principal. Owner-only access
        // is enforced by the server, not by unrelated session/prompt permission.
        const nextView = await request(endpoint, payload, controller.signal)
        if (controller.signal.aborted) return
        setView(nextView)
        setChanged(true)
        pending.current = false
        await load()
      } catch (cause) {
        if (!controller.signal.aborted) recordFailure(endpoint, cause)
      } finally {
        if (!controller.signal.aborted) {
          pending.current = false
          setBusy(false)
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
          selectedId={creation ? 'create' : current ? `path:${current.path}` : undefined}
          items={[
            { id: 'create', label: text.create, icon: <IconPlusOutlineRegular /> },
            ...(view?.worktrees.map((item) => ({
              id: `path:${item.path}`,
              label: item.branch ?? text.detached,
              icon: <IconBranchOutlineRegular />,
            })) ?? []),
          ]}
          onClose={() => setOpen(false)}
          onSelect={(id) => {
            setOpen(false)
            if (disabled || pending.current) return
            if (id === 'create') {
              if (!creation || creation.failed) void change('create')
            } else if (id.startsWith('path:') && (creation || id !== `path:${current?.path}`))
              void change('switch', id.slice(5))
          }}
          anchor={
            <ComposerTrigger
              ref={trigger}
              className="dsh-worktree-trigger"
              icon={<IconBranchOutlineRegular />}
              label={label}
              disabled={detailError ? loading || busy : disabled}
              aria-label={`${text.title}: ${label}`}
              aria-haspopup={detailError ? 'dialog' : 'menu'}
              aria-expanded={detailError ? undefined : open}
              aria-describedby={status}
              aria-busy={loading || busy}
              title={label}
              onClick={() => {
                if (detailError) errorDialog.current?.showModal()
                else setOpen((value) => !value)
              }}
              onKeyDown={(event) => {
                if (!detailError && !disabled && !open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                  event.preventDefault()
                  setOpen(true)
                }
              }}
            />
          }
        />
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
