import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Button,
  CodeBlock,
  MarkdownText,
  Menu,
  Modal,
  SegmentedTabs,
  StateDot,
  Tag,
  type StateDotState,
} from '@dungsil/dsh-ui'
import {
  IconBranchOutlineRegular,
  IconChevronDownOutlineRegular,
  IconLinkOutlineRegular,
  IconRefreshOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { splitMarkdownSections, type MarkdownSection } from './markdown-sections.js'
import { actionMethod, channel, method, type RequestAction, type RequestView } from './pull-requests-protocol.js'
import { styles } from './pull-requests-styles.js'

export const name = 'dungsil-vcs-pull-requests'
export const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs']

type ReviewAction = Exclude<RequestAction['action'], 'merge'>
type Strategy = NonNullable<RequestAction['strategy']>

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

function Choice<Value extends string>({
  label,
  value,
  items,
  onChange,
  disabled,
}: {
  label: string
  value: Value
  items: readonly { id: Value; label: string; disabled?: boolean }[]
  onChange: (value: Value) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  return (
    <Menu
      open={open}
      portal
      compact
      className="dsh-pr-choice"
      selectedId={value}
      items={items}
      onClose={() => setOpen(false)}
      onSelect={(id) => {
        const item = items.find((item) => item.id === id && !item.disabled)
        if (item) onChange(item.id)
        setOpen(false)
      }}
      anchor={
        <Button
          type="button"
          size="sm"
          className="dsh-pr-picker"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen(!open)}
        >
          <span>{items.find((item) => item.id === value)?.label}</span>
          <IconChevronDownOutlineRegular aria-hidden="true" />
        </Button>
      }
    />
  )
}

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
      item.state === 'open' &&
      !!item.headSha &&
      !item.detailsError &&
      !loading &&
      !pending &&
      !error &&
      !notice
    const mergeBlockedReason = (() => {
      if (loading) return copy.loading
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
        const result = await connection.rpc.call(channel, method, { sessionId }, signal)
        signal.throwIfAborted()
        if (!result.ok) throw result.error
        setView(result.value as RequestView)
      } catch (cause) {
        if (signal.aborted) return
        const code = (cause as { code?: string } | null)?.code
        setError(
          code && ['repository', 'unsupported', 'cli_missing', 'command_failed', 'invalid_response'].includes(code)
            ? (code as Exclude<keyof typeof en, 'meta'>)
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
      setStrategy('squash')
      setStrategyOpen(false)
      setChecksOpen(false)
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
    const checksState: StateDotState =
      checkStates.some((state) => state === 'error') ||
      item?.checks.some((check) => ['cancelled', 'canceled'].includes(check.status.toLowerCase()))
        ? 'error'
        : item?.detailsError || !checkStates.length
          ? 'warning'
          : checkStates.some((state) => state === 'ongoing')
            ? 'ongoing'
            : checkStates.every((state) => state === 'done')
              ? 'done'
              : 'idle'
    const checksLabel = {
      done: copy.success,
      error: copy.failure,
      warning: copy.checks_unknown,
      ongoing: copy.pending_check,
      idle: copy.checks_complete,
    }[checksState]
    const checksSummary = copy.checks_summary
      .replace('{passed}', String(checkStates.filter((state) => state === 'done').length))
      .replace('{total}', String(checkStates.length))
    const strategies = [
      { id: 'squash', label: copy.squash },
      { id: 'merge', label: copy.merge_commit },
      ...(view?.provider === 'github' ? [{ id: 'rebase', label: copy.rebase }] : []),
    ]

    return (
      <section className="dsh-pr-panel" aria-label={copy.title}>
        <style>{styles}</style>
        <header>
          <div>
            <strong>{view ? (view.provider === 'github' ? 'GitHub' : 'GitLab') : copy.title}</strong>
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
            aria-label={copy.refresh}
            title={copy.refresh}
          >
            <IconRefreshOutlineRegular aria-hidden="true" />
          </Button>
        </header>
        <div ref={content} className="dsh-pr-content" aria-busy={loading}>
          {loading && <p role="status">{copy.loading}</p>}
          {error && <p role="alert">{copy[error] as string}</p>}
          {notice && <p role={notice === 'completed' ? 'status' : 'alert'}>{copy[notice]}</p>}
          {view &&
            (item ? (
              <article className="dsh-pr-request">
                <div className="dsh-pr-summary">
                  <h2 className="dsh-pr-title">
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title}{' '}
                      <span className="dsh-pr-number">
                        {view.provider === 'github' ? '#' : '!'}
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
                      aria-label={`${copy.checks}: ${checksSummary} · ${checksLabel}`}
                      aria-expanded={checksOpen}
                      aria-controls={`${tabsId}-checks`}
                      title={`${copy.checks}: ${checksLabel}`}
                      onClick={() => setChecksOpen(!checksOpen)}
                    >
                      <StateDot state={checksState} appearance="step" />
                      <span>{checksSummary}</span>
                      <IconChevronDownOutlineRegular aria-hidden="true" />
                    </Button>
                  </div>
                  {checksOpen && (
                    <div id={`${tabsId}-checks`} className="dsh-pr-ci-results" role="region" aria-label={copy.checks}>
                      {!item.checks.length && !item.detailsError && <p>{copy.no_checks}</p>}
                      <ul className="dsh-pr-checks">
                        {item.checks.map((check, index) => {
                          const status = checkStatus(check.status)
                          return (
                            <li key={`${check.name}-${index}`}>
                              <StateDot state={status.state} appearance="step" />
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
                        label: `${copy.changes} (${item.files.length})`,
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
                <div role="tabpanel" id={`${tabsId}-${page}-panel`} aria-labelledby={`${tabsId}-${page}`} tabIndex={0}>
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
                        {copy.files} <Tag tone="neutral">{item.files.length}</Tag>
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
                            disabled={pending}
                            onChange={(event) => setBody(event.target.value)}
                          />
                        </label>
                        <div className="dsh-pr-actions">
                          <Choice
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
                              ...(view.provider === 'github'
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
