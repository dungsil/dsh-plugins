import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { channel, endpointPrefix, maxSecretLength, type SecretRequest, type SecretStatus } from './protocol.js'

export const name = 'dungsil-request-secret'
export const inject = ['connection', 'locale', 'slots']

const copy = {
  en: {
    title: 'Private secret input',
    value: 'Secret value',
    privacy: 'Saved in the host-wide DSH credential store, not in chat. Only the reference and status reach the agent.',
    access:
      'Stored until removed. Processes running as your OS user can read it. Not exported to shell environment variables.',
    replace: 'This reference already exists. Saving replaces its value for all DSH consumers.',
    save: 'Save credential',
    saving: 'Saving…',
    decline: 'Decline',
    error:
      'Could not confirm the save. The value was cleared. Check the connection and credential store before retrying.',
    waiting: 'Waiting for private input…',
    closed: 'Input is no longer available.',
    saved: 'Credential saved',
    declined: 'Request declined',
    cancelled: 'Request cancelled',
    timed_out: 'Request expired',
    unavailable: 'Private input unavailable',
  },
  ko: {
    title: '비밀값 입력',
    value: '비밀값',
    privacy: '채팅 대신 호스트 공용 DSH 저장소에 저장합니다. 에이전트에는 참조 이름과 처리 상태만 전달합니다.',
    access: '직접 삭제할 때까지 보관합니다. 같은 OS 계정의 프로세스가 읽을 수 있으며, 셸 환경변수에는 넣지 않습니다.',
    replace: '이미 등록된 참조입니다. 저장하면 이 참조를 사용하는 모든 DSH 기능에 새 값이 적용됩니다.',
    save: '비밀값 저장',
    saving: '저장 중…',
    decline: '거절',
    error: '저장 여부를 확인하지 못해 입력값을 지웠습니다. 연결과 비밀값 저장소를 확인한 뒤 다시 시도하세요.',
    waiting: '비밀값 입력을 기다리고 있습니다.',
    closed: '입력 요청이 종료되었습니다.',
    saved: '비밀값을 저장했습니다.',
    declined: '요청을 거절했습니다.',
    cancelled: '요청이 취소되었습니다.',
    timed_out: '입력 시간이 만료되었습니다.',
    unavailable: '비밀값 입력을 사용할 수 없습니다.',
  },
}

const styles = `
.dsh-secret-card { box-sizing: border-box; width: 100%; min-width: 0; margin: 8px 0; padding: 20px; border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: 16px; color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-2, #fff); font: 14px/1.6 var(--dsw-font-family, system-ui); overflow-wrap: anywhere; }
.dsh-secret-card h3 { margin: 4px 0 8px; font-size: 16px; }
.dsh-secret-card p { margin: 8px 0; }
.dsh-secret-card small { display: block; opacity: .75; }
.dsh-secret-card code { display: block; margin: 8px 0; }
.dsh-secret-card label { display: block; margin-top: 16px; font-weight: 600; }
.dsh-secret-card input { box-sizing: border-box; width: 100%; min-height: 44px; margin: 8px 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l4, #8888); border-radius: 10px; font: inherit; color: inherit; background: var(--dsw-alias-bg-layer-1, #f5f5f5); }
.dsh-secret-card input:focus-visible, .dsh-secret-card button:focus-visible { outline: 2px solid #5677ee; outline-offset: 3px; }
.dsh-secret-card footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.dsh-secret-card button { border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: 10px; padding: 9px 16px; font: inherit; cursor: pointer; background: transparent; color: inherit; }
.dsh-secret-card button[type=submit] { background: var(--dsw-alias-button-primary-fill, #222); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, white); }
.dsh-secret-card button:hover:not(:disabled) { filter: brightness(.9); }
.dsh-secret-card button:disabled { opacity: .5; cursor: default; }
.dsh-secret-card [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
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
      <p>{text.privacy}</p>
      <small>{text.access}</small>
      {request.configured && <p>{text.replace}</p>}
      <label htmlFor={`secret-${request.id}`}>{text.value}</label>
      <input
        ref={input}
        id={`secret-${request.id}`}
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
      {error && <p role="alert">{text.error}</p>}
      <footer>
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
    const text = ctx.locale.getSnapshot().active.startsWith('ko') ? copy.ko : copy.en
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
        <small>{text.title}</small>
        <h3>{request?.label ?? props.block.args.text('label') ?? text.title}</h3>
        <p>{request?.reason ?? props.block.args.text('reason')}</p>
        <code>{request?.ref ?? props.block.args.text('ref')}</code>
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
