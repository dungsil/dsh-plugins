import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { channel, endpointPrefix, maxSecretLength, type SecretRequest } from './protocol.js'

export const name = 'dungsil-request-secret'
export const inject = ['connection', 'locale']

const copy = {
  en: {
    title: 'Private secret input',
    ref: 'Credential reference',
    session: 'Requesting session',
    value: 'Secret value',
    privacy:
      'Saved in the host-wide DSH credential store, not in chat. The agent receives only the reference and status. This does not export a shell environment variable.',
    access: 'Stored until explicitly removed. Processes running as your OS user can read the credential store.',
    replace:
      'A credential already exists. Saving will replace its stored value for all DSH consumers of this reference.',
    save: 'Save credential',
    saving: 'Saving…',
    decline: 'Decline',
    error:
      'Could not confirm the save. The value has been cleared. Check the connection and credential store before trying again.',
  },
  ko: {
    title: '비밀값 입력',
    ref: '비밀값 참조 이름',
    session: '요청한 세션',
    value: '비밀값',
    privacy:
      '채팅 대신 호스트 전체에서 사용하는 DSH 비밀값 저장소에 저장합니다. 에이전트에는 참조 이름과 처리 상태만 전달하며, 셸 환경변수에는 넣지 않습니다.',
    access: '직접 삭제할 때까지 보관합니다. 같은 OS 계정으로 실행되는 프로세스는 저장소를 읽을 수 있습니다.',
    replace: '이미 등록된 비밀값입니다. 저장하면 이 참조를 사용하는 모든 DSH 기능에 새 값이 적용됩니다.',
    save: '비밀값 저장',
    saving: '저장 중…',
    decline: '거절',
    error: '저장 여부를 확인하지 못해 입력값을 지웠습니다. 연결과 비밀값 저장소를 확인한 뒤 다시 시도하세요.',
  },
}

const styles = `
.dsh-secret-dialog { box-sizing: border-box; width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; padding: 28px; border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: var(--dsw-radius-panel, 24px); color: var(--dsw-alias-label-primary, #222); background: var(--dsw-alias-bg-layer-2, #fff); font: 14px/1.6 var(--dsw-font-family, system-ui); box-shadow: 0 20px 80px #0003; }
.dsh-secret-dialog::backdrop { background: #0006; backdrop-filter: blur(3px); }
.dsh-secret-dialog h2 { margin: 0 0 12px; font-size: 20px; }
.dsh-secret-dialog p { margin: 12px 0; overflow-wrap: anywhere; }
.dsh-secret-dialog small { display: block; opacity: .75; overflow-wrap: anywhere; }
.dsh-secret-dialog label { display: block; margin-top: 20px; font-weight: 600; }
.dsh-secret-dialog code { display: block; overflow-wrap: anywhere; }
.dsh-secret-dialog input { box-sizing: border-box; width: 100%; min-height: 44px; margin: 8px 0; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l4, #8888); border-radius: 10px; font: inherit; color: inherit; background: var(--dsw-alias-bg-layer-1, #f5f5f5); }
.dsh-secret-dialog input:focus-visible, .dsh-secret-dialog button:focus-visible { outline: 2px solid #5677ee; outline-offset: 3px; }
.dsh-secret-dialog footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
.dsh-secret-dialog button { border: 1px solid var(--dsw-alias-border-l4, #8886); border-radius: 10px; padding: 9px 16px; font: inherit; cursor: pointer; background: transparent; color: inherit; }
.dsh-secret-dialog button[type=submit] { background: var(--dsw-alias-button-primary-fill, #222); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, white); }
.dsh-secret-dialog button:hover:not(:disabled) { filter: brightness(.9); }
.dsh-secret-dialog button:disabled { opacity: .5; cursor: default; }
.dsh-secret-dialog [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
`

export function apply(ctx: Context) {
  // Host and browser Context declarations share a TS program in this package.
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  if (connection.interactions !== 'answer') return
  ctx.effect(() => {
    const lifetime = new AbortController()
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    let timer: ReturnType<typeof setTimeout> | undefined
    let active: { id: string; dialog: HTMLDialogElement; clear: () => void; busy: boolean } | undefined

    const close = () => {
      active?.clear()
      active?.dialog.close()
      active?.dialog.remove()
      active = undefined
    }

    const show = (request: SecretRequest) => {
      const text = ctx.locale.getSnapshot().active.startsWith('ko') ? copy.ko : copy.en
      const dialog = document.createElement('dialog')
      dialog.className = 'dsh-secret-dialog'
      dialog.setAttribute('aria-label', text.title)
      dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      dialog.dataset.shortcutModal = 'request-secret'
      const form = document.createElement('form')
      const add = <K extends keyof HTMLElementTagNameMap>(tag: K, content: string) => {
        const element = document.createElement(tag)
        element.textContent = content
        form.append(element)
        return element
      }
      add('small', text.title)
      add('h2', request.label)
      add('p', request.reason)
      add('small', text.ref)
      add('code', request.ref)
      add('small', `${text.session}: ${request.sessionId}`)
      add('p', text.privacy)
      add('small', text.access)
      if (request.configured) add('p', text.replace)
      const label = add('label', text.value)
      const input = document.createElement('input')
      input.id = `secret-${request.id}`
      label.htmlFor = input.id
      input.type = 'password'
      input.autocomplete = 'off'
      input.spellcheck = false
      input.required = true
      input.maxLength = maxSecretLength
      input.autofocus = true
      input.setAttribute('autocapitalize', 'off')
      input.setAttribute('data-1p-ignore', '')
      input.setAttribute('data-lpignore', 'true')
      form.append(input)
      const error = add('p', '')
      error.setAttribute('role', 'alert')
      const footer = add('footer', '')
      const decline = document.createElement('button')
      decline.type = 'button'
      decline.textContent = text.decline
      const save = document.createElement('button')
      save.type = 'submit'
      save.textContent = text.save
      save.disabled = true
      footer.append(decline, save)
      const current = {
        id: request.id,
        dialog,
        clear: () => {
          input.value = ''
        },
        busy: false,
      }
      active = current
      input.addEventListener('input', () => {
        save.disabled = !input.value.length
      })

      const answer = async (action: 'save' | 'decline') => {
        if (current.busy || (action === 'save' && !input.value.length)) return
        current.busy = true
        save.disabled = decline.disabled = input.disabled = true
        if (action === 'save') save.textContent = text.saving
        error.textContent = ''
        try {
          const response = await connection.rpc.call(
            channel,
            `${endpointPrefix}answer`,
            {
              id: request.id,
              action,
              ...(action === 'save' ? { value: input.value } : {}),
            },
            lifetime.signal
          )
          if (!response.ok) throw new Error('Secret request failed')
          if (active === current) close()
        } catch {
          // Never display, log or report provider/transport error objects.
          error.textContent = text.error
        } finally {
          current.clear()
          current.busy = false
          decline.disabled = input.disabled = false
          save.disabled = true
          save.textContent = text.save
          if (input.isConnected) input.focus()
        }
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        void answer('save')
      })
      decline.addEventListener('click', () => {
        void answer('decline')
      })
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault()
        void answer('decline')
      })
      // Keep app-level typing and paste shortcuts out of this private form.
      for (const event of ['keydown', 'keyup', 'keypress', 'paste', 'input']) {
        dialog.addEventListener(event, (event) => event.stopPropagation())
      }
      dialog.append(form)
      document.body.append(dialog)
      dialog.showModal()
    }

    const poll = async () => {
      try {
        const response = await connection.rpc.call(channel, `${endpointPrefix}pending`, {}, lifetime.signal)
        if (lifetime.signal.aborted) return
        if (!response.ok) {
          if (!active?.busy) close()
          return
        }
        const requests = response.value as SecretRequest[]
        if (active && !active.busy && !requests.some((request) => request.id === active?.id)) close()
        if (!active && requests[0]) show(requests[0])
      } catch {
        if (!active?.busy) close()
      } finally {
        if (!lifetime.signal.aborted)
          timer = setTimeout(() => {
            void poll()
          }, 1000)
      }
    }
    void poll()
    return () => {
      lifetime.abort()
      clearTimeout(timer)
      close()
      style.remove()
    }
  }, 'request-secret: private input')
}
