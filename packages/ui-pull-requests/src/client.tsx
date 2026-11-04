import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { CodeBlock, IconBranchOutlineRegular, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { actionMethod, channel, method, type RequestAction, type RequestView } from './protocol.js'
import { styles } from './styles.js'

export const name = 'dungsil-ui-pull-requests'
export const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs']

type ReviewAction = Exclude<RequestAction['action'], 'merge'>
type Strategy = NonNullable<RequestAction['strategy']>

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const subscribe = (listener: () => void) => ctx.locale.subscribe(listener)
  const text = () => {
    const language = ctx.locale.getSnapshot().active
    return language.startsWith('ko') ? ko : language.startsWith('zh') ? zh : en
  }

  function Requests({ sessionId, useTabInfo, useSession }: PropsRuntime<'sidebar.right.pane.tab'>) {
    useSyncExternalStore(subscribe, () => ctx.locale.getSnapshot().active)
    const copy = text()
    const { tab } = useTabInfo()
    const running = useSession((session) => session.running)
    const [view, setView] = useState<RequestView>()
    const [error, setError] = useState<keyof typeof en>()
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState<'overview' | 'changes' | 'conversation'>('overview')
    const [body, setBody] = useState('')
    const [reviewAction, setReviewAction] = useState<ReviewAction>('comment')
    const [strategy, setStrategy] = useState<Strategy>('squash')
    const [confirmation, setConfirmation] = useState<RequestAction>()
    const [notice, setNotice] = useState<'completed' | 'action_failed' | 'stale_request'>()
    const [pending, setPending] = useState(false)
    const submitting = useRef(false)
    const active = useRef<AbortController | null>(null)
    const confirmationElement = useRef<HTMLElement | null>(null)
    const item = view?.request
    const labels = useMemo(
      () => ({ code: { copyLabel: copy.copy, copiedLabel: copy.copied }, footnotes: copy.footnotes }),
      [copy]
    )
    const canReview =
      !!item &&
      item.state === 'open' &&
      !!item.headSha &&
      !item.detailsError &&
      !loading &&
      !pending &&
      !error &&
      !notice
    const canMerge =
      canReview &&
      !item?.draft &&
      !!item?.diff &&
      !item?.diffTruncated &&
      ['MERGEABLE', 'mergeable', 'can_be_merged'].includes(item?.mergeable ?? '') &&
      ['', 'APPROVED'].includes(item?.reviewDecision ?? '') &&
      item?.checks.every((check) => ['success', 'passed', 'neutral', 'skipped'].includes(check.status.toLowerCase()))

    const load = async () => {
      if (submitting.current) return
      active.current?.abort()
      const controller = new AbortController()
      active.current = controller
      const signal = AbortSignal.any([controller.signal, tab.signal])
      setLoading(true)
      setError(undefined)
      setConfirmation(undefined)
      setNotice(undefined)
      try {
        const result = await connection.rpc.call(channel, method, { sessionId }, signal)
        signal.throwIfAborted()
        if (!result.ok) throw result.error
        setView(result.value as RequestView)
      } catch (cause) {
        if (signal.aborted) return
        const code = (cause as { code?: string } | null)?.code
        setError(
          code && ['repository', 'unsupported', 'cli_missing', 'command_failed', 'invalid_response'].includes(code)
            ? (code as keyof typeof en)
            : 'unavailable'
        )
      } finally {
        if (!signal.aborted) setLoading(false)
      }
    }

    useEffect(() => {
      setView(undefined)
      setBody('')
      setConfirmation(undefined)
      setNotice(undefined)
      setPage('overview')
    }, [sessionId])

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
    }, [sessionId, tab.visible, running])

    useEffect(() => {
      if (confirmation) confirmationElement.current?.scrollIntoView({ block: 'nearest' })
    }, [confirmation])

    const prepare = (action: RequestAction['action']) => {
      if (!item || !canReview || (action === 'merge' && !canMerge) || submitting.current) return
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
    const checkStatus = (value: string) => {
      const state = value.toLowerCase()
      if (['success', 'passed'].includes(state)) return { label: copy.success, kind: 'success', icon: '✓' }
      if (state === 'neutral') return { label: copy.neutral, kind: 'muted', icon: '−' }
      if (['failure', 'failed', 'error', 'timed_out', 'action_required', 'startup_failure', 'stale'].includes(state))
        return { label: copy.failure, kind: 'failure', icon: '×' }
      if (['skipped', 'cancelled', 'canceled'].includes(state))
        return { label: state === 'skipped' ? copy.skipped : copy.cancelled, kind: 'muted', icon: '−' }
      return { label: `${copy.pending_check} · ${value}`, kind: 'pending', icon: '◷' }
    }

    return (
      <section className="dsh-pr-panel" aria-label={copy.title}>
        <style>{styles}</style>
        <header>
          <div>
            <strong>{view ? (view.provider === 'github' ? 'GitHub' : 'GitLab') : copy.title}</strong>
            {view && (
              <>
                <span className="dsh-pr-repository">{view.repository}</span>
                <span className="dsh-pr-branch">
                  <IconBranchOutlineRegular aria-hidden="true" />
                  {view.branch || 'HEAD'}
                </span>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              void load()
            }}
            disabled={loading || pending}
            aria-label={copy.refresh}
            title={copy.refresh}
          >
            ↻
          </button>
        </header>
        <div className="dsh-pr-content" aria-busy={loading}>
          {loading && <p role="status">{copy.loading}</p>}
          {error && <p role="alert">{copy[error] as string}</p>}
          {notice && <p role={notice === 'completed' ? 'status' : 'alert'}>{copy[notice]}</p>}
          {view &&
            (item ? (
              <article className="dsh-pr-request">
                <a className="dsh-pr-summary" href={item.url} target="_blank" rel="noopener noreferrer">
                  <span className="dsh-pr-title">
                    {item.title}
                    <span aria-hidden="true">↗</span>
                  </span>
                  <span className="dsh-pr-meta">
                    {view.provider === 'github' ? '#' : '!'}
                    {item.number} · {item.author}
                    <span className="dsh-pr-status">
                      {item.state === 'open' && item.draft ? copy.draft : copy[item.state]}
                    </span>
                  </span>
                  <span className="dsh-pr-refs">
                    {item.source} → {item.target}
                  </span>
                </a>
                <nav className="dsh-pr-tabs" aria-label={copy.title}>
                  {(['overview', 'changes', 'conversation'] as const).map((key) => (
                    <button key={key} type="button" aria-pressed={page === key} onClick={() => setPage(key)}>
                      {copy[key]}
                      {key === 'changes' ? ` (${item.files.length})` : ''}
                    </button>
                  ))}
                </nav>
                {item.detailsError && (
                  <p className="dsh-pr-warning" role="alert">
                    {copy.details_error}
                  </p>
                )}
                {page === 'overview' && (
                  <>
                    <section className="dsh-pr-section dsh-pr-description" aria-label={copy.body} tabIndex={0}>
                      <h3>{copy.body}</h3>
                      <MarkdownText text={item.body || copy.no_body} labels={labels} variant="compact" />
                    </section>
                    <section className="dsh-pr-section" aria-label={copy.checks}>
                      <h3>
                        {copy.checks} <span>{item.checks.length}</span>
                      </h3>
                      {!item.checks.length && !item.detailsError && <p>{copy.no_checks}</p>}
                      <ul className="dsh-pr-checks">
                        {item.checks.map((check, index) => {
                          const status = checkStatus(check.status)
                          return (
                            <li key={`${check.name}-${index}`}>
                              <span className={`dsh-pr-check-icon ${status.kind}`} aria-hidden="true">
                                {status.icon}
                              </span>
                              <span className="dsh-pr-check-name">
                                {check.url ? (
                                  <a href={check.url} target="_blank" rel="noopener noreferrer">
                                    {check.name} ↗
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
                    </section>
                    <section className="dsh-pr-section" aria-label={copy.merge}>
                      <h3>{item.state === 'merged' ? copy.merged : copy.merge}</h3>
                      <dl className="dsh-pr-facts">
                        <dt>{copy.mergeable}</dt>
                        <dd>{item.mergeable || '—'}</dd>
                        <dt>{copy.review_decision}</dt>
                        <dd>{item.reviewDecision || '—'}</dd>
                        <dt>{copy.commit}</dt>
                        <dd>
                          <code>{item.headSha.slice(0, 12) || '—'}</code>
                        </dd>
                      </dl>
                      <p>{copy.merge_hint}</p>
                      <div className="dsh-pr-actions">
                        <select
                          aria-label={copy.strategy}
                          value={strategy}
                          disabled={!canMerge || !!confirmation}
                          onChange={(event) => setStrategy(event.target.value as Strategy)}
                        >
                          <option value="squash">{copy.squash}</option>
                          <option value="merge">{copy.merge_commit}</option>
                          {view.provider === 'github' && <option value="rebase">{copy.rebase}</option>}
                        </select>
                        <button type="button" disabled={!canMerge || !!confirmation} onClick={() => prepare('merge')}>
                          {copy.merge}
                        </button>
                      </div>
                      {item.diffTruncated && <p className="dsh-pr-warning">{copy.diff_truncated}</p>}
                    </section>
                  </>
                )}
                {page === 'changes' && (
                  <section className="dsh-pr-section" aria-label={copy.changes}>
                    <h3>{copy.files}</h3>
                    <ul className="dsh-pr-files">
                      {item.files.map((file, index) => (
                        <li key={`${file.path}-${index}`}>
                          <code>{file.path}</code>
                          <span>
                            +{file.additions} −{file.deletions}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <details open className="dsh-pr-diff">
                      <summary>{copy.diff}</summary>
                      {item.diff ? (
                        <CodeBlock code={item.diff} lang="diff" copyLabel={copy.copy} copiedLabel={copy.copied} />
                      ) : (
                        <p>{copy.no_diff}</p>
                      )}
                    </details>
                    {item.diffTruncated && <p className="dsh-pr-warning">{copy.diff_truncated}</p>}
                  </section>
                )}
                {page === 'conversation' && (
                  <section className="dsh-pr-section" aria-label={copy.conversation}>
                    {!item.detailsError && !item.comments.length && !item.reviews.length && (
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
                          disabled={pending || !!confirmation}
                          onChange={(event) => setBody(event.target.value)}
                        />
                      </label>
                      <div className="dsh-pr-actions">
                        <select
                          aria-label={copy.review}
                          value={reviewAction}
                          disabled={pending || !!confirmation}
                          onChange={(event) => setReviewAction(event.target.value as ReviewAction)}
                        >
                          <option value="comment">{copy.comment}</option>
                          <option value="approve" disabled={item.draft || item.diffTruncated || !item.diff}>
                            {copy.approve}
                          </option>
                          {view.provider === 'github' && (
                            <option value="request_changes">{copy.request_changes}</option>
                          )}
                        </select>
                        <button
                          type="submit"
                          disabled={
                            !canReview ||
                            !!confirmation ||
                            (reviewAction !== 'approve' && !body.trim()) ||
                            (view.provider === 'gitlab' && reviewAction === 'approve' && !!body.trim()) ||
                            (reviewAction === 'approve' && (item.draft || item.diffTruncated || !item.diff))
                          }
                        >
                          {copy.submit}
                        </button>
                      </div>
                    </form>
                  </section>
                )}
                {confirmation && (
                  <section ref={confirmationElement} className="dsh-pr-confirm" role="region" aria-label={copy.confirm}>
                    <h3>{copy.confirm}</h3>
                    <p>{copy.confirm_hint}</p>
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
                    <div className="dsh-pr-actions">
                      <button type="button" disabled={pending} onClick={() => setConfirmation(undefined)}>
                        {copy.cancel}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          void submit()
                        }}
                      >
                        {pending ? copy.pending : copy.confirm}
                      </button>
                    </div>
                  </section>
                )}
              </article>
            ) : (
              <p role="status">{copy.empty}</p>
            ))}
        </div>
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
