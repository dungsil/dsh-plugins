import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconBranchOutlineRegular, Pill } from '@deepseek-ai/dsh-client-ui-primitives'

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
  function Action({ sessionId, useSession, useAccess }: PropsRuntime<'conversation.input.dock'>) {
    const language = useSyncExternalStore(
      (listener) => ctx.locale.subscribe(listener),
      () => ctx.locale.getSnapshot().active
    )
    const text = copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
    const canPrompt = useAccess('session.prompt')
    const hidden = useSession((s) => s.blank || s.awaitingFirstTurn || s.removed || s.openState !== 'open')
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const pending = useRef(false)
    const anchor = useRef<HTMLSpanElement>(null)
    const [hasChanges, setHasChanges] = useState(false)
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
    const statusId = useId()
    const disabled = !canPrompt || unavailable || status === 'sending'

    useEffect(() => {
      const conversation = anchor.current?.closest('[data-conversation-session]')
      if (conversation?.getAttribute('data-conversation-session') !== sessionId) return
      // Follow the actual card, not a tool call or an announcement whose summary may be missing.
      // Remember it for this session even when the chat virtualizes the card away.
      const observer = new MutationObserver(() => {
        if (!conversation.querySelector('[data-changed-files]')) return
        setHasChanges(true)
        observer.disconnect()
      })
      observer.observe(conversation, { childList: true, subtree: true })
      if (conversation.querySelector('[data-changed-files]')) {
        setHasChanges(true)
        observer.disconnect()
      }
      return () => observer.disconnect()
    }, [sessionId])

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

    if (hidden || !hasChanges) return <span ref={anchor} hidden />

    return (
      <div className="dsh-commit-push-pr">
        <Pill
          className="dsh-commit-push-pr-trigger"
          disabled={disabled}
          title={text.hint}
          aria-describedby={statusId}
          aria-busy={status === 'sending'}
          onClick={() => void send()}
        >
          <IconBranchOutlineRegular aria-hidden="true" />
          {status === 'sending' ? text.sending : text.label}
        </Pill>
        <span id={statusId} role={status === 'error' ? 'alert' : 'status'} className="dsh-commit-push-pr-status">
          {status === 'error' ? text.error : status === 'sent' ? text.sent : ''}
        </span>
      </div>
    )
  }

  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({ name: 'conversation.input.dock', id: name, order: 100 }, (props) => (
      <Action key={props.sessionId} {...props} />
    ))
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = `
.dsh-commit-push-pr { box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; width: calc(100% - 2 * var(--dsh-composer-side-clearance)); max-width: var(--dsh-composer-card-max-width); margin: 0 auto; padding-bottom: 8px; }
.dsh-commit-push-pr-trigger { height: 28px; max-width: 100%; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); font: inherit; font-size: 12px; line-height: 18px; }
.dsh-commit-push-pr-trigger svg { flex: none; width: 14px; height: 14px; }
.dsh-commit-push-pr-trigger:disabled { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-commit-push-pr-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
.dsh-commit-push-pr-status { flex-basis: 100%; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-commit-push-pr-status:empty { display: none; }
.dsh-commit-push-pr-status[role=status] { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.dsh-commit-push-pr-status[role=alert] { color: var(--dsw-alias-state-error-primary); }
`
    document.head.append(style)
    return () => style.remove()
  }, 'ui-commit-push-pr: composer styles')
}
