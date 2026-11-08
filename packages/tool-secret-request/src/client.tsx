import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { channel, endpointPrefix, maxSecretLength, type SecretRequest, type SecretStatus } from './protocol.js'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import ja from '../locale/ja.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import de from '../locale/de.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }

export const name = 'dungsil-request-secret'
export const inject = ['connection', 'locale', 'slots']

const copy = {
  en: en.ui,
  ko: ko.ui,
  zh: zh.ui,
  ja: ja.ui,
  es: es.ui,
  fr: fr.ui,
  de: de.ui,
  ru: ru.ui,
  pt: pt.ui,
}

const styles = `
.dsh-secret-card { box-sizing: border-box; width: 100%; min-width: 0; margin: 6px 0; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: 10px; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-2, #fff); font: 13px/1.45 var(--dsw-font-family, system-ui); overflow-wrap: anywhere; }
.dsh-secret-card bdi { unicode-bidi: isolate; }
.dsh-secret-card .dsh-secret-context { unicode-bidi: plaintext; }
.dsh-secret-card h3 { margin: 0; font-size: 14px; }
.dsh-secret-card p { margin: 4px 0; }
.dsh-secret-card small { display: block; margin-top: 6px; font-size: 12px; color: var(--dsw-alias-label-secondary, #666); }
.dsh-secret-card input { box-sizing: border-box; flex: 1 1 140px; min-width: 0; height: 36px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l4, #8888); border-radius: 7px; font: inherit; color: inherit; background: var(--dsw-alias-bg-layer-1, #f5f5f5); }
.dsh-secret-card input:focus-visible, .dsh-secret-card button:focus-visible { outline: 2px solid #5677ee; outline-offset: 3px; }
.dsh-secret-card footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.dsh-secret-card button { flex: none; min-height: 36px; border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: 7px; padding: 6px 10px; font: inherit; cursor: pointer; background: transparent; color: inherit; }
.dsh-secret-card button[type=submit] { background: var(--dsw-alias-button-primary-fill, #222); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, white); }
.dsh-secret-card button:hover:not(:disabled) { filter: brightness(.9); }
.dsh-secret-card button:disabled { opacity: .5; cursor: default; }
.dsh-secret-card [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
@media (max-width: 480px) { .dsh-secret-card input { flex-basis: 100%; } }
`

type Text = (typeof copy)[keyof typeof copy]

function SecretForm({
  request,
  text,
  connection,
  onSettled,
}: {
  request: SecretRequest
  text: Text
  connection: ConnectionHandle
  onSettled: (status: SecretStatus) => void
}) {
  // Keep the value only in this input, never in the chat store or React state.
  const input = useRef<HTMLInputElement>(null)
  const lock = useRef(false)
  const [lifetime] = useState(() => new AbortController())
  const [busy, setBusy] = useState(false)
  const [empty, setEmpty] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    const element = input.current
    return () => {
      if (element) element.value = ''
      lifetime.abort()
    }
  }, [lifetime])

  const answer = async (action: 'save' | 'decline') => {
    const element = input.current
    if (!element || lock.current || (action === 'save' && !element.value.length)) return
    lock.current = true
    setBusy(true)
    setError(false)
    try {
      const response = await connection.rpc.call(
        channel,
        `${endpointPrefix}answer`,
        {
          id: request.id,
          action,
          ...(action === 'save' ? { value: element.value } : {}),
        },
        lifetime.signal
      )
      if (!response.ok) throw new Error('Secret request failed')
      onSettled(action === 'save' ? 'saved' : 'declined')
    } catch {
      // Never display, log or report transport/provider exception objects.
      setError(true)
    } finally {
      element.value = ''
      lock.current = false
      setEmpty(true)
      setBusy(false)
    }
  }
  useEffect(() => {
    if (error && !busy) input.current?.focus()
  }, [error, busy])

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void answer('save')
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
      onKeyPress={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
    >
      <p id={`secret-target-${request.id}`}>
        <strong>{text.target}: </strong>
        <code>
          <bdi dir="ltr">{request.ref}</bdi>
        </code>
      </p>
      {request.configured && (
        <p>
          {text.replace}{' '}
          <code>
            <bdi dir="ltr">{request.ref}</bdi>
          </code>
        </p>
      )}
      <footer>
        <input
          ref={input}
          id={`secret-${request.id}`}
          aria-label={text.value}
          aria-describedby={`secret-target-${request.id} secret-privacy-${request.id}`}
          placeholder={text.value}
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          data-1p-ignore=""
          data-lpignore="true"
          required
          maxLength={maxSecretLength}
          disabled={busy}
          onInput={(event) => {
            event.stopPropagation()
            setEmpty(!event.currentTarget.value.length)
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void answer('decline')
          }}
        >
          {text.decline}
        </button>
        <button type="submit" disabled={busy || empty}>
          {busy ? text.saving : text.save}
        </button>
      </footer>
      <small id={`secret-privacy-${request.id}`}>{text.privacy}</small>
      {error && <p role="alert">{text.error}</p>}
    </form>
  )
}

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const lifetime = new AbortController()
  let requests: SecretRequest[] = []
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const snapshot = () => requests
  const update = (next: SecretRequest[]) => {
    requests = next
    for (const listener of listeners) listener()
  }

  function SecretCard(props: ToolCallViewProps) {
    const pending = useSyncExternalStore(subscribe, snapshot)
    const [submitted, setSubmitted] = useState<SecretStatus>()
    const subscribeLocale = useCallback((listener: () => void) => ctx.locale.subscribe(listener), [])
    const localeSnapshot = useCallback(() => ctx.locale.getSnapshot(), [])
    const locale = useSyncExternalStore(subscribeLocale, localeSnapshot)
    const text = (copy as Record<string, Text>)[locale.active.toLowerCase().split(/[-_]/)[0]] ?? copy.en
    // A card may only answer the live request for this exact session and call.
    const request = pending.find((item) => item.sessionId === props.sessionId && item.callId === props.callId)
    let status: string | undefined = submitted && text[submitted]
    if (props.phase === 'result') {
      status = text.closed
      const content = props.block.content[0]
      try {
        const result = content?.type === 'text' ? JSON.parse(content.text) : null
        if (
          !props.block.isError &&
          ['saved', 'declined', 'cancelled', 'timed_out', 'unavailable'].includes(result?.status)
        )
          status = text[result.status as SecretStatus]
      } catch {
        /* Do not echo raw results or error text into the private card. */
      }
    }
    return (
      <section className="dsh-secret-card" aria-label={text.title}>
        <h3>{text.title}</h3>
        <small>{text.context}</small>
        <p className="dsh-secret-context">{request?.label ?? props.block.args.text('label')}</p>
        <p className="dsh-secret-context">{request?.reason ?? props.block.args.text('reason')}</p>
        {status ? (
          <p role="status">{status}</p>
        ) : request && connection.interactions === 'answer' ? (
          <SecretForm key={request.id} request={request} text={text} connection={connection} onSettled={setSubmitted} />
        ) : (
          <p role="status">{text.waiting}</p>
        )}
      </section>
    )
  }

  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register(
      {
        name: 'tool.call.toolview',
        key: 'request_secret',
      },
      SecretCard
    )
  )

  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const response = await connection.rpc.call(channel, `${endpointPrefix}pending`, {}, lifetime.signal)
        if (!lifetime.signal.aborted) update(response.ok ? (response.value as SecretRequest[]) : [])
      } catch {
        if (!lifetime.signal.aborted) update([])
      } finally {
        if (!lifetime.signal.aborted)
          timer = setTimeout(() => {
            void poll()
          }, 1000)
      }
    }
    if (connection.interactions === 'answer') void poll()
    return () => {
      lifetime.abort()
      clearTimeout(timer)
      update([])
      style.remove()
    }
  }, 'request-secret: inline input')
}
