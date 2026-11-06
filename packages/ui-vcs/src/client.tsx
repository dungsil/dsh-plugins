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
    success: {
      commit: 'Commit complete. Changes are saved locally.',
      push: 'Push complete. The remote branch is up to date.',
      pr: 'PR updated or created. Open View PR to review it.',
    },
    stages: {
      inspect: 'Repository inspection',
      generate: 'Content generation',
      commit: 'Commit',
      push: 'Push',
      pr: 'PR creation or update',
    },
    stage: 'Failed stage',
    committed: 'A local commit was completed.',
    pushed: 'The branch was pushed.',
    retry:
      'Check the repository and remote before retrying. A remote operation may have completed even if its result is unknown.',
    errors: {
      busy: 'Another Git action is running. Wait for it to finish.',
      invalid: 'The Git request is invalid. Refresh the session before trying again.',
      conflict: 'The repository has conflicting changes. Resolve them before trying again.',
      read_only: 'This session does not allow Git changes.',
      partial_stage: 'A file has both staged and unstaged changes. Review its staging before trying again.',
      invalid_plan: 'The generated Git plan could not be used. Review the changes before trying again.',
      missing_base: 'The remote base commit is not available locally. Fetch the base branch before retrying.',
      unsupported: 'This repository or hosting provider is not supported.',
      default_branch: 'Create a feature branch before creating a PR.',
      detached_head: 'Check out a branch before running this action.',
      ambiguous_review: 'More than one PR matches. Check the repository and select the intended PR.',
      ambiguous_target: 'The target branch is unclear. Check the repository configuration.',
      stale_request: 'The repository changed. Refresh its state before trying again.',
      cli_missing: 'A required Git or hosting CLI is unavailable. Check its installation and authentication.',
      command_failed: 'A Git or hosting command failed. Check the repository and authentication.',
      generation_failed: 'Git content could not be generated. Check the model configuration and try again.',
      timeout: 'The Git action timed out.',
      operation_failed: 'The Git action could not be completed.',
      sensitive_file: 'A potentially sensitive file was detected. Review the changes before committing.',
      connection: 'The connection was interrupted. The Git action result is unknown.',
    },
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
    success: {
      commit: '커밋을 완료했습니다. 변경 사항을 로컬에 저장했습니다.',
      push: '푸시를 완료했습니다. 원격 브랜치가 최신 상태입니다.',
      pr: 'PR을 생성하거나 업데이트했습니다. PR 보기에서 확인하세요.',
    },
    stages: {
      inspect: '저장소 확인',
      generate: '내용 생성',
      commit: '커밋',
      push: '푸시',
      pr: 'PR 생성 또는 업데이트',
    },
    stage: '실패한 단계',
    committed: '로컬 커밋을 완료했습니다.',
    pushed: '브랜치를 푸시했습니다.',
    retry:
      '다시 시도하기 전에 저장소와 원격 상태를 확인하세요. 결과를 확인하지 못했어도 원격 작업은 완료되었을 수 있습니다.',
    errors: {
      busy: '다른 Git 작업이 실행 중입니다. 완료될 때까지 기다리세요.',
      invalid: 'Git 요청이 올바르지 않습니다. 세션을 새로 고친 후 다시 시도하세요.',
      conflict: '저장소에 충돌하는 변경 사항이 있습니다. 충돌을 해결한 후 다시 시도하세요.',
      read_only: '이 세션에서는 Git 변경 작업을 할 수 없습니다.',
      partial_stage:
        '한 파일에 스테이징된 변경과 스테이징되지 않은 변경이 함께 있습니다. 스테이징 상태를 검토한 후 다시 시도하세요.',
      invalid_plan: '생성된 Git 계획을 사용할 수 없습니다. 변경 사항을 검토한 후 다시 시도하세요.',
      missing_base: '원격 기준 커밋이 로컬에 없습니다. 기준 브랜치를 가져온(fetch) 후 다시 시도하세요.',
      unsupported: '지원하지 않는 저장소 또는 호스팅 서비스입니다.',
      default_branch: '기능 브랜치를 만든 후 PR을 생성하세요.',
      detached_head: '브랜치를 체크아웃한 후 이 작업을 실행하세요.',
      ambiguous_review: '일치하는 PR이 여러 개입니다. 저장소에서 대상 PR을 확인하세요.',
      ambiguous_target: '대상 브랜치가 명확하지 않습니다. 저장소 설정을 확인하세요.',
      stale_request: '저장소가 변경되었습니다. 최신 상태를 확인한 후 다시 시도하세요.',
      cli_missing: '필요한 Git 또는 호스팅 CLI를 사용할 수 없습니다. 설치 및 인증 상태를 확인하세요.',
      command_failed: 'Git 또는 호스팅 명령이 실패했습니다. 저장소와 인증 상태를 확인하세요.',
      generation_failed: 'Git 작업에 필요한 내용을 생성하지 못했습니다. 모델 설정을 확인한 후 다시 시도하세요.',
      timeout: 'Git 작업 시간이 초과되었습니다.',
      operation_failed: 'Git 작업을 완료하지 못했습니다.',
      sensitive_file: '민감한 정보가 포함될 수 있는 파일을 발견했습니다. 커밋 전에 변경 사항을 검토하세요.',
      connection: '연결이 끊겨 Git 작업 결과를 확인할 수 없습니다.',
    },
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
    success: {
      commit: '提交完成。更改已保存在本地。',
      push: '推送完成。远程分支已更新。',
      pr: 'PR 已创建或更新。请打开“查看 PR”进行检查。',
    },
    stages: { inspect: '检查仓库', generate: '生成内容', commit: '提交', push: '推送', pr: '创建或更新 PR' },
    stage: '失败阶段',
    committed: '本地提交已完成。',
    pushed: '分支已推送。',
    retry: '重试前请检查仓库和远程状态。即使结果未知，远程操作也可能已经完成。',
    errors: {
      busy: '另一个 Git 操作正在运行。请等待其完成。',
      invalid: 'Git 请求无效。请刷新会话后重试。',
      conflict: '仓库中存在冲突的更改。请解决冲突后重试。',
      read_only: '此会话不允许更改 Git 仓库。',
      partial_stage: '同一文件中同时存在已暂存和未暂存的更改。请检查暂存状态后重试。',
      invalid_plan: '无法使用生成的 Git 计划。请检查更改后重试。',
      missing_base: '本地没有远程基础提交。请获取（fetch）基础分支后重试。',
      unsupported: '不支持此仓库或托管服务。',
      default_branch: '请先创建功能分支，再创建 PR。',
      detached_head: '请先检出一个分支，再执行此操作。',
      ambiguous_review: '有多个匹配的 PR。请在仓库中确认目标 PR。',
      ambiguous_target: '目标分支不明确。请检查仓库配置。',
      stale_request: '仓库已更改。请刷新状态后重试。',
      cli_missing: '所需的 Git 或托管 CLI 不可用。请检查安装和认证状态。',
      command_failed: 'Git 或托管命令失败。请检查仓库和认证状态。',
      generation_failed: '无法生成 Git 操作所需的内容。请检查模型配置后重试。',
      timeout: 'Git 操作超时。',
      operation_failed: '无法完成 Git 操作。',
      sensitive_file: '检测到可能包含敏感信息的文件。提交前请检查更改。',
      connection: '连接中断，Git 操作结果未知。',
    },
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
    const [feedback, setFeedback] = useState<
      { success: GitOperation } | { code: string; stage?: string; committed?: boolean; pushed?: boolean }
    >()
    const showActions = !hidden && !unavailable && hasChanges && lookup === 'ready' && !!operation
    const failure = feedback && !('success' in feedback) ? feedback : undefined
    // Only allowlisted local copy is rendered; server messages and arbitrary details are never displayed.
    const failureText = failure
      ? [
          text.errors[
            Object.hasOwn(text.errors, failure.code) ? (failure.code as keyof typeof text.errors) : 'operation_failed'
          ],
          failure.stage && Object.hasOwn(text.stages, failure.stage)
            ? `${text.stage}: ${text.stages[failure.stage as keyof typeof text.stages]}.`
            : '',
          failure.committed ? text.committed : '',
          failure.pushed ? text.pushed : '',
          text.retry,
        ]
          .filter(Boolean)
          .join(' ')
      : ''
    const mounted = useRef(true)
    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])
    const disabled = !canPrompt || unavailable || sending || typeof cwd !== 'string'
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
        if (pending.current || controller) return
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
        } finally {
          controller = undefined
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
      setFeedback(undefined)
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
          const error = response.error as {
            code?: unknown
            details?: { stage?: unknown; committed?: unknown; pushed?: unknown }
          }
          setFeedback({
            code: typeof error?.code === 'string' ? error.code : 'operation_failed',
            stage: typeof error?.details?.stage === 'string' ? error.details.stage : undefined,
            committed: error?.details?.committed === true,
            pushed: error?.details?.pushed === true,
          })
          return
        }
        if (!isGitActionResult(response.value) || response.value.operation !== selected)
          throw new Error('Invalid Git response')
        if (response.value.operation === 'pr' && response.value.url) {
          setHasRequest(true)
          setNeedsUpdate(false)
        }
        setFeedback({ success: selected })
      } catch {
        // Do not retry an action whose remote outcome is unknown.
        if (mounted.current) setFeedback({ code: 'connection' })
      } finally {
        pending.current = false
        if (mounted.current) setSending(false)
      }
    }

    if ((hidden || !showActions) && !feedback && !sending) return <span ref={anchor} hidden />

    return (
      <div className="dsh-vcs">
        {showActions && (
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
        )}
        {showActions && hasRequest && (
          <Pill
            className="dsh-vcs-trigger"
            title={`${labels.checks}: ${ciLabel}`}
            onClick={() => ctx.sidebarRight.openTab(PullRequests.name, { params: { section: 'checks' } })}
          >
            <PullRequests.CheckStatusIcon state={ciState} />
            {`${labels.checks}: ${ciLabel}`}
          </Pill>
        )}
        <div className="dsh-vcs-feedback" role="alert" aria-atomic="true">
          {failureText}
        </div>
        <div className="dsh-vcs-feedback" role="status" aria-atomic="true">
          {sending ? text.sending : feedback && 'success' in feedback ? text.success[feedback.success] : ''}
        </div>
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
.dsh-vcs-feedback { flex-basis: 100%; min-width: 0; font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsh-vcs-feedback:empty { position: absolute; width: 0; height: 0; overflow: hidden; }
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
