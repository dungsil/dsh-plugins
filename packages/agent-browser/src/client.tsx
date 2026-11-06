import { useEffect, useId, useState, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { SegmentedControl, StateDot } from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { IconGlobeOutlineRegular } from '@dungsil/dsh-ui/icons'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { name, method, type BrowserView } from './protocol.js'

export { name }
export const inject = ['slots', 'locale', 'connection']

const browserSlot = 'sidebar.right.pane.tab'
const browserId = '@deepseek-ai/dsh-client-ui-sidebar-browser'
type BrowserProps = PropsRuntime<typeof browserSlot>

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const text = () => {
    const language = ctx.locale.getSnapshot().active
    return language.startsWith('ko') ? ko : language.startsWith('zh') ? zh : en
  }

  function Browser({ Native, ...props }: BrowserProps & { Native: ComponentType<BrowserProps> }) {
    const { sessionId } = props
    useLocaleSnapshot(ctx.locale)
    const copy = text()
    const id = useId()
    const [selection, setSelection] = useState<'auto' | 'manual' | 'agent'>('auto')
    const [view, setView] = useState<BrowserView>({ status: 'idle', sequence: 0 })
    const [disconnected, setDisconnected] = useState(false)
    const selected = selection === 'auto' ? (view.status === 'idle' ? 'manual' : 'agent') : selection
    useEffect(() => {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout>
      let sequence = -1
      const refresh = async () => {
        try {
          const result = await connection.rpc.call('/api', method, { sessionId, sequence }, controller.signal)
          if (controller.signal.aborted) return
          if (!result.ok) throw new Error('Browser view unavailable')
          const next = result.value as BrowserView
          sequence = next.sequence
          setView((previous) => ({
            ...next,
            image: next.image ?? (next.status === 'live' ? previous.image : undefined),
          }))
          setDisconnected(false)
        } catch {
          if (controller.signal.aborted) return
          setDisconnected(true)
          setView({ status: 'error', sequence: 0 })
          sequence = -1
        }
        if (!controller.signal.aborted) timer = setTimeout(refresh, document.hidden ? 2000 : 250)
      }
      void refresh()
      return () => {
        controller.abort()
        clearTimeout(timer)
      }
    }, [sessionId])

    return (
      <div className="dsh-agent-browser-host">
        <div className="dsh-agent-browser-selector">
          <SegmentedControl
            id={id}
            value={selected}
            options={[
              { value: 'manual', label: copy.manual },
              { value: 'agent', label: copy.agent },
            ]}
            onChange={setSelection}
            label={copy.title}
          />
        </div>
        <div
          className="dsh-agent-browser-pane"
          id={`${id}-manual-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-manual`}
          hidden={selected !== 'manual'}
        >
          <Native {...props} />
        </div>
        <div
          className="dsh-agent-browser-pane"
          id={`${id}-agent-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-agent`}
          hidden={selected !== 'agent'}
        >
          <section className="dsh-agent-browser" aria-label={copy.title}>
            <header>
              <StateDot
                state={disconnected || view.status === 'error' ? 'error' : view.status === 'live' ? 'ongoing' : 'idle'}
              />
              <span role="status">{disconnected ? copy.connection_error : copy[view.status]}</span>
            </header>
            {view.command && (
              <div className="dsh-agent-browser-command">
                {copy.command}: <code>{view.command}</code>
              </div>
            )}
            {view.error && view.status === 'live' && (
              <p className="dsh-agent-browser-command" role="status">
                {copy[view.error]}
              </p>
            )}
            {view.image && view.status === 'live' ? (
              <div className="dsh-agent-browser-screen">
                <img src={`data:image/jpeg;base64,${view.image}`} alt={copy.screen} />
              </div>
            ) : (
              <div className="dsh-agent-browser-empty">
                <IconGlobeOutlineRegular aria-hidden="true" />
                <p>{view.error ? copy[view.error] : copy.description}</p>
                {(view.status === 'idle' || view.error === 'unavailable') && <p>{copy.hint}</p>}
              </div>
            )}
            <footer>{copy.readonly}</footer>
          </section>
        </div>
      </div>
    )
  }

  ctx.slots.inject(browserSlot, () => {
    let original: StoredEntry | undefined
    let dispose: (() => void) | undefined
    const sync = () => {
      const entry = ctx.slots
        .entries(browserSlot)
        .find((candidate) => candidate.options.key === browserId && (candidate.options.priority ?? 0) === 0)
      if (entry === original) return
      dispose?.()
      dispose = undefined
      original = entry
      if (!entry) return
      const Native = entry.component as ComponentType<BrowserProps>
      // Keep the shipped Browser tab, title, shortcuts, navigation, and persistence.
      // Only decorate its body; the native page remains mounted when showing the agent.
      dispose = ctx.slots.register(
        {
          name: browserSlot,
          key: browserId,
          priority: -100,
          store: entry.store,
          locale: entry.locale as 'sidebarBrowser',
          inject: entry.inject as (...args: unknown[]) => Record<string, unknown>,
        },
        (props) => <Browser key={props.sessionId} Native={Native} {...props} />
      )
    }
    const unsubscribe = ctx.slots.subscribe(browserSlot, sync)
    sync()
    return () => {
      unsubscribe()
      dispose?.()
    }
  })
  ctx.effect(() =>
    installStyles(`
.dsh-agent-browser-host { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.dsh-agent-browser-selector { padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-agent-browser-pane { flex: 1; min-height: 0; }
.dsh-agent-browser { display: flex; flex-direction: column; height: 100%; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-agent-browser header { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.dsh-agent-browser-command { padding: 8px 16px; color: var(--dsw-alias-label-secondary); }
.dsh-agent-browser-screen { flex: 1; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-layer-2); }
.dsh-agent-browser-screen img { display: block; width: 100%; height: auto; }
.dsh-agent-browser-empty { flex: 1; padding: 32px 20px; color: var(--dsw-alias-label-secondary); line-height: 1.6; overflow: auto; }
.dsh-agent-browser-empty > svg { width: 24px; height: 24px; }
.dsh-agent-browser footer { padding: 10px 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
`)
  )
}
