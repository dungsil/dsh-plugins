import { useEffect, useId, useMemo, useRef, useState, type ComponentProps } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, ButtonPicker, MarkdownText, SegmentedTabs, Tag } from '@dungsil/dsh-ui'
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import {
  IconBranchOutlineRegular,
  IconChevronDownOutlineRegular,
  IconLinkOutlineRegular,
  IconLoadingOutlineRegular,
  IconRefreshOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { splitMarkdownSections, type MarkdownSection } from './markdown-sections.js'
import { actionMethod, channel, method, type MergeMethod, type RequestAction, type RequestView } from './protocol.js'
import { styles } from './pull-requests-styles.js'
import { bindPullRequestLinks, pullRequestUrl } from './pull-request-links.js'

export const name = 'dungsil-forge-pulls'
export const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs', 'sidebarRight']

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dungsil-forge-pulls': { requestUrl?: string }
  }
}

type ReviewAction = Exclude<RequestAction['action'], 'merge'>

const providerNames: Record<RequestView['provider'], string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  forgejo: 'Forgejo',
}

function Loading({ label }: { label: string }) {
  return (
    <span className="dsh-forge-pulls-loading" role="status" aria-label={label}>
      <IconLoadingOutlineRegular aria-hidden="true" />
    </span>
  )
}

function Description({ text, labels }: Pick<ComponentProps<typeof MarkdownText>, 'text' | 'labels'>) {
  const { introduction, sections, definitions } = useMemo(() => splitMarkdownSections(text), [text])
  const render = (items: MarkdownSection[]) =>
    items.map((section, index) => (
      <details key={index} className="dsh-forge-pulls-heading" open={section === sections[0]}>
        <summary>
          <IconChevronDownOutlineRegular aria-hidden="true" />
          <MarkdownText text={`${section.heading}\n\n${definitions}`} labels={labels} variant="compact" />
        </summary>
        <div className="dsh-forge-pulls-heading-content">
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
  const views = new Map<string, RequestView>()
  ctx.effect(() => () => views.clear())
  ctx.effect(() => installStyles(styles), 'ui-forge-pulls: pull request styles')
  const copyFor = (language: string) => localizedCopy({ en, ko, zh }, language)

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
    const { active: language } = useLocaleSnapshot(ctx.locale)
    const copy = copyFor(language)
    const { tab } = useTabInfo()
    const params = tab.navigation.params as { requestUrl?: unknown } | undefined
    const requestUrl = typeof params?.requestUrl === 'string' ? pullRequestUrl(params.requestUrl) : undefined
    const cacheKey = JSON.stringify([sessionId, requestUrl])
    const running = useSession((session) => session.running)
    const [view, setView] = useState<RequestView | undefined>(() => views.get(cacheKey))
    const [error, setError] = useState<Exclude<keyof typeof en, 'meta'>>()
    const [loading, setLoading] = useState(true)
    const [page, setPage] = useState<'overview' | 'conversation' | 'changes'>('overview')
    const [body, setBody] = useState('')
    const [reviewAction, setReviewAction] = useState<ReviewAction>('comment')
    const [strategy, setStrategy] = useState<MergeMethod>('merge')
    const [notice, setNotice] = useState<'completed' | 'action_failed' | 'stale_request'>()
    const [pending, setPending] = useState(false)
    const submitting = useRef(false)
    const active = useRef<AbortController | null>(null)
    const content = useRef<HTMLDivElement | null>(null)
    const tabsId = useId()
    const item = view?.request
    const selectedStrategy = item?.mergeMethods?.includes(strategy) ? strategy : (item?.mergeMethods?.[0] ?? strategy)
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

    const load = async (options?: { keepNotice?: boolean }) => {
      if (submitting.current) return
      active.current?.abort()
      const controller = new AbortController()
      active.current = controller
      const signal = AbortSignal.any([controller.signal, tab.signal])
      setLoading(true)
      setError(undefined)
      if (!options?.keepNotice) setNotice(undefined)
      try {
        // A cached snapshot is display-only while the fresh, full read is in flight.
        // On first open, show the description without waiting for the discussion.
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
        // The action's notice clears only after the fresh read confirms the remote state.
        if (options?.keepNotice) setNotice(undefined)
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
      setNotice(undefined)
      setPage('overview')
    }, [sessionId, requestUrl])

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

    const submit = async (action: ReviewAction) => {
      if (!item || !canReview || submitting.current) return
      if (
        (action !== 'approve' && !body.trim()) ||
        (view?.provider === 'gitlab' && action === 'approve' && !!body.trim()) ||
        (action === 'approve' && (item.draft || !item.changes?.complete))
      )
        return
      const payload: RequestAction = {
        sessionId,
        requestUrl: item.url,
        headSha: item.headSha,
        action,
        body: body.trim(),
      }
      setNotice(undefined)
      submitting.current = true
      setPending(true)
      active.current?.abort()
      setLoading(false)
      let completed = false
      try {
        const result = await connection.rpc.call(channel, actionMethod, payload, tab.signal)
        if (!result.ok) throw result.error
        setBody('')
        setNotice('completed')
        completed = true
      } catch (cause) {
        setNotice((cause as { code?: string } | null)?.code === 'stale_request' ? 'stale_request' : 'action_failed')
      } finally {
        // A lost response may follow a successful write. Never automatically retry a mutation.
        submitting.current = false
        setPending(false)
        // A completed action is followed by one read; the write is never retried.
        if (completed) void load({ keepNotice: true })
      }
    }

    const merge = async () => {
      if (
        !item ||
        !view ||
        view.provider !== 'github' ||
        !canReview ||
        item.draft ||
        !view.checkoutBranch ||
        !item.mergeMethods?.includes(selectedStrategy) ||
        submitting.current
      )
        return
      submitting.current = true
      setPending(true)
      active.current?.abort()
      let completed = false
      try {
        const result = await connection.rpc.call(
          channel,
          actionMethod,
          {
            sessionId,
            requestUrl: item.url,
            headSha: item.headSha,
            branch: view.checkoutBranch,
            target: item.target,
            action: 'merge',
            strategy: selectedStrategy,
          } satisfies RequestAction,
          tab.signal
        )
        if (!result.ok) throw result.error
        setNotice('completed')
        completed = true
      } catch (cause) {
        setNotice((cause as { code?: string } | null)?.code === 'stale_request' ? 'stale_request' : 'action_failed')
      } finally {
        submitting.current = false
        setPending(false)
        // A completed action is followed by one read; the write is never retried.
        if (completed) void load({ keepNotice: true })
      }
    }

    return (
      <section className="dsh-forge-pulls-panel" aria-label={copy.title}>
        <header>
          <div>
            <strong>{view ? providerNames[view.provider] : copy.title}</strong>
            {view && (
              <>
                <span className="dsh-forge-pulls-repository" title={view.repository}>
                  {view.repository}
                </span>
                {!item && (
                  <span className="dsh-forge-pulls-branch">
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
            className="dsh-forge-pulls-refresh"
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
        <div ref={content} className="dsh-forge-pulls-content" aria-busy={loading}>
          {loading && !view && (
            <div className="dsh-forge-pulls-initial-loading">
              <Loading label={copy.loading} />
            </div>
          )}
          {error && (
            <p role="alert" className="dsh-forge-pulls-section">
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
              <article className="dsh-forge-pulls-request">
                <div className="dsh-forge-pulls-summary">
                  <h2 className="dsh-forge-pulls-title">
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      {item.title}{' '}
                      <span className="dsh-forge-pulls-number">
                        {view.provider === 'gitlab' ? '!' : '#'}
                        {item.number}
                      </span>
                      <IconLinkOutlineRegular aria-hidden="true" />
                    </a>
                  </h2>
                  <div className="dsh-forge-pulls-meta">
                    <Tag
                      className="dsh-forge-pulls-status"
                      tone={item.state === 'open' && !item.draft ? 'success' : 'neutral'}
                    >
                      {item.state === 'open' && item.draft ? copy.draft : copy[item.state]}
                    </Tag>
                    <span className="dsh-forge-pulls-refs" title={`${item.source} → ${item.target}`}>
                      <IconBranchOutlineRegular aria-hidden="true" />
                      <code>{item.source}</code>
                      <span aria-hidden="true">→</span>
                      <code>{item.target}</code>
                    </span>
                  </div>
                </div>
                {view.provider === 'github' && (
                  <section className="dsh-forge-pulls-section" aria-label={copy.merge_title}>
                    <h3>{copy.merge_title}</h3>
                    <p>{copy.merge_hint}</p>
                    {!loading &&
                      !error &&
                      item.state === 'open' &&
                      !item.draft &&
                      !item.detailsError &&
                      (!item.mergeMethods?.length || !view.checkoutBranch) && <p>{copy.merge_unavailable}</p>}
                    <div className="dsh-forge-pulls-actions">
                      <ButtonPicker
                        size="sm"
                        className="dsh-forge-pulls-picker dsh-forge-pulls-merge-picker"
                        menuClassName="dsh-forge-pulls-choice"
                        compact
                        label={copy.merge_title}
                        value={selectedStrategy}
                        disabled={pending}
                        onChange={setStrategy}
                        items={[
                          { id: 'merge', label: copy.merge_commit, disabled: !item.mergeMethods?.includes('merge') },
                          { id: 'squash', label: copy.merge_squash, disabled: !item.mergeMethods?.includes('squash') },
                          { id: 'rebase', label: copy.merge_rebase, disabled: !item.mergeMethods?.includes('rebase') },
                        ]}
                      />
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={
                          !canReview ||
                          item.draft ||
                          !view.checkoutBranch ||
                          !item.mergeMethods?.includes(selectedStrategy)
                        }
                        onClick={() => void merge()}
                      >
                        {pending ? copy.pending : copy.merge_title}
                      </Button>
                    </div>
                  </section>
                )}
                <div className="dsh-forge-pulls-tabs">
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
                        value: 'conversation',
                        label: copy.conversation,
                        id: `${tabsId}-conversation`,
                        panelId: `${tabsId}-conversation-panel`,
                      },
                      {
                        value: 'changes',
                        label: copy.changes,
                        id: `${tabsId}-changes`,
                        panelId: `${tabsId}-changes-panel`,
                      },
                    ]}
                  />
                </div>
                {item.detailsError && (
                  <p className="dsh-forge-pulls-warning" role="alert">
                    {copy.details_error}
                  </p>
                )}
                {!loading && !item.changes?.complete && (
                  <p className="dsh-forge-pulls-warning" role="alert">
                    {copy.changes_incomplete}
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
                      <section className="dsh-forge-pulls-section dsh-forge-pulls-description" aria-label={copy.body}>
                        <h3>{copy.body}</h3>
                        <Description key={item.body} text={item.body || copy.no_body} labels={labels} />
                      </section>
                    </>
                  )}
                  {page === 'changes' && (
                    <section className="dsh-forge-pulls-section" aria-label={copy.changes}>
                      <h3>
                        {copy.changes} {loading && <Loading label={copy.loading} />}
                      </h3>
                      {!loading && !item.detailsError && item.changes?.complete && (
                        <>
                          {!item.changes.files.length && <p>{copy.no_changes}</p>}
                          <ul>
                            {item.changes.files.map((file, index) => (
                              <li key={index}>
                                <code>{file.path}</code>
                              </li>
                            ))}
                          </ul>
                          {item.changes.diff && (
                            <pre className="dsh-forge-pulls-diff">
                              <code>{item.changes.diff}</code>
                            </pre>
                          )}
                        </>
                      )}
                    </section>
                  )}
                  {page === 'conversation' && (
                    <section className="dsh-forge-pulls-section" aria-label={copy.conversation}>
                      <h3>
                        {copy.conversation}
                        {loading && <Loading label={copy.loading} />}
                      </h3>
                      {!loading && !item.detailsError && !item.comments.length && !item.reviews.length && (
                        <p>{copy.no_conversation}</p>
                      )}
                      {item.comments.map((comment, index) => (
                        <article className="dsh-forge-pulls-comment" key={`comment-${index}`}>
                          <strong>{comment.author}</strong>
                          <MarkdownText text={comment.body} labels={labels} variant="compact" />
                        </article>
                      ))}
                      {item.reviews.map((review, index) => (
                        <article className="dsh-forge-pulls-comment" key={`review-${index}`}>
                          <strong>
                            {review.author} · {review.state}
                          </strong>
                          <MarkdownText text={review.body} labels={labels} variant="compact" />
                        </article>
                      ))}
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          void submit(reviewAction)
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
                        <div className="dsh-forge-pulls-actions">
                          <ButtonPicker
                            size="sm"
                            className="dsh-forge-pulls-picker"
                            menuClassName="dsh-forge-pulls-choice"
                            compact
                            label={copy.review}
                            value={reviewAction}
                            disabled={pending}
                            onChange={setReviewAction}
                            items={[
                              { id: 'comment', label: copy.comment },
                              { id: 'approve', label: copy.approve, disabled: item.draft || !item.changes?.complete },
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
                              (reviewAction === 'approve' && (item.draft || !item.changes?.complete))
                            }
                          >
                            {pending ? copy.pending : copy.submit}
                          </Button>
                        </div>
                      </form>
                    </section>
                  )}
                </div>
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
      title: () => copyFor(ctx.locale.getSnapshot().active).title,
      guide: [
        {
          id: 'requests',
          order: 30,
          title: () => copyFor(ctx.locale.getSnapshot().active).title,
          description: () => copyFor(ctx.locale.getSnapshot().active).description,
          icon: IconBranchOutlineRegular,
        },
      ],
    })
  )
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({ name: 'conversation.input.dock', id: `${name}-links`, order: 30 }, Links)
  )
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: name }, Requests)
  )
  function Title() {
    const { active } = useLocaleSnapshot(ctx.locale)
    return <span>{copyFor(active).title}</span>
  }
  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: name }, Title)
  )
}
