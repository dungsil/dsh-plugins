import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, Pill } from '@dungsil/dsh-ui'
import { IconBranchOutlineRegular, IconChevronDownOutlineRegular } from '@dungsil/dsh-ui/icons'
import * as PullRequests from './pull-requests-client.js'
import * as Settings from './settings-client.js'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { channel, describeMethod, executeMethod, isGitActionResult, type GitOperation } from './protocol.js'
import { method, type GitContext, type RequestView } from './pull-requests-protocol.js'

export const name = 'dungsil-ui-vcs'
export const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs', 'sidebarRight']

const copy = {
  en: {
    pr: 'Create PR',
    updatePr: 'Update PR',
    viewPr: 'View PR',
    push: 'Push',
    commit: 'Commit only',
    menu: 'More Git actions',
    hint: 'Commit and push changes, and create or update a PR on a feature branch or worktree.',
    sending: 'Running Git action…',
  },
  ko: {
    pr: 'PR 생성',
    updatePr: 'PR 업데이트',
    viewPr: 'PR 보기',
    push: '푸시',
    commit: '커밋만',
    menu: '다른 Git 작업',
    hint: '변경 사항을 커밋·푸시하고, 기능 브랜치나 worktree에서는 PR을 생성하거나 업데이트합니다.',
    sending: 'Git 작업 실행 중…',
  },
  zh: {
    pr: '创建 PR',
    updatePr: '更新 PR',
    viewPr: '查看 PR',
    push: '推送',
    commit: '仅提交',
    menu: '更多 Git 操作',
    hint: '提交并推送更改，在功能分支或 worktree 中创建或更新 PR。',
    sending: '正在执行 Git 操作…',
  },
}

export function apply(ctx: Context) {
  ctx.plugin(PullRequests)
  ctx.plugin(Settings)
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  function Action({ sessionId, useSession, useAccess, useProjection }: PropsRuntime<'conversation.input.dock'>) {
    const language = useSyncExternalStore(
      (listener) => ctx.locale.subscribe(listener),
      () => ctx.locale.getSnapshot().active
    )
    const text = copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
    const labels = language.startsWith('ko') ? ko : language.startsWith('zh') ? zh : en
    const canPrompt = useAccess('session.prompt')
    const hidden = useSession((s) => s.blank || s.awaitingFirstTurn || s.removed || s.openState !== 'open')
    const unavailable = useSession(
      (s) => s.running || s.removed || s.openState !== 'open' || s.pendingSubmissions.length > 0
    )
    const pending = useRef(false)
    const anchor = useRef<HTMLSpanElement>(null)
    const cwd = useProjection('workingDirectory')
    const [operation, setOperation] = useState<'push' | 'pr'>()
    const [hasRequest, setHasRequest] = useState(false)
    const [ciRequest, setCiRequest] = useState<RequestView['request']>(null)
    const [needsUpdate, setNeedsUpdate] = useState(false)
    const [lookup, setLookup] = useState<'loading' | 'ready' | 'error'>('loading')
    const [open, setOpen] = useState(false)
    const [hasChanges, setHasChanges] = useState(false)
    const [sending, setSending] = useState(false)
    const mounted = useRef(true)
    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])
    const disabled = !canPrompt || unavailable || sending || typeof cwd !== 'string' || lookup !== 'ready'
    const viewOnly = hasRequest && !needsUpdate
    const ciState = ciRequest ? PullRequests.checksState(ciRequest) : 'warning'
    const ciLabel = {
      done: labels.success,
      error: labels.failure,
      warning: labels.checks_unknown,
      ongoing: labels.pending_check,
      idle: labels.checks_complete,
    }[ciState]

    useEffect(() => {
      setLookup('loading')
      setOperation(undefined)
      setHasRequest(false)
      setCiRequest(null)
      setNeedsUpdate(false)
    }, [sessionId, cwd])

    useEffect(() => {
      if (!hasChanges || hidden || unavailable) return
      let controller: AbortController | undefined
      const refresh = async () => {
        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        // Keep the last result visible during background reads; only writes wait for fresh context.
        setLookup('loading')
        try {
          const result = await connection.rpc.call(channel, describeMethod, { sessionId }, signal)
          if (signal.aborted) return
          if (!result.ok) throw new Error('Git context unavailable')
          const context = result.value as GitContext
          if (context.operation !== 'push' && context.operation !== 'pr') throw new Error('Git context unavailable')
          if (context.operation === 'pr') {
            // Review lookup may be unavailable before the first push or without a hosting CLI.
            // Keep creation available. The server checks for an existing PR before each write.
            try {
              const requests = await connection.rpc.call(channel, method, { sessionId }, signal)
              if (signal.aborted) return
              if (requests.ok) {
                const request = (requests.value as RequestView).request
                setCiRequest(request)
                setHasRequest(!!request)
                setNeedsUpdate(!!request && (context.dirty || context.headSha !== request.headSha))
              }
            } catch {
              if (signal.aborted) return
            }
          } else {
            setHasRequest(false)
            setCiRequest(null)
            setNeedsUpdate(false)
          }
          setOperation(context.operation)
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
      if (disabled || viewOnly) setOpen(false)
    }, [disabled, viewOnly])

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

    const send = async (selected: GitOperation) => {
      if (disabled || pending.current || typeof cwd !== 'string') return
      pending.current = true
      setOpen(false)
      setSending(true)
      try {
        const response = await connection.rpc.call(
          channel,
          executeMethod,
          {
            sessionId,
            cwd,
            operation: selected,
            requestId: crypto.randomUUID(),
          },
          AbortSignal.timeout(300_000)
        )
        if (!mounted.current) return
        if (!response.ok) return
        if (!isGitActionResult(response.value) || response.value.operation !== selected)
          throw new Error('Invalid Git response')
        if (response.value.operation === 'pr' && response.value.url) {
          setHasRequest(true)
          setNeedsUpdate(false)
        }
      } catch {
        // Do not retry an action whose remote outcome is unknown.
      } finally {
        pending.current = false
        if (mounted.current) setSending(false)
      }
    }

    if (hidden || !hasChanges || !operation || (lookup === 'error' && !hasRequest)) return <span ref={anchor} hidden />

    return (
      <div className="dsh-vcs">
        <div className="dsh-vcs-actions">
          <Pill
            className="dsh-vcs-trigger"
            disabled={!viewOnly && disabled}
            title={viewOnly ? text.viewPr : text.hint}
            aria-busy={sending}
            onClick={() => {
              if (viewOnly) ctx.sidebarRight.openTab(PullRequests.name)
              else if (operation) void send(operation)
            }}
          >
            <IconBranchOutlineRegular aria-hidden="true" />
            {viewOnly
              ? text.viewPr
              : sending
                ? text.sending
                : operation === 'push'
                  ? text.push
                  : hasRequest
                    ? text.updatePr
                    : text.pr}
          </Pill>
          {!viewOnly && (
            <Menu
              open={open}
              side="top"
              portal
              compact
              items={[
                ...(hasRequest ? [{ id: 'view', label: text.viewPr }] : []),
                { id: 'commit', label: text.commit },
              ]}
              onClose={() => setOpen(false)}
              onSelect={(id) => {
                if (id === 'view') {
                  setOpen(false)
                  ctx.sidebarRight.openTab(PullRequests.name)
                } else void send('commit')
              }}
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
          )}
        </div>
        {hasRequest && (
          <Pill
            className="dsh-vcs-trigger"
            title={`${labels.checks}: ${ciLabel}`}
            onClick={() => ctx.sidebarRight.openTab(PullRequests.name, { params: { section: 'checks' } })}
          >
            <PullRequests.CheckStatusIcon state={ciState} />
            {`${labels.checks}: ${ciLabel}`}
          </Pill>
        )}
      </div>
    )
  }

  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({ name: 'conversation.input.dock', id: name, order: -100 }, (props) => (
      <Action key={props.sessionId} {...props} />
    ))
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = `
.dsh-vcs { box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; width: calc(100% - 2 * var(--dsh-composer-side-clearance) - 4 * var(--dsh-composer-dock-inset)); max-width: calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset)); margin: 0 auto; padding-bottom: 8px; }
.dsh-vcs-actions { display: inline-flex; align-items: center; }
.dsh-vcs-actions > .dsh-vcs-trigger { border-radius: 14px 0 0 14px; }
.dsh-vcs-actions > .dsh-vcs-trigger:only-child { border-radius: 14px; }
.dsh-vcs-actions .dsh-vcs-menu { border-radius: 0 14px 14px 0; border-left: 0; padding: 0 7px; }
.dsh-vcs-trigger { height: 28px; max-width: 100%; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); font: inherit; font-size: 12px; line-height: 18px; }
.dsh-vcs-trigger svg { flex: none; width: 14px; height: 14px; }
.dsh-vcs-trigger:disabled { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-vcs-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
.dsh-vcs-session-request svg { width: 100%; height: 100%; }
`
    document.head.append(style)
    return () => style.remove()
  }, 'ui-vcs: composer styles')
}
