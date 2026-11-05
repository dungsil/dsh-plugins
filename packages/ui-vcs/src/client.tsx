import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, Pill, StateDot } from '@dungsil/dsh-ui'
import { IconBranchOutlineRegular, IconChevronDownOutlineRegular } from '@dungsil/dsh-ui/icons'
import * as PullRequests from './pull-requests-client.js'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import {
  channel,
  describeMethod,
  executeMethod,
  isGitActionResult,
  type GitActionResult,
  type GitOperation,
} from './protocol.js'
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
    loading: 'Checking branch…',
    lookupError:
      'Could not determine the default branch. Refocus this window to retry. Commit only is still available.',
    hint: 'Commit and push changes, and create or update a PR on a feature branch or worktree.',
    sending: 'Running Git action…',
    sent: 'Git action completed.',
    noChanges: 'No task changes to commit.',
    error: 'Could not confirm the Git action. Check Git and remote state before retrying.',
    partialStage: 'A selected file has staged and unstaged changes. Finish staging that file before retrying.',
    readOnly: 'Git actions are unavailable in read-only mode.',
    conflict: 'The repository changed. Check Git state before retrying.',
    busy: 'Another task is active. Wait for it to finish.',
  },
  ko: {
    pr: 'PR 생성',
    updatePr: 'PR 업데이트',
    viewPr: 'PR 보기',
    push: '푸시',
    commit: '커밋만',
    menu: '다른 Git 작업',
    loading: '브랜치 확인 중…',
    lookupError: '기본 브랜치를 확인하지 못했습니다. 창으로 돌아오면 다시 확인합니다. 커밋만 요청할 수 있습니다.',
    hint: '변경 사항을 커밋·푸시하고, 기능 브랜치나 worktree에서는 PR을 생성하거나 업데이트합니다.',
    sending: 'Git 작업 실행 중…',
    sent: 'Git 작업을 완료했습니다.',
    noChanges: '커밋할 작업 변경 사항이 없습니다.',
    error: 'Git 작업 결과를 확인하지 못했습니다. 다시 시도하기 전에 Git과 원격 저장소 상태를 확인하세요.',
    partialStage:
      '선택한 파일에 스테이징한 변경과 하지 않은 변경이 함께 있습니다. 해당 파일의 스테이징을 마친 뒤 다시 시도하세요.',
    readOnly: '읽기 전용 모드에서는 Git 작업을 실행할 수 없습니다.',
    conflict: '저장소 상태가 바뀌었습니다. Git 상태를 확인한 뒤 다시 시도하세요.',
    busy: '다른 작업을 실행 중입니다. 작업이 끝날 때까지 기다리세요.',
  },
  zh: {
    pr: '创建 PR',
    updatePr: '更新 PR',
    viewPr: '查看 PR',
    push: '推送',
    commit: '仅提交',
    menu: '更多 Git 操作',
    loading: '正在检查分支…',
    lookupError: '无法确定默认分支。重新聚焦窗口以重试。仍可选择仅提交。',
    hint: '提交并推送更改，在功能分支或 worktree 中创建或更新 PR。',
    sending: '正在执行 Git 操作…',
    sent: 'Git 操作已完成。',
    noChanges: '没有可提交的任务更改。',
    error: '无法确认 Git 操作结果。请先检查 Git 和远程仓库状态，再决定是否重试。',
    partialStage: '所选文件同时包含已暂存和未暂存的更改。请完成该文件的暂存后重试。',
    readOnly: '只读模式下无法执行 Git 操作。',
    conflict: '仓库状态已更改。请检查 Git 状态后重试。',
    busy: '另一个任务正在运行。请等待任务结束。',
  },
}

export function apply(ctx: Context) {
  ctx.plugin(PullRequests)
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
    const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
    const [result, setResult] = useState<GitActionResult>()
    const [errorCode, setErrorCode] = useState('')
    const mounted = useRef(true)
    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])
    const statusId = useId()
    const disabled = !canPrompt || unavailable || status === 'sending' || typeof cwd !== 'string'
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
      if (!hasChanges || hidden || unavailable) return
      let controller: AbortController | undefined
      const refresh = async () => {
        controller?.abort()
        controller = new AbortController()
        const signal = controller.signal
        setLookup('loading')
        setOperation(undefined)
        setHasRequest(false)
        setCiRequest(null)
        setNeedsUpdate(false)
        try {
          const result = await connection.rpc.call(channel, describeMethod, { sessionId }, signal)
          if (signal.aborted) return
          if (!result.ok) throw new Error('Git context unavailable')
          const context = result.value as GitContext
          if (context.operation !== 'push' && context.operation !== 'pr') throw new Error('Git context unavailable')
          setOperation(context.operation)
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
          }
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
      setResult(undefined)
      setErrorCode('')
      setStatus('sending')
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
        if (!response.ok) {
          setErrorCode(response.error.code)
          setStatus('error')
          return
        }
        if (!isGitActionResult(response.value) || response.value.operation !== selected)
          throw new Error('Invalid Git response')
        setResult(response.value)
        if (response.value.operation === 'pr' && response.value.url) {
          setHasRequest(true)
          setNeedsUpdate(false)
        }
        setStatus('sent')
      } catch {
        if (mounted.current) setStatus('error')
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
            disabled={(!viewOnly && disabled) || !operation || lookup !== 'ready'}
            title={viewOnly ? text.viewPr : text.hint}
            aria-describedby={statusId}
            aria-busy={status === 'sending'}
            onClick={() => {
              if (viewOnly) ctx.sidebarRight.openTab(PullRequests.name)
              else if (operation) void send(operation)
            }}
          >
            <IconBranchOutlineRegular aria-hidden="true" />
            {viewOnly
              ? text.viewPr
              : status === 'sending'
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
            <StateDot state={ciState} appearance="step" />
            {`${labels.checks}: ${ciLabel}`}
          </Pill>
        )}
        <span id={statusId} role={status === 'error' ? 'alert' : 'status'} className="dsh-vcs-status">
          {status === 'error'
            ? errorCode === 'partial_stage'
              ? text.partialStage
              : errorCode === 'read_only'
                ? text.readOnly
                : errorCode === 'conflict'
                  ? text.conflict
                  : errorCode === 'busy'
                    ? text.busy
                    : text.error
            : status === 'sent'
              ? result?.operation === 'commit' && !result.commit
                ? text.noChanges
                : text.sent
              : ''}
          {status === 'sent' && result?.commit && <> {result.commit.slice(0, 12)}</>}
          {status === 'sent' && result?.url && (
            <>
              {' '}
              <a href={result.url} target="_blank" rel="noreferrer">
                {result.url}
              </a>
            </>
          )}
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
.dsh-vcs-notice { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-vcs-trigger { height: 28px; max-width: 100%; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); font: inherit; font-size: 12px; line-height: 18px; }
.dsh-vcs-trigger svg { flex: none; width: 14px; height: 14px; }
.dsh-vcs-trigger:disabled { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-vcs-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
.dsh-vcs-status { flex-basis: 100%; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dsh-vcs-status:empty { display: none; }
.dsh-vcs-status { overflow-wrap: anywhere; }
.dsh-vcs-status[role=alert] { color: var(--dsw-alias-state-error-primary); }
.dsh-vcs-session-request svg { width: 100%; height: 100%; }
`
    document.head.append(style)
    return () => style.remove()
  }, 'ui-vcs: composer styles')
}
