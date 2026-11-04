import { useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export const name = 'dungsil-ui-commit-push-pr'
export const inject = ['slots', 'locale', 'sessions', 'conversation']

const request = `Commit, push, and create or update a pull request for the work completed in this session.
Write the commit message, PR title, and PR body yourself based on the actual diff and session context. Follow the repository's AGENTS.md, commit conventions, PR template, and language rules; do not ask the user to draft these messages.
Inspect the working directory, current branch, Git status, staged and unstaged diffs, recent commits, remotes, and any existing PR before making changes. Include only changes belonging to this task; preserve unrelated edits and staged changes, and never commit secrets.
Run the relevant checks before committing. If this task is already committed, do not create an empty or duplicate commit. If on a protected or default branch, create a suitable feature branch rather than pushing directly to it. Do not force-push, rewrite published history, merge the PR, or trigger a deployment.
Push the task branch to the appropriate remote. Create a PR if none exists for this branch; otherwise read its current title and body, then update it while preserving other contributors' edits. Inspect remote state before retrying an uncertain push or PR creation to avoid duplicates.
Use the existing tools and approval flow without weakening permissions. If Git, remote access, authentication, or required tools are unavailable, report the specific blocker rather than claiming success. Report the commit, pushed branch, PR URL, and checks actually run.`

const copy = {
  en: {
    label: 'Commit & Push & PR',
    hint: 'Ask the agent to write the commit and PR, commit changes, push, and create or update the PR.',
    sending: 'Sending request…',
    sent: 'Requested. Follow the agent’s progress in the conversation.',
    error: 'Could not confirm the request. Check the conversation before trying again.',
  },
  ko: {
    label: 'Commit & Push & PR',
    hint: '에이전트가 커밋 메시지와 PR을 작성하고 커밋·푸시한 뒤 PR을 생성하거나 업데이트하도록 요청합니다.',
    sending: '요청 전송 중…',
    sent: '요청했습니다. 대화에서 에이전트의 진행 상황을 확인하세요.',
    error: '요청 결과를 확인하지 못했습니다. 다시 시도하기 전에 대화를 확인하세요.',
  },
  zh: {
    label: '提交、推送与 PR',
    hint: '让智能体编写提交信息和 PR，提交并推送更改，然后创建或更新 PR。',
    sending: '正在发送请求…',
    sent: '已请求。请在对话中查看智能体的进度。',
    error: '无法确认请求结果。请先检查对话，再决定是否重试。',
  },
}

export function apply(ctx: Context) {
  function Action({ sessionId, useSession, useAccess }: PropsRuntime<'conversation.input.left'>) {
    const language = useSyncExternalStore(
      (listener) => ctx.locale.subscribe(listener),
      () => ctx.locale.getSnapshot().active
    )
    const text = copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
    const canPrompt = useAccess('session.prompt')
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const pending = useRef(false)
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
    const statusId = useId()
    const disabled = !canPrompt || unavailable || status === 'sending'

    const send = async () => {
      if (disabled || pending.current) return
      pending.current = true
      setStatus('sending')
      try {
        const conversation = ctx.sessions.scope(sessionId)?.get('conversation')
        if (!conversation) throw new Error('Session conversation unavailable')
        // Send only this action. Never submit, replace, or clear the composer's draft or attachments.
        await conversation.send(request)
        setStatus('sent')
      } catch {
        // Admission may have succeeded before a disconnect. Never retry automatically.
        setStatus('error')
      } finally {
        pending.current = false
      }
    }

    return (
      <span className="dsh-commit-push-pr">
        <button
          type="button"
          className="dsh-commit-push-pr-trigger"
          disabled={disabled}
          title={text.hint}
          aria-describedby={statusId}
          aria-busy={status === 'sending'}
          onClick={() => void send()}
        >
          {status === 'sending' ? text.sending : text.label}
        </button>
        <span id={statusId} role={status === 'error' ? 'alert' : 'status'} className="dsh-commit-push-pr-status">
          {status === 'error' ? text.error : status === 'sent' ? text.sent : ''}
        </span>
      </span>
    )
  }

  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register({ name: 'conversation.input.left', id: name, order: 100 }, (props) => (
      <Action key={props.sessionId} {...props} />
    ))
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = `
.dsh-commit-push-pr { display: inline-flex; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; }
.dsh-commit-push-pr-trigger { height: 28px; max-width: 100%; padding: 0 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; cursor: pointer; }
.dsh-commit-push-pr-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-commit-push-pr-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
.dsh-commit-push-pr-status { flex-basis: 100%; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-commit-push-pr-status:empty { display: none; }
.dsh-commit-push-pr-status[role=alert] { color: var(--dsw-alias-state-error-primary); }
@media (hover: hover) {
  .dsh-commit-push-pr-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
`
    document.head.append(style)
    return () => style.remove()
  }, 'ui-commit-push-pr: composer styles')
}
