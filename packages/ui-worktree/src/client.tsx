import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Menu,
  IconBranchOutlineRegular,
  IconChevronDownOutlineRegular,
  IconPlusOutlineRegular,
  IconCloseOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { channel, currentWorktree, endpointPrefix, isWorktreeView, type WorktreeView } from './protocol.js'
import { failureCode, type WorktreeFailure, type WorktreeOperation } from './errors.js'
import { copy } from './requests.js'
import { settingsLabel, WorktreeSettingsSection } from './settings.js'
import { styles } from './styles.js'
import { installSidebarLabel } from './sidebar.js'

export const name = 'dungsil-ui-worktree'
export const inject = ['slots', 'locale', 'connection']

type Props = PropsRuntime<'conversation.input.left'>

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const subscribeLocale = (listener: () => void) => ctx.locale.subscribe(listener)
  function Picker({ sessionId, useSession }: Props) {
    const language = useSyncExternalStore(subscribeLocale, () => ctx.locale.getSnapshot().active)
    const text = copy[language.startsWith('ko') ? 'ko' : 'en']
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const [view, setView] = useState<WorktreeView>()
    const [value, setValue] = useState('')
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<WorktreeFailure>()
    const [changed, setChanged] = useState(false)
    const [open, setOpen] = useState(false)
    const pending = useRef(false)
    const needsRefresh = useRef(false)
    const lifetime = useRef<AbortController | null>(null)
    const trigger = useRef<HTMLButtonElement>(null)
    const dialog = useRef<HTMLDialogElement>(null)
    const errorDialog = useRef<HTMLDialogElement>(null)
    const errorTrigger = useRef<HTMLButtonElement>(null)
    const title = useId()
    const errorTitle = useId()
    const errorDescription = useId()
    const field = useId()
    const status = useId()
    const disabled = unavailable || loading || busy || !!error || !view
    const errorLabel = error?.uncertain ? text.mutationError : text.lookupError

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
      if (!controller || controller.signal.aborted || pending.current || (needsRefresh.current && !explicit)) return
      pending.current = true
      setLoading(true)
      try {
        const view = await request('describe', { sessionId }, controller.signal)
        if (controller.signal.aborted) return
        setView(view)
        needsRefresh.current = false
        setError(undefined)
      } catch (cause) {
        if (!controller.signal.aborted) recordFailure('describe', cause)
      } finally {
        if (!controller.signal.aborted) {
          pending.current = false
          setLoading(false)
        }
      }
    }

    useEffect(() => {
      const controller = new AbortController()
      lifetime.current = controller
      pending.current = false
      void load()
      const focus = () => {
        void load()
      }
      const resize = () => {
        setOpen(false)
        dialog.current?.close()
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
      if (disabled) setOpen(false)
    }, [disabled])

    const show = () => {
      const element = dialog.current
      const button = trigger.current
      if (disabled || pending.current || !element || !button) return
      element.showModal()
      const anchor = button.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`
      element.style.top = `${Math.max(8, anchor.top - box.height - 8)}px`
    }

    const change = async (endpoint: 'create' | 'switch', path?: string) => {
      const controller = lifetime.current
      if (disabled || pending.current || needsRefresh.current || !view || !controller || controller.signal.aborted)
        return
      pending.current = true
      setBusy(true)
      setChanged(false)
      try {
        const payload =
          endpoint === 'create'
            ? { sessionId, cwd: view.cwd, ...(value.trim() ? { name: value.trim() } : {}) }
            : { sessionId, cwd: view.cwd, path }
        // ConnectionHandle exposes no authenticated principal. Owner-only access
        // is enforced by the server, not by unrelated session/prompt permission.
        const nextView = await request(endpoint, payload, controller.signal)
        if (controller.signal.aborted) return
        setView(nextView)
        setChanged(true)
        if (endpoint === 'create') {
          setValue('')
          dialog.current?.close()
        }
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
      if (!busy && changed && !dialog.current?.open) trigger.current?.focus()
    }, [busy, changed])

    useEffect(() => {
      if (!error && errorDialog.current?.open) errorDialog.current.close()
    }, [error])

    const restoreErrorFocus = () => {
      const button = errorTrigger.current ?? trigger.current
      button?.focus()
    }

    const current = currentWorktree(view)
    useEffect(() => {
      // Git lists the main checkout first. Only linked worktrees need a sidebar hint.
      if (!current || current === view?.worktrees[0]) return
      const name = current.branch ?? current.path.split(/[\\/]/).filter(Boolean).at(-1) ?? current.path
      return installSidebarLabel(sessionId, name, current.path)
    }, [sessionId, current, view])

    const branch = current ? (current.branch ?? text.detached) : text.unknown
    const notice = loading
      ? text.loading
      : busy
        ? text.busy
        : error
          ? errorLabel
          : unavailable
            ? text.wait
            : changed
              ? text.changed
              : view?.worktrees.length === 0
                ? text.empty
                : ''

    return (
      <div className="dsh-worktree">
        <div className="dsh-worktree-controls">
          <Menu
            className="dsh-worktree-picker"
            open={open}
            side="top"
            portal
            selectedId={current ? `path:${current.path}` : undefined}
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
              if (id === 'create') show()
              else if (id.startsWith('path:') && id !== `path:${current?.path}`) void change('switch', id.slice(5))
            }}
            anchor={
              <button
                ref={trigger}
                type="button"
                className="dsh-worktree-trigger"
                disabled={disabled}
                aria-label={view ? `${text.title}: ${branch}` : text.title}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-describedby={status}
                aria-busy={loading || busy}
                title={view ? branch : text.title}
                onClick={() => setOpen((value) => !value)}
                onKeyDown={(event) => {
                  if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault()
                    setOpen(true)
                  }
                }}
              >
                <span className="dsh-worktree-icon" aria-hidden="true">
                  <IconBranchOutlineRegular className="dsh-worktree-branch" />
                </span>
                <span className="dsh-worktree-name">{view ? branch : loading ? text.loading : text.title}</span>
                <span className="dsh-worktree-chevron" aria-hidden="true">
                  <IconChevronDownOutlineRegular />
                </span>
              </button>
            }
          />
          {error && (
            <button
              ref={errorTrigger}
              type="button"
              className="dsh-worktree-error-trigger"
              aria-haspopup="dialog"
              aria-label={`${errorLabel}: ${text.errorTitle}`}
              onClick={() => errorDialog.current?.showModal()}
            >
              {errorLabel}
            </button>
          )}
        </div>
        <span id={status} className="dsh-worktree-sr" role="status">
          {notice}
        </span>
        <dialog
          ref={dialog}
          className="dsh-worktree-dialog"
          aria-labelledby={title}
          onClose={() => trigger.current?.focus()}
          onCancel={(event) => {
            if (pending.current) event.preventDefault()
          }}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const outside =
              event.clientX < box.left ||
              event.clientX > box.right ||
              event.clientY < box.top ||
              event.clientY > box.bottom
            if (event.target === event.currentTarget && outside && !pending.current) event.currentTarget.close()
          }}
        >
          <header>
            <h2 id={title}>{text.createTitle}</h2>
            <button type="button" aria-label={text.close} disabled={busy} onClick={() => dialog.current?.close()}>
              <IconCloseOutlineRegular aria-hidden="true" />
            </button>
          </header>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void change('create')
            }}
          >
            <label htmlFor={field}>{text.branch}</label>
            <input
              id={field}
              type="text"
              value={value}
              disabled={busy}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              placeholder="fix-login"
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
                  event.preventDefault()
              }}
            />
            <p className="dsh-worktree-hint">{text.hint}</p>
            {error && (
              <div role="alert">
                <p>{error.uncertain ? text.error : text.readError}</p>
                <p>{text.reasons[error.code]}</p>
                <code>{error.code}</code>
              </div>
            )}
            {unavailable && <p role="status">{text.wait}</p>}
            <footer>
              <button type="button" disabled={loading || busy} onClick={() => void load(true)}>
                {text.refresh}
              </button>
              <button type="submit" className="dsh-worktree-primary" disabled={disabled}>
                {busy ? text.busy : text.submit}
              </button>
            </footer>
          </form>
        </dialog>
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
          <p id={errorDescription}>{error?.uncertain ? text.error : text.readError}</p>
          {error && (
            <>
              <p>{text.reasons[error.code]}</p>
              <dl>
                <dt>{text.errorOperation}</dt>
                <dd>{text.operations[error.operation]}</dd>
                <dt>{text.errorCode}</dt>
                <dd>
                  <code>{error.code}</code>
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
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'ui-worktree: composer styles')
}
