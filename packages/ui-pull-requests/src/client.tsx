import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconBranchOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { channel, method, type RequestView } from './protocol.js'
import { styles } from './styles.js'

export const name = 'dungsil-ui-pull-requests'
export const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs']

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
    const active = useRef<AbortController | null>(null)
    const item = view?.request

    const load = async () => {
      active.current?.abort()
      const controller = new AbortController()
      active.current = controller
      const signal = AbortSignal.any([controller.signal, tab.signal])
      setLoading(true)
      setView(undefined)
      setError(undefined)
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
            disabled={loading}
            aria-label={copy.refresh}
            title={copy.refresh}
          >
            ↻
          </button>
        </header>
        <div className="dsh-pr-content" aria-busy={loading}>
          {loading && <p role="status">{copy.loading}</p>}
          {error && <p role="alert">{copy[error] as string}</p>}
          {view &&
            (item ? (
              <article className="dsh-pr-request">
                <a href={item.url} target="_blank" rel="noopener noreferrer">
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
              </article>
            ) : (
              <p role="status">{copy.empty}</p>
            ))}
        </div>
        <footer>
          <p>{copy.hint}</p>
        </footer>
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
