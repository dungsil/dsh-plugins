import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  ButtonPicker,
  CodeBlock,
  MarkdownText,
  Menu,
  Modal,
  SegmentedTabs,
  Tag,
  type StateDotState,
} from '@dungsil/dsh-ui'
import {
  IconBranchOutlineRegular,
  IconCheckCircleOutlineRegular,
  IconChevronDownOutlineRegular,
  IconLinkOutlineRegular,
  IconLoadingOutlineRegular,
  IconQuestionOutlineRegular,
  IconRefreshOutlineRegular,
  circleMinusIconSvg,
  circleXIconSvg,
  mergeIconSvg,
  pullRequestClosedIconSvg,
  pullRequestDraftIconSvg,
  pullRequestIconSvg,
} from '@dungsil/dsh-ui/icons'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { splitMarkdownSections, type MarkdownSection } from './markdown-sections.js'
import {
  actionMethod,
  channel,
  method,
  type RequestAction,
  type RequestItem,
  type RequestView,
} from './pull-requests-protocol.js'
import { styles } from './pull-requests-styles.js'
import { bindPullRequestLinks, pullRequestUrl } from './pull-request-links.js'

export const name = 'dungsil-vcs-pull-requests'
export const inject = ['slots', 'locale', 'connection', 'sessions', 'sidebarRightTabs', 'sidebarRight']

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dungsil-vcs-pull-requests': { requestUrl?: string; section?: 'checks' }
  }
}

type ReviewAction = Exclude<RequestAction['action'], 'merge'>
type Strategy = NonNullable<RequestAction['strategy']>

const providerNames: Record<RequestView['provider'], string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  forgejo: 'Forgejo',
}

export function checksState(item: RequestItem): StateDotState {
  const states = item.checks.map((check) => check.status.toLowerCase())
  if (
    states.some((state) =>
      [
        'failure',
        'failed',
        'error',
        'timed_out',
        'action_required',
        'startup_failure',
        'stale',
        'cancelled',
        'canceled',
      ].includes(state)
    )
  )
    return 'error'
  if (item.detailsError || !states.length) return 'warning'
  if (states.some((state) => !['success', 'passed', 'neutral', 'skipped'].includes(state))) return 'ongoing'
  return states.every((state) => ['success', 'passed'].includes(state)) ? 'done' : 'idle'
}

export function CheckStatusIcon({ state }: { state: StateDotState }) {
  return (
    <span className="dsh-vcs-check-status" data-state={state} aria-hidden="true">
      {state === 'done' ? (
        <IconCheckCircleOutlineRegular size={14} />
      ) : state === 'ongoing' ? (
        <IconLoadingOutlineRegular size={14} />
      ) : state === 'warning' ? (
        <IconQuestionOutlineRegular size={14} />
      ) : (
        <span dangerouslySetInnerHTML={{ __html: state === 'error' ? circleXIconSvg : circleMinusIconSvg }} />
      )}
    </span>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <span className="dsh-pr-loading" role="status" aria-label={label}>
      <IconLoadingOutlineRegular aria-hidden="true" />
    </span>
  )
}

function Description({ text, labels }: Pick<ComponentProps<typeof MarkdownText>, 'text' | 'labels'>) {
  const { introduction, sections, definitions } = useMemo(() => splitMarkdownSections(text), [text])
  const render = (items: MarkdownSection[]) =>
    items.map((section, index) => (
      <details key={index} className="dsh-pr-heading" open={section === sections[0]}>
        <summary>
          <IconChevronDownOutlineRegular aria-hidden="true" />
          <MarkdownText text={`${section.heading}\n\n${definitions}`} labels={labels} variant="compact" />
        </summary>
        <div className="dsh-pr-heading-content">
          {section.content.trim() && (
            <MarkdownText text={`${section.content}\n\n${definitions}`} labels={labels} variant="compact" />
          )}
          {render(section.children)}
        </div>
      </details>
    ))
  return (
    <>
      {introduction.trim() && (
        <MarkdownText text={`${introduction}\n\n${definitions}`} labels={labels} variant="compact" />
      )}
      {render(sections)}
    </>
  )
}

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const sessions = ctx.get('sessions') as unknown as ISessions
  const views = new Map<string, RequestView>()
  ctx.effect(() => () => views.clear())
  const subscribe = (listener: () => void) => ctx.locale.subscribe(listener)
  const text = () => {
    const language = ctx.locale.getSnapshot().active
    return language.startsWith('ko') ? ko : language.startsWith('zh') ? zh : en
  }

  function SessionRequest({ sessionId }: PropsRuntime<'sidebar.workspaces.session.row.action'>) {
    useSyncExternalStore(subscribe, () => ctx.locale.getSnapshot().active)
    const copy = text()
    const current = useSyncExternalStore(
      (listener) => ctx.sidebarRight.mounted.subscribe(listener),
      () => ctx.sidebarRight.mounted.getSnapshot() === sessionId
    )
    const running = useSyncExternalStore(
      (listener) => sessions.list.subscribe(listener),
      () => sessions.list.getSnapshot().byId[sessionId]?.running ?? false
    )
    const cwd = useSyncExternalStore(
      (listener) => sessions.list.subscribe(listener),
      () => sessions.list.getSnapshot().byId[sessionId]?.cwd
    )
    const anchor = useRef<HTMLSpanElement>(null)
    const [host, setHost] = useState<HTMLSpanElement>()
    const [view, setView] = useState<RequestView>()
    useEffect(() => {
      // The leading slot disappears during live activity, and row actions are
      // hover-only. Use the worktree label's trailing seat before those actions.
      const row = anchor.current?.closest('[data-row-key]')
      const actions = row?.lastElementChild
      if (row?.getAttribute('data-row-key') !== `session:${sessionId}` || !actions) return
      const node = document.createElement('span')
      node.style.display = 'inline-flex'
      node.style.flex = 'none'
      row.insertBefore(node, actions)
      setHost(node)
      return () => node.remove()
    }, [sessionId])
    useEffect(() => {
      setView(undefined)
    }, [sessionId, current, cwd])
    useEffect(() => {
      if (!current || running) return
      let disposed = false
      let active: AbortController | undefined
      const refresh = async () => {
        // Keep one read in flight: aborting an RPC does not finish its child-process teardown.
        if (disposed || active || document.visibilityState === 'hidden') return
        const controller = new AbortController()
        active = controller
        const { signal } = controller
        try {
          const result = await connection.rpc.call(channel, method, { sessionId, summary: true }, signal)
          if (!signal.aborted) setView(result.ok ? (result.value as RequestView) : undefined)
        } catch {
          if (!signal.aborted) setView(undefined)
        } finally {
          if (active === controller) active = undefined
        }
      }
      void refresh()
      window.addEventListener('focus', refresh)
      document.addEventListener('visibilitychange', refresh)
      const interval = window.setInterval(refresh, 60_000)
      return () => {
        disposed = true
        active?.abort()
        window.removeEventListener('focus', refresh)
        document.removeEventListener('visibilitychange', refresh)
        window.clearInterval(interval)
      }
    }, [sessionId, current, running, cwd])
    const item = current ? view?.request : undefined
    const state = item?.state === 'open' && item.draft ? 'draft' : item?.state
    const icon =
      state === 'merged'
        ? mergeIconSvg
        : state === 'closed'
          ? pullRequestClosedIconSvg
          : state === 'draft'
            ? pullRequestDraftIconSvg
            : pullRequestIconSvg
    const label =
      item && state ? `${copy.title} ${view?.provider === 'gitlab' ? '!' : '#'}${item.number}: ${copy[state]}` : ''
    return (
      <>
        <span ref={anchor} hidden />
        {host &&
          item &&
          state &&
          createPortal(
            <span
              className="dsh-vcs-session-request"
              role="img"
              aria-label={label}
              title={label}
              data-state={state}
              dangerouslySetInnerHTML={{ __html: icon }}
              style={{
                display: 'inline-flex',
                width: 14,
                height: 14,
                marginInline: 6,
                color:
                  state === 'open'
                    ? 'var(--dsw-alias-state-success-primary)'
                    : state === 'closed'
                      ? 'var(--dsw-alias-state-error-primary)'
                      : state === 'merged'
                        ? 'var(--dsw-alias-state-business-primary)'
                        : 'var(--dsw-alias-label-tertiary)',
              }}
            />,
            host
          )}
      </>
    )
  }

  function Links({ sessionId }: PropsRuntime<'conversation.input.dock'>) {
    const anchor = useRef<HTMLSpanElement>(null)
    useEffect(() => {
      const conversation = anchor.current?.closest('[data-conversation-session]')
      if (conversation?.getAttribute('data-conversation-session') !== sessionId) return
      return bindPullRequestLinks(conversation, (requestUrl) => {
        if (ctx.sidebarRight.mounted.getSnapshot() !== sessionId) return false
        ctx.sidebarRight.openTab(name, { params: { requestUrl } })
        return true
      })
    }, [sessionId])
    return <span ref={anchor} hidden />
  }

  function Requests({ sessionId, useTabInfo, useSession }: PropsRuntime<'sidebar.right.pane.tab'>) {
    useSyncExternalStore(subscribe, () => ctx.locale.getSnapshot().active)
    const copy = text()
    const { tab } = useTabInfo()
    const params = tab.navigation.params as { requestUrl?: unknown; section?: unknown } | undefined
    const requestUrl = typeof params?.requestUrl === 'string' ? pullRequestUrl(params.requestUrl) : undefined
    const cacheKey = JSON.stringify([sessionId, requestUrl])
    const running = useSession((session) => session.running)
    const [view, setView] = useState<RequestView | undefined>(() => views.get(cacheKey))
    const [error, setError] = useState<Exclude<keyof typeof en, 'meta'>>()
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState<'overview' | 'changes' | 'conversation'>('overview')
    const [body, setBody] = useState('')
    const [reviewAction, setReviewAction] = useState<ReviewAction>('comment')
    const [strategy, setStrategy] = useState<Strategy>('squash')
    const [strategyOpen, setStrategyOpen] = useState(false)
    const [checksOpen, setChecksOpen] = useState(false)
    const [confirmation, setConfirmation] = useState<RequestAction>()
    const [notice, setNotice] = useState<'completed' | 'action_failed' | 'stale_request'>()
    const [pending, setPending] = useState(false)
    const submitting = useRef(false)
    const active = useRef<AbortController | null>(null)
    const content = useRef<HTMLDivElement | null>(null)
    const tabsId = useId()
    const item = view?.request
    const labels = useMemo(
      () => ({ code: { copyLabel: copy.copy, copiedLabel: copy.copied }, footnotes: copy.footnotes }),
      [copy]
    )
    const canReview =
      !!item &&
      (!requestUrl ||
        (view?.provider === 'github'
          ? pullRequestUrl(item.url)?.toLowerCase() === requestUrl.toLowerCase()
          : pullRequestUrl(item.url) === requestUrl)) &&
      item.state === 'open' &&
      !!item.headSha &&
      !item.detailsError &&
      !loading &&
      !pending &&
      !error &&
      !notice
    const mergeBlockedReason = (() => {
      if (loading) return
      if (pending) return copy.pending
      if (error) return copy[error]
      if (notice) return copy[notice]
      if (!item) return
      if (item.state !== 'open') return copy[item.state]
      if (!item.headSha) return copy.stale_request
      if (item.detailsError) return copy.details_error
      if (item.draft) return copy.draft
      if (!item.diff.trim()) return copy.no_diff
      if (!['MERGEABLE', 'mergeable', 'can_be_merged'].includes(item.mergeable)) return copy.merge_not_ready
      if (!['', 'APPROVED'].includes(item.reviewDecision)) return copy.merge_review_blocked
      if (
        item.checks.some((check) => !['success', 'passed', 'neutral', 'skipped'].includes(check.status.toLowerCase()))
      )
        return copy.merge_checks_blocked
    })()
    const canMerge = canReview && !mergeBlockedReason

    const load = async () => {
      if (submitting.current) return
      active.current?.abort()
      const controller = new AbortController()
      active.current = controller
      const signal = AbortSignal.any([controller.signal, tab.signal])
      setLoading(true)
      setStrategyOpen(false)
      setError(undefined)
      setConfirmation(undefined)
      setNotice(undefined)
      try {
        // A cached snapshot is display-only while the fresh, full read is in flight.
        // On first open, show the cheap overview without waiting for CI or a large diff.
        for (const summary of views.has(cacheKey) ? [false] : [true, false]) {
          const result = await connection.rpc.call(
            channel,
            method,
            { sessionId, summary, ...(requestUrl ? { requestUrl } : {}) },
            signal
          )
          signal.throwIfAborted()
          if (!result.ok) throw result.error
          const next = result.value as RequestView
          setView(next)
          views.delete(cacheKey)
          views.set(cacheKey, next)
          if (views.size > 20) views.delete(views.keys().next().value!)
          if (!next.request) break
        }
      } catch (cause) {
        if (signal.aborted) return
        const code = (cause as { code?: string } | null)?.code
        setError(
          code === 'unsupported' && requestUrl
            ? 'link_unsupported'
            : code && ['repository', 'unsupported', 'cli_missing', 'command_failed', 'invalid_response'].includes(code)
              ? (code as Exclude<keyof typeof en, 'meta'>)
              : 'unavailable'
        )
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    useEffect(() => {
      setView(views.get(cacheKey))
      setBody('')
      setConfirmation(undefined)
      setNotice(undefined)
      setPage('overview')
      setStrategy('squash')
      setStrategyOpen(false)
      setChecksOpen(false)
    }, [sessionId, requestUrl])

    useEffect(() => {
      if (params?.section !== 'checks') return
      setChecksOpen(true)
      setPage('overview')
      content.current?.scrollTo({ top: 0 })
    }, [sessionId, requestUrl, params?.section, tab.navigation.revision])

    useEffect(() => {
      if (!tab.visible) return
      void load()
      const focus = () => {
        void load()
      }
      window.addEventListener('focus', focus)
      const unbind = tab.actions.bindCommands({
        refresh: () => {
          void load()
        },
      })
      return () => {
        active.current?.abort()
        window.removeEventListener('focus', focus)
        unbind()
      }
    }, [sessionId, tab.visible, running, requestUrl, tab.navigation.revision])

    const prepare = (action: RequestAction['action']) => {
      if (!item || !canReview || confirmation || (action === 'merge' && !canMerge) || submitting.current) return
      setStrategyOpen(false)
      setNotice(undefined)
      setConfirmation({
        sessionId,
        requestUrl: item.url,
        headSha: item.headSha,
        action,
        ...(action === 'merge' ? { strategy } : { body: body.trim() }),
      })
    }
    const submit = async () => {
      if (!confirmation || submitting.current || confirmation.sessionId !== sessionId) return
      submitting.current = true
      setPending(true)
      active.current?.abort()
      setLoading(false)
      try {
        const result = await connection.rpc.call(channel, actionMethod, confirmation, tab.signal)
        if (!result.ok) throw result.error
        setBody('')
        setNotice('completed')
      } catch (cause) {
        setNotice((cause as { code?: string } | null)?.code === 'stale_request' ? 'stale_request' : 'action_failed')
      } finally {
        // A lost response may follow a successful write. Never automatically retry a mutation.
        setConfirmation(undefined)
        submitting.current = false
        setPending(false)
      }
    }
    const checkStatus = (value: string): { label: string; state: StateDotState } => {
      const state = value.toLowerCase()
      if (['success', 'passed'].includes(state)) return { label: copy.success, state: 'done' }
      if (state === 'neutral') return { label: copy.neutral, state: 'idle' }
      if (['failure', 'failed', 'error', 'timed_out', 'action_required', 'startup_failure', 'stale'].includes(state))
        return { label: copy.failure, state: 'error' }
      if (['skipped', 'cancelled', 'canceled'].includes(state))
        return { label: state === 'skipped' ? copy.skipped : copy.cancelled, state: 'idle' }
      return { label: `${copy.pending_check} · ${value}`, state: 'ongoing' }
    }
    const checkStates = item?.checks.map((check) => checkStatus(check.status).state) ?? []
    const state = item ? checksState(item) : 'warning'
    const checksLabel = {
      done: copy.success,
      error: copy.failure,
      warning: copy.checks_unknown,
      ongoing: copy.pending_check,
      idle: copy.checks_complete,
    }[state]
    const checksSummary = copy.checks_summary
      .replace('{passed}', String(checkStates.filter((state) => state === 'done').length))
      .replace('{total}', String(checkStates.length))
    const strategies = [
      { id: 'squash', label: copy.squash },
      { id: 'merge', label: copy.merge_commit },
      ...(view && view.provider !== 'gitlab' ? [{ id: 'rebase', label: copy.rebase }] : []),
    ]

    return (
      <section className="dsh-pr-panel" aria-label={copy.title}>
        <style>{styles}</style>
        <header>
          <div>
            <strong>{view ? providerNames[view.provider] : copy.title}</strong>
            {view && (
              <>
                <span className="dsh-pr-repository" title={view.repository}>
                  {view.repository}
                </span>
                {!item && (
                  <span className="dsh-pr-branch">
                    <IconBranchOutlineRegular aria-hidden="true" />
                    {view.branch || 'HEAD'}
                  </span>
                )}
              </>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            className="dsh-pr-refresh"
            onClick={() => {
              void load()
            }}
            disabled={loading || pending}
            aria-busy={loading}
            aria-label={copy.refresh}
            title={copy.refresh}
          >
            {loading && view ? <Loading label={copy.loading} /> : <IconRefreshOutlineRegular aria-hidden="true" />}
          </Button>
        </header>
        <div ref={content} className="dsh-pr-content" aria-busy={loading}>
          {loading && !view && (
            <div className="dsh-pr-initial-loading">
              <Loading label={copy.loading} />
            </div>
          )}
          {error && (
            <p role="alert" className="dsh-pr-section">
              {copy[error] as string}
              {requestUrl && (
                <>
                  <br />
                  <a href={requestUrl} target="_blank" rel="noopener noreferrer">
                    {requestUrl}
                  </a>
                </>
              )}
            </p>
          )}
          {notice && <p role={notice === 'completed' ? 'status' : 'alert'}>{copy[notice]}</p>}
          {view &&
            (item ? (
              <article className="dsh-pr-request">
                <div className="dsh-pr-summary">
                  <h2 className="dsh-pr-title">
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title}{' '}
                      <span className="dsh-pr-number">
                        {view.provider === 'gitlab' ? '!' : '#'}
                        {item.number}
                      </span>
                      <IconLinkOutlineRegular aria-hidden="true" />
                    </a>
                  </h2>
                  <div className="dsh-pr-meta">
                    <Tag className="dsh-pr-status" tone={item.state === 'open' && !item.draft ? 'success' : 'neutral'}>
                      {item.state === 'open' && item.draft ? copy.draft : copy[item.state]}
                    </Tag>
                    <span className="dsh-pr-refs" title={`${item.source} → ${item.target}`}>
                      <IconBranchOutlineRegular aria-hidden="true" />
                      <code>{item.source}</code>
                      <span aria-hidden="true">→</span>
                      <code>{item.target}</code>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      className="dsh-pr-ci-trigger"
                      aria-label={`${copy.checks}: ${loading ? copy.loading : `${checksSummary} · ${checksLabel}`}`}
                      aria-expanded={checksOpen}
                      aria-controls={`${tabsId}-checks`}
                      title={`${copy.checks}: ${loading ? copy.loading : checksLabel}`}
                      onClick={() => setChecksOpen(!checksOpen)}
                      aria-busy={loading}
                    >
                      {loading ? <Loading label={copy.loading} /> : <CheckStatusIcon state={state} />}
                      <span>{item.headSha ? checksSummary : copy.checks}</span>
                      <IconChevronDownOutlineRegular aria-hidden="true" />
                    </Button>
                  </div>
                  {checksOpen && (
                    <div id={`${tabsId}-checks`} className="dsh-pr-ci-results" role="region" aria-label={copy.checks}>
                      {!loading && !item.checks.length && !item.detailsError && <p>{copy.no_checks}</p>}
                      <ul className="dsh-pr-checks">
                        {item.checks.map((check, index) => {
                          const status = checkStatus(check.status)
                          return (
                            <li key={`${check.name}-${index}`}>
                              <CheckStatusIcon state={status.state} />
                              <span className="dsh-pr-check-name">
                                {check.url ? (
                                  <a href={check.url} target="_blank" rel="noopener noreferrer">
                                    {check.name}
                                  </a>
                                ) : (
                                  check.name
                                )}
                                <small>{status.label}</small>
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="dsh-pr-tabs">
                  <SegmentedTabs
                    label={copy.title}
                    value={page}
                    onChange={(page) => {
                      setPage(page)
                      content.current?.scrollTo({ top: 0 })
                    }}
                    items={[
                      {
                        value: 'overview',
                        label: copy.overview,
                        id: `${tabsId}-overview`,
                        panelId: `${tabsId}-overview-panel`,
                      },
                      {
                        value: 'changes',
                        label: item.headSha ? `${copy.changes} (${item.files.length})` : copy.changes,
                        id: `${tabsId}-changes`,
                        panelId: `${tabsId}-changes-panel`,
                      },
                      {
                        value: 'conversation',
                        label: copy.conversation,
                        id: `${tabsId}-conversation`,
                        panelId: `${tabsId}-conversation-panel`,
                      },
                    ]}
                  />
                </div>
                {item.detailsError && (
                  <p className="dsh-pr-warning" role="alert">
                    {copy.details_error}
                  </p>
                )}
                <div
                  role="tabpanel"
                  id={`${tabsId}-${page}-panel`}
                  aria-labelledby={`${tabsId}-${page}`}
                  aria-busy={loading && page !== 'overview'}
                  tabIndex={0}
                >
                  {page === 'overview' && (
                    <>
                      {item.diffTruncated && <p className="dsh-pr-warning">{copy.diff_truncated}</p>}
                      <section className="dsh-pr-section dsh-pr-description" aria-label={copy.body}>
                        <h3>{copy.body}</h3>
                        <Description key={item.body} text={item.body || copy.no_body} labels={labels} />
                      </section>
                    </>
                  )}
                  {page === 'changes' && (
                    <section className="dsh-pr-section" aria-label={copy.changes}>
                      <h3>
                        {copy.files}
                        {item.headSha && <Tag tone="neutral">{item.files.length}</Tag>}
                        {loading && <Loading label={copy.loading} />}
                      </h3>
                      <ul className="dsh-pr-files">
                        {item.files.map((file, index) => {
                          const basename = file.path.lastIndexOf('/') + 1
                          return (
                            <li key={`${file.path}-${index}`}>
                              <code>
                                <span className="dsh-pr-directory">{file.path.slice(0, basename)}</span>
                                {file.path.slice(basename)}
                              </code>
                              <span className="dsh-pr-file-count">
                                <span className="dsh-pr-additions">+{file.additions}</span>
                                <span className="dsh-pr-deletions">−{file.deletions}</span>
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                      <details open className="dsh-pr-diff">
                        <summary>{copy.diff}</summary>
                        {item.diff ? (
                          <CodeBlock code={item.diff} lang="diff" copyLabel={copy.copy} copiedLabel={copy.copied} />
                        ) : !loading ? (
                          <p>{copy.no_diff}</p>
                        ) : null}
                      </details>
                      {item.diffTruncated && <p className="dsh-pr-warning">{copy.diff_truncated}</p>}
                    </section>
                  )}
                  {page === 'conversation' && (
                    <section className="dsh-pr-section" aria-label={copy.conversation}>
                      <h3>
                        {copy.conversation}
                        {loading && <Loading label={copy.loading} />}
                      </h3>
                      {!loading && !item.detailsError && !item.comments.length && !item.reviews.length && (
                        <p>{copy.no_conversation}</p>
                      )}
                      {item.comments.map((comment, index) => (
                        <article className="dsh-pr-comment" key={`comment-${index}`}>
                          <strong>{comment.author}</strong>
                          <MarkdownText text={comment.body} labels={labels} variant="compact" />
                        </article>
                      ))}
                      {item.reviews.map((review, index) => (
                        <article className="dsh-pr-comment" key={`review-${index}`}>
                          <strong>
                            {review.author} · {review.state}
                          </strong>
                          <MarkdownText text={review.body} labels={labels} variant="compact" />
                        </article>
                      ))}
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          prepare(reviewAction)
                        }}
                      >
                        <h3>{copy.review}</h3>
                        <p>{copy.review_hint}</p>
                        {view.provider === 'gitlab' && <p>{copy.gitlab_review_hint}</p>}
                        <label>
                          {copy.review_body}
                          <textarea
                            value={body}
                            maxLength={15000}
                            disabled={pending}
                            onChange={(event) => setBody(event.target.value)}
                          />
                        </label>
                        <div className="dsh-pr-actions">
                          <ButtonPicker
                            size="sm"
                            className="dsh-pr-picker"
                            menuClassName="dsh-pr-choice"
                            compact
                            label={copy.review}
                            value={reviewAction}
                            disabled={pending}
                            onChange={setReviewAction}
                            items={[
                              { id: 'comment', label: copy.comment },
                              {
                                id: 'approve',
                                label: copy.approve,
                                disabled: item.draft || item.diffTruncated || !item.diff,
                              },
                              ...(view.provider !== 'gitlab'
                                ? [{ id: 'request_changes' as const, label: copy.request_changes }]
                                : []),
                            ]}
                          />
                          <Button
                            type="submit"
                            variant="primary"
                            size="sm"
                            disabled={
                              !canReview ||
                              (reviewAction !== 'approve' && !body.trim()) ||
                              (view.provider === 'gitlab' && reviewAction === 'approve' && !!body.trim()) ||
                              (reviewAction === 'approve' && (item.draft || item.diffTruncated || !item.diff))
                            }
                          >
                            {copy.submit}
                          </Button>
                        </div>
                      </form>
                    </section>
                  )}
                </div>
                {confirmation && (
                  <Modal
                    open
                    title={copy.confirm}
                    description={copy.confirm_hint}
                    closeLabel={copy.cancel}
                    className="dsh-pr-confirm"
                    contentClassName="dsh-pr-confirm-content"
                    onClose={() => {
                      if (!pending) setConfirmation(undefined)
                    }}
                    footer={
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={pending}
                          data-modal-autofocus
                          onClick={() => setConfirmation(undefined)}
                        >
                          {copy.cancel}
                        </Button>
                        <Button
                          type="button"
                          variant="primary"
                          disabled={pending}
                          onClick={() => {
                            void submit()
                          }}
                        >
                          {pending ? copy.pending : copy.confirm}
                        </Button>
                      </>
                    }
                  >
                    <strong>
                      {copy[confirmation.action]}
                      {confirmation.action === 'merge' &&
                        ` · ${confirmation.strategy === 'merge' ? copy.merge_commit : copy[confirmation.strategy!]}`}
                    </strong>
                    <p>
                      <a href={confirmation.requestUrl} target="_blank" rel="noopener noreferrer">
                        {confirmation.requestUrl}
                      </a>
                      <br />
                      {item.source} → {item.target}
                    </p>
                    <code>{confirmation.headSha}</code>
                    {confirmation.body && <pre>{confirmation.body}</pre>}
                  </Modal>
                )}
              </article>
            ) : (
              <p role="status">{copy.empty}</p>
            ))}
        </div>
        {item && (
          <footer className="dsh-pr-merge-footer">
            {mergeBlockedReason && (
              <p id={`${tabsId}-merge-reason`} role="status">
                {mergeBlockedReason}
              </p>
            )}
            <Menu
              open={strategyOpen && canMerge}
              portal
              compact
              side="top"
              minWidthFromAnchor
              className="dsh-pr-merge-menu"
              selectedId={strategy}
              items={strategies}
              onClose={() => setStrategyOpen(false)}
              onSelect={(id) => {
                if (canMerge && strategies.some((option) => option.id === id)) setStrategy(id as Strategy)
                setStrategyOpen(false)
              }}
              anchor={
                <div className="dsh-pr-merge-button">
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!canMerge}
                    aria-describedby={mergeBlockedReason ? `${tabsId}-merge-reason` : undefined}
                    onClick={() => prepare('merge')}
                  >
                    {copy.merge}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    aria-label={copy.strategy}
                    aria-describedby={mergeBlockedReason ? `${tabsId}-merge-reason` : undefined}
                    aria-haspopup="menu"
                    aria-expanded={strategyOpen && canMerge}
                    disabled={!canMerge}
                    onClick={() => setStrategyOpen(!strategyOpen)}
                  >
                    <IconChevronDownOutlineRegular aria-hidden="true" />
                  </Button>
                </div>
              }
            />
          </footer>
        )}
        {(error === 'cli_missing' || error === 'command_failed') && (
          <footer>
            <p>{copy.hint}</p>
          </footer>
        )}
      </section>
    )
  }

  ctx.effect(() =>
    ctx.sidebarRightTabs.register({
      id: name,
      kind: name,
      title: () => text().title,
      guide: [
        {
          id: 'requests',
          order: 30,
          title: () => text().title,
          description: () => text().description,
          icon: IconBranchOutlineRegular,
        },
      ],
    })
  )
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({ name: 'conversation.input.dock', id: `${name}-links` }, Links)
  )
  ctx.slots.inject('sidebar.workspaces.session.row.action', () =>
    ctx.slots.register({ name: 'sidebar.workspaces.session.row.action', id: `${name}-status` }, SessionRequest)
  )
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: name }, Requests)
  )
  function Title() {
    useSyncExternalStore(subscribe, () => ctx.locale.getSnapshot().active)
    return <span>{text().title}</span>
  }
  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: name }, Title)
  )
}
