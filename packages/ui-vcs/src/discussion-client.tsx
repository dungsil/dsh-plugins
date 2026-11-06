import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, MarkdownText } from '@dungsil/dsh-ui'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import type { Discussion } from './discussion-read.js'

export const name = 'dungsil-vcs-discussion'
export const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs']
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'dungsil-vcs-discussion': Record<string, never>
  }
}

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const text = () => {
    const language = ctx.locale.getSnapshot().active
    return language.startsWith('en') ? en : language.startsWith('zh') ? zh : ko
  }
  function Reader({ sessionId }: PropsRuntime<'sidebar.right.pane.tab'>) {
    useSyncExternalStore(
      (listener) => ctx.locale.subscribe(listener),
      () => ctx.locale.getSnapshot().active
    )
    const labels = text()
    const [documents, setDocuments] = useState<Discussion[]>()
    const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
    const controller = useRef<AbortController | null>(null)
    useEffect(() => {
      setDocuments(undefined)
      setState('idle')
      return () => controller.current?.abort()
    }, [sessionId])
    const refresh = async () => {
      controller.current?.abort()
      const current = new AbortController()
      controller.current = current
      setState('loading')
      setDocuments(undefined)
      try {
        const response = await connection.rpc.call('/api', 'dungsil-vcs/discussion', { sessionId }, current.signal)
        if (current.signal.aborted) return
        if (!response.ok || !Array.isArray(response.value)) throw new Error('unavailable')
        setDocuments(response.value as Discussion[])
        setState('ready')
      } catch {
        if (!current.signal.aborted) setState('error')
      }
    }
    return (
      <section style={{ padding: 16, overflowWrap: 'anywhere' }}>
        <Button disabled={state === 'loading'} onClick={() => void refresh()}>
          {labels.refresh}
        </Button>
        <p role="status">
          {state === 'loading'
            ? labels.loading
            : state === 'error'
              ? labels.unavailable
              : state === 'idle'
                ? labels.discussion_hint
                : documents?.length
                  ? ''
                  : labels.empty}
        </p>
        {documents?.map((document) => (
          <article key={document.url}>
            <a href={document.url} target="_blank" rel="noreferrer">
              {document.url}
            </a>
            <h3>{labels.body}</h3>
            <MarkdownText
              text={document.body || labels.no_body}
              labels={{ code: { copyLabel: labels.copy, copiedLabel: labels.copied }, footnotes: labels.footnotes }}
            />
            <h3>{labels.conversation}</h3>
            {!document.entries.length && <p>{labels.no_conversation}</p>}
            {document.entries.map((entry, index) => (
              <section key={index}>
                <h4>
                  {entry.author} · {entry.kind === 'review' ? labels.review : labels.comment}
                </h4>
                <MarkdownText
                  text={entry.body}
                  labels={{ code: { copyLabel: labels.copy, copiedLabel: labels.copied }, footnotes: labels.footnotes }}
                />
              </section>
            ))}
          </article>
        ))}
      </section>
    )
  }
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: name, kind: name, title: () => text().discussion_title }))
  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab', key: name }, (props) => (
      <Reader key={props.sessionId} {...props} />
    ))
  )
  function Title() {
    useSyncExternalStore(
      (listener) => ctx.locale.subscribe(listener),
      () => ctx.locale.getSnapshot().active
    )
    return <span>{text().discussion_title}</span>
  }
  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: name }, Title)
  )
}
