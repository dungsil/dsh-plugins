import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, Pill } from '@dungsil/dsh-ui'
import { IconBranchOutlineRegular, IconChevronDownOutlineRegular } from '@dungsil/dsh-ui/icons'
import * as PullRequests from './pull-requests-client.js'

export const name = 'dungsil-ui-vcs'
export const inject = ['slots', 'locale', 'sessions', 'conversation', 'connection', 'sidebarRightTabs']

const instructions = {
  commit: 'Commit only the work completed in this session. Do not push, create or update a PR, or switch branches.',
  push: 'Commit the work completed in this session if needed, then push the current default branch. Do not create or update a PR or switch branches. If branch protection prevents the push, report the blocker without bypassing it.',
  pr: 'Commit and push the work completed in this session if needed, then create or update a pull request. If on the default branch or detached HEAD, create a suitable feature branch rather than pushing directly to the default branch.',
}
const request = `Write any required commit message, PR title, and PR body yourself based on the actual diff and session context. Follow the repository's AGENTS.md, commit conventions, PR template, and language rules; do not ask the user to draft these messages.
Inspect the working directory, current branch, Git status, staged and unstaged diffs, recent commits, remotes, and any existing PR before making changes. Include only changes belonging to this task; preserve unrelated edits and staged changes, and never commit secrets.
Run the relevant checks before committing. If this task is already committed, do not create an empty or duplicate commit. Do not force-push, rewrite published history, merge the PR, or trigger a deployment.
Only perform the selected operation. When a PR is requested, create one if none exists for this branch; otherwise read its current title and body, then update it while preserving other contributors' edits. Inspect remote state before retrying an uncertain push or PR creation to avoid duplicates.
Use the existing tools and approval flow without weakening permissions. If Git, remote access, authentication, or required tools are unavailable, report the specific blocker rather than claiming success. Report the commit, pushed branch, PR URL, and checks actually run.`

const copy = {
  en: {
    pr: 'Create PR',
    push: 'Push',
    commit: 'Commit only',
    menu: 'More Git actions',
    loading: 'Checking branch…',
    lookupError:
      'Could not determine the default branch. Refocus this window to retry. Commit only is still available.',
    hint: 'Ask the agent to commit and push, and create or update a PR on a feature branch or worktree.',
    sending: 'Sending request…',
    sent: 'Requested. Follow the agent’s progress in the conversation.',
    error: 'Could not confirm the request. Check the conversation before trying again.',
  },
  ko: {
    pr: 'PR 생성',
    push: '푸시',
    commit: '커밋만',
    menu: '다른 Git 작업',
    loading: '브랜치 확인 중…',
    lookupError: '기본 브랜치를 확인하지 못했습니다. 창으로 돌아오면 다시 확인합니다. 커밋만 요청할 수 있습니다.',
    hint: '에이전트가 커밋·푸시하고, 기능 브랜치나 worktree에서는 PR을 생성하거나 업데이트합니다.',
    sending: '요청 전송 중…',
    sent: '요청했습니다. 대화에서 에이전트의 진행 상황을 확인하세요.',
    error: '요청 결과를 확인하지 못했습니다. 다시 시도하기 전에 대화를 확인하세요.',
  },
  zh: {
    pr: '创建 PR',
    push: '推送',
    commit: '仅提交',
    menu: '更多 Git 操作',
    loading: '正在检查分支…',
    lookupError: '无法确定默认分支。重新聚焦窗口以重试。仍可选择仅提交。',
    hint: '让智能体提交并推送更改，在功能分支或 worktree 中创建或更新 PR。',
    sending: '正在发送请求…',
    sent: '已请求。请在对话中查看智能体的进度。',
    error: '无法确认请求结果。请先检查对话，再决定是否重试。',
  },
}

export function apply(ctx: Context) {
  ctx.plugin(PullRequests)
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const sessions = ctx.get('sessions') as unknown as ISessions
  function Action({ sessionId, useSession, useAccess, useProjection }: PropsRuntime<'conversation.input.dock'>) {
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
    const cwd = useProjection('workingDirectory')
    const [operation, setOperation] = useState<'push' | 'pr'>()
    const [lookup, setLookup] = useState<'loading' | 'ready' | 'error'>('loading')
    const [open, setOpen] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
    const statusId = useId()
    const disabled = !canPrompt || unavailable || status === 'sending'

    useEffect(() => {
      if (!hasChanges || hidden || unavailable) return
      let controller: AbortController | undefined
      const refresh = async () => {
        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        setLookup('loading')
        setOperation(undefined)
        try {
          const result = await connection.rpc.call('/api', 'dungsil-vcs/describe', { sessionId }, signal)
          if (signal.aborted) return
          if (!result.ok || (result.value !== 'push' && result.value !== 'pr'))
            throw new Error('Git context unavailable')
          setOperation(result.value)
          setLookup('ready')
        } catch {
          if (!signal.aborted) setLookup('error')
        }
      }
      void refresh()
      window.addEventListener('focus', refresh)
      return () => {
        controller?.abort()
        window.removeEventListener('focus', refresh)
      }
    }, [sessionId, cwd, hasChanges, hidden, unavailable])

    useEffect(() => {
      if (disabled) setOpen(false)
    }, [disabled])

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

    const send = async (selected: keyof typeof instructions) => {
      if (disabled || pending.current) return
      pending.current = true
      setOpen(false)
      setStatus('sending')
      try {
        // Re-read before submission: another tool or terminal may have switched the branch.
        if (selected !== 'commit') {
          const result = await connection.rpc.call('/api', 'dungsil-vcs/describe', { sessionId })
          if (!result.ok || result.value !== selected) {
            setOperation(result.ok && (result.value === 'push' || result.value === 'pr') ? result.value : undefined)
            setLookup(result.ok ? 'ready' : 'error')
            setStatus('idle')
            return
          }
        }
        const conversation = sessions.scope(sessionId)?.get('conversation')
        if (!conversation) throw new Error('Session conversation unavailable')
        // Send only this action. Never submit, replace, or clear the composer's draft or attachments.
        await conversation.send(`${instructions[selected]}\n${request}`)
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
      <div className="dsh-vcs">
        <div className="dsh-vcs-actions">
          <Pill
            className="dsh-vcs-trigger"
            disabled={disabled || !operation || lookup !== 'ready'}
            title={text.hint}
            aria-describedby={statusId}
            aria-busy={status === 'sending'}
            onClick={() => operation && void send(operation)}
          >
            <IconBranchOutlineRegular aria-hidden="true" />
            {status === 'sending' ? text.sending : operation === 'push' ? text.push : text.pr}
          </Pill>
          <Menu
            open={open}
            side="top"
            portal
            compact
            items={[{ id: 'commit', label: text.commit }]}
            onClose={() => setOpen(false)}
            onSelect={() => void send('commit')}
            anchor={
              <Pill
                className="dsh-vcs-trigger dsh-vcs-menu"
                disabled={disabled}
                aria-label={text.menu}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                onKeyDown={(event) => {
                  if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
                    event.preventDefault()
                    setOpen(true)
                  }
                }}
              >
                <IconChevronDownOutlineRegular aria-hidden="true" />
              </Pill>
            }
          />
        </div>
        <span id={statusId} role={status === 'error' ? 'alert' : 'status'} className="dsh-vcs-status">
          {status === 'error' ? text.error : status === 'sent' ? text.sent : ''}
        </span>
        {lookup !== 'ready' && (
          <span className="dsh-vcs-notice" role="status">
            {lookup === 'loading' ? text.loading : text.lookupError}
          </span>
        )}
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
.dsh-vcs { box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; width: calc(100% - 2 * var(--dsh-composer-side-clearance)); max-width: var(--dsh-composer-card-max-width); margin: 0 auto; padding-bottom: 8px; }
.dsh-vcs-actions { display: inline-flex; align-items: center; }
.dsh-vcs-actions > .dsh-vcs-trigger { border-radius: 14px 0 0 14px; }
.dsh-vcs-actions .dsh-vcs-menu { border-radius: 0 14px 14px 0; border-left: 0; padding: 0 7px; }
.dsh-vcs-notice { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-vcs-trigger { height: 28px; max-width: 100%; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); font: inherit; font-size: 12px; line-height: 18px; }
.dsh-vcs-trigger svg { flex: none; width: 14px; height: 14px; }
.dsh-vcs-trigger:disabled { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-vcs-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
.dsh-vcs-status { flex-basis: 100%; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-vcs-status:empty { display: none; }
.dsh-vcs-status[role=status] { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.dsh-vcs-status[role=alert] { color: var(--dsw-alias-state-error-primary); }
`
    document.head.append(style)
    return () => style.remove()
  }, 'ui-vcs: composer styles')
}
