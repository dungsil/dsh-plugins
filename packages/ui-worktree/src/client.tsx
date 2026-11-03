import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { copy, requestText, type Action } from './requests.js'
import { styles } from './styles.js'

export const name = 'dungsil-ui-worktree'
export const inject = ['slots', 'locale', 'sessions']

type Props = PropsRuntime<'conversation.input.left'>

export function apply(ctx: Context) {
  const subscribeLocale = (listener: () => void) => ctx.locale.subscribe(listener)
  function Picker({ sessionId, useSession, useAccess }: Props) {
    const language = useSyncExternalStore(subscribeLocale, () => ctx.locale.getSnapshot().active)
    const text = copy[language === 'ko' ? 'ko' : 'en']
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const allowed = useAccess('session/prompt')
    const [mode, setMode] = useState<'create' | 'reuse'>('create')
    const [value, setValue] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(false)
    const [sent, setSent] = useState(false)
    const [open, setOpen] = useState(false)
    const pending = useRef(false)
    const alive = useRef(true)
    const trigger = useRef<HTMLButtonElement>(null)
    const dialog = useRef<HTMLDialogElement>(null)
    const title = useId()
    const field = useId()
    const disabled = unavailable || !allowed || busy

    useEffect(() => {
      alive.current = true
      return () => {
        alive.current = false
      }
    }, [])
    useEffect(() => {
      const close = () => dialog.current?.close()
      window.addEventListener('resize', close)
      return () => window.removeEventListener('resize', close)
    }, [])

    const show = () => {
      const element = dialog.current
      const button = trigger.current
      if (!element || !button) return
      setError(false)
      setSent(false)
      element.showModal()
      const anchor = button.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`
      element.style.top = `${Math.max(8, anchor.top - box.height - 8)}px`
      setOpen(true)
    }

    const send = async (action: Action) => {
      if (pending.current || disabled || (action === 'reuse' && !value.trim())) return
      pending.current = true
      setBusy(true)
      setError(false)
      try {
        const session = ctx.sessions.binding(sessionId)?.session
        if (!session) throw new Error('Session is no longer available')
        // Send separately: never replace the composer draft or consume its attachments.
        const result = await session.prompt(
          [{ type: 'text', text: requestText(action, value, language === 'ko') }],
          'queue'
        )
        if (!result.ok) throw new Error('Request was not accepted')
        if (!alive.current) return
        setSent(true)
        setValue('')
        dialog.current?.close()
      } catch {
        if (alive.current) setError(true)
      } finally {
        pending.current = false
        if (alive.current) setBusy(false)
      }
    }

    return (
      <div className="dsh-worktree">
        <button
          ref={trigger}
          type="button"
          className="dsh-worktree-trigger"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={unavailable ? text.wait : text.title}
          onClick={show}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            aria-hidden="true"
          >
            <circle cx="4" cy="3" r="1.5" />
            <circle cx="12" cy="4" r="1.5" />
            <circle cx="4" cy="13" r="1.5" />
            <path d="M4 4.5v7M12 5.5v1A3.5 3.5 0 0 1 8.5 10H4" />
          </svg>
          <span>Worktree</span>
          <span aria-hidden="true" className="dsh-worktree-chevron">
            ⌄
          </span>
        </button>
        <span className="dsh-worktree-sr" role="status">
          {sent ? text.sent : ''}
        </span>
        <dialog
          ref={dialog}
          className="dsh-worktree-dialog"
          aria-labelledby={title}
          onClose={() => setOpen(false)}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            const outside =
              e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom
            if (e.target === e.currentTarget && outside && !pending.current) e.currentTarget.close()
          }}
        >
          <header>
            <h2 id={title}>{text.title}</h2>
            <button type="button" aria-label={text.close} onClick={() => dialog.current?.close()}>
              ×
            </button>
          </header>
          <p>{text.description}</p>
          <fieldset disabled={busy}>
            <legend className="dsh-worktree-sr">{text.mode}</legend>
            <label>
              <input
                type="radio"
                name={field}
                checked={mode === 'create'}
                onChange={() => {
                  setMode('create')
                  setValue('')
                  setError(false)
                }}
              />
              {text.create}
            </label>
            <label>
              <input
                type="radio"
                name={field}
                checked={mode === 'reuse'}
                onChange={() => {
                  setMode('reuse')
                  setValue('')
                  setError(false)
                }}
              />
              {text.reuse}
            </label>
          </fieldset>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send(mode)
            }}
          >
            <label htmlFor={field}>{mode === 'create' ? text.branch : text.path}</label>
            <input
              id={field}
              type="text"
              value={value}
              disabled={busy}
              required={mode === 'reuse'}
              maxLength={mode === 'create' ? 200 : 4096}
              autoComplete="off"
              spellCheck={false}
              placeholder={mode === 'create' ? 'fix-login' : '/path/to/worktree'}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
              }}
            />
            <p className="dsh-worktree-hint">{mode === 'create' ? text.createHint : text.reuseHint}</p>
            {error && <p role="alert">{text.error}</p>}
            {unavailable && <p role="status">{text.wait}</p>}
            <footer>
              {mode === 'reuse' && (
                <button type="button" disabled={disabled} onClick={() => void send('list')}>
                  {text.list}
                </button>
              )}
              <button
                type="submit"
                className="dsh-worktree-primary"
                disabled={disabled || (mode === 'reuse' && !value.trim())}
              >
                {busy ? text.sending : text.send}
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
