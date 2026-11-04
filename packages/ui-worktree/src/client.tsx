import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconBranchOutlineRegular, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { channel, endpointPrefix, type WorktreeView } from './protocol.js'
import { copy } from './requests.js'
import { styles } from './styles.js'

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
    const [error, setError] = useState(false)
    const [changed, setChanged] = useState(false)
    const pending = useRef(false)
    const needsRefresh = useRef(false)
    const lifetime = useRef<AbortController | null>(null)
    const trigger = useRef<HTMLSelectElement>(null)
    const dialog = useRef<HTMLDialogElement>(null)
    const title = useId()
    const field = useId()
    const status = useId()
    const disabled = unavailable || loading || busy || error || !view

    // Serialize reads and writes. Never automatically retry an uncertain mutation,
    // and ignore replies after unmount (including navigation to another Session).
    const load = async (explicit = false) => {
      const controller = lifetime.current
      if (!controller || controller.signal.aborted || pending.current || (needsRefresh.current && !explicit)) return
      pending.current = true
      setLoading(true)
      try {
        const result = await connection.rpc.call(channel, `${endpointPrefix}describe`, { sessionId }, controller.signal)
        if (controller.signal.aborted) return
        if (!result.ok) throw new Error('describe failed')
        setView(result.value as WorktreeView)
        needsRefresh.current = false
        setError(false)
      } catch {
        if (!controller.signal.aborted) {
          needsRefresh.current = true
          setError(true)
        }
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
      const resize = () => dialog.current?.close()
      window.addEventListener('focus', focus)
      window.addEventListener('resize', resize)
      return () => {
        controller.abort()
        window.removeEventListener('focus', focus)
        window.removeEventListener('resize', resize)
      }
    }, [])

    const show = () => {
      const element = dialog.current
      const select = trigger.current
      if (disabled || pending.current || !element || !select) return
      element.showModal()
      const anchor = select.getBoundingClientRect()
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
        const result = await connection.rpc.call(channel, endpointPrefix + endpoint, payload, controller.signal)
        if (controller.signal.aborted) return
        if (!result.ok) throw new Error('change failed')
        setView(result.value as WorktreeView)
        setChanged(true)
        if (endpoint === 'create') {
          setValue('')
          dialog.current?.close()
        }
        pending.current = false
        await load()
      } catch {
        if (!controller.signal.aborted) {
          needsRefresh.current = true
          setError(true)
        }
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

    const current = view?.worktrees
      .filter((item) => view.cwd === item.path || view.cwd.startsWith(item.path.replace(/\/$/, '') + '/'))
      .sort((a, b) => b.path.length - a.path.length)[0]
    const branch = current ? (current.branch ?? text.detached) : text.unknown
    const notice = loading
      ? text.loading
      : busy
        ? text.busy
        : unavailable
          ? text.wait
          : changed
            ? text.changed
            : view?.worktrees.length === 0
              ? text.empty
              : ''

    return (
      <div className="dsh-worktree">
        <div className="dsh-worktree-picker">
          <IconBranchOutlineRegular className="dsh-worktree-branch" aria-hidden="true" />
          <select
            ref={trigger}
            className="dsh-worktree-select"
            value="current"
            disabled={disabled}
            aria-label={text.title}
            aria-describedby={status}
            aria-busy={loading || busy}
            title={view ? `${text.current}: ${branch} — ${view.cwd}` : text.title}
            onChange={(event) => {
              const selected = event.target.value
              event.target.value = 'current'
              if (selected === 'create') show()
              else if (selected.startsWith('path:')) void change('switch', selected.slice(5))
            }}
          >
            <option value="current">
              {view ? `${text.current}: ${branch} — ${view.cwd}` : loading ? text.loading : text.title}
            </option>
            <option value="create">{text.create}</option>
            {view?.worktrees
              .filter((item) => item.path !== view.cwd)
              .map((item) => (
                <option key={item.path} value={`path:${item.path}`}>
                  {item.branch ?? text.detached} — {item.path}
                </option>
              ))}
          </select>
          <IconChevronDownOutlineRegular className="dsh-worktree-chevron" aria-hidden="true" />
        </div>
        <button
          type="button"
          className="dsh-worktree-refresh"
          disabled={loading || busy}
          onClick={() => void load(true)}
          aria-label={text.refresh}
          title={text.refresh}
        >
          ↻
        </button>
        <span id={status} className="dsh-worktree-sr" role="status">
          {notice}
        </span>
        {error && (
          <p role="alert" className="dsh-worktree-error">
            {text.error}
          </p>
        )}
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
              ×
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
            {error && <p role="alert">{text.error}</p>}
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
      </div>
    )
  }

  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register({ name: 'conversation.input.left', id: 'dungsil-ui-worktree', order: -100 }, (props) => (
      <Picker key={props.sessionId} {...props} />
    ))
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'ui-worktree: composer styles')
}
