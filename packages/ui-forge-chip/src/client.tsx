import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-forge/remote'
import type {} from '@deepseek-ai/dsh-working-directory'
import type { ForgePanelState } from '@deepseek-ai/dsh-experimental-client-ui-forge/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Menu, Pill } from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { IconBranchOutlineRegular, IconChevronDownOutlineRegular } from '@dungsil/dsh-ui/icons'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import ja from '../locale/ja.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import de from '../locale/de.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }
import { primaryOperation, requestForCheckout, type Operation } from './model.js'
import { styles } from './styles.js'

export const name = 'dungsil-ui-forge-chip'
export const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.forgePanel', 'sidebarRight']

const translations: Record<string, typeof en> = { en, ko, zh, ja, es, fr, de, ru, pt }

export function apply(ctx: Context) {
  // The UI facade also brings legacy SessionStore declarations; use the 0.2.2 controller contract explicitly.
  const sessions = ctx.sessions as unknown as ISessions
  function Chip({ sessionId, useSession, useAccess, useProjection }: PropsRuntime<'conversation.input.dock'>) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = translations[active.toLowerCase().split(/[-_]/)[0]] ?? en
    const hidden = useSession((s) => s.blank || s.awaitingFirstTurn || s.removed || s.openState !== 'open')
    const unavailable = useSession(
      (s) => s.running || s.pendingSubmissions.length > 0 || s.removed || s.openState !== 'open'
    )
    const canPrompt = useAccess('session.prompt')
    const cwd = useProjection('workingDirectory')
    const [panel, setPanel] = useState<ForgePanelState>()
    const [facts, setFacts] = useState<{ panel: ForgePanelState; dirty: boolean; ahead: number | null }>()
    const [lookupError, setLookupError] = useState(false)
    const [error, setError] = useState(false)
    const [sending, setSending] = useState(false)
    const [open, setOpen] = useState(false)
    const [generation, setGeneration] = useState(0)
    const pending = useRef(false)
    const mounted = useRef(true)
    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])
    useEffect(() => {
      const dispose = ctx.on('connection/reset', () => setGeneration((n) => n + 1))
      return () => {
        dispose()
      }
    }, [])

    useEffect(() => {
      setPanel(undefined)
      setFacts(undefined)
      setLookupError(false)
      setOpen(false)
      if (hidden) return
      const controller = new AbortController()
      const stream = ctx.remote.forgePanel.follow(sessionId, controller.signal)
      void (async () => {
        try {
          for await (const state of stream) {
            if (controller.signal.aborted) return
            setPanel(state)
            setLookupError(false)
          }
          if (!controller.signal.aborted) setLookupError(true)
        } catch {
          if (!controller.signal.aborted) setLookupError(true)
        } finally {
          stream.dispose()
        }
      })()
      return () => {
        controller.abort()
        stream.dispose()
      }
    }, [sessionId, cwd, hidden, generation])

    useEffect(() => {
      setFacts(undefined)
      if (!panel || panel.checkout.state !== 'ready' || unavailable) return
      const controller = new AbortController()
      const request = requestForCheckout(panel)
      let sequence = 0
      const refresh = async () => {
        const current = ++sequence
        try {
          const local = await ctx.remote.forgePanel.localDiff(sessionId, { kind: 'uncommitted' }, controller.signal)
          const remote = request
            ? await ctx.remote.forgePanel.changeRequestDiff(sessionId, request.url, null, controller.signal)
            : undefined
          if (controller.signal.aborted || current !== sequence) return
          if (!local.ok) {
            setLookupError(true)
            return
          }
          setFacts({
            panel,
            dirty: local.value.files.length > 0 || local.value.omitted > 0,
            ahead: remote?.ok ? remote.value.localAhead : null,
          })
          setLookupError(false)
        } catch {
          if (!controller.signal.aborted && current === sequence) setLookupError(true)
        }
      }
      void refresh()
      const onFocus = () => {
        setFacts(undefined)
        void refresh()
      }
      window.addEventListener('focus', onFocus)
      return () => {
        controller.abort()
        window.removeEventListener('focus', onFocus)
      }
    }, [panel, sessionId, unavailable])

    const request = panel && requestForCheckout(panel)
    const fresh = facts?.panel === panel && facts !== undefined
    const viewOnly = !!request && fresh && !facts.dirty && facts.ahead === 0
    const disabled = !canPrompt || unavailable || sending || !fresh || lookupError
    useEffect(() => {
      if (disabled || viewOnly) setOpen(false)
    }, [disabled, viewOnly])
    const showPanel = () => ctx.sidebarRight.openTab('forge-panel')
    const send = async (operation: Operation) => {
      if (disabled || pending.current) return
      pending.current = true
      setSending(true)
      setOpen(false)
      setError(false)
      try {
        const conversation = sessions.scope(sessionId)?.get('conversation')
        if (!conversation) throw new Error('Session unavailable')
        await conversation.send({ commit: text.promptCommit, push: text.promptPush, pr: text.promptPr }[operation])
      } catch {
        if (mounted.current) setError(true)
      } finally {
        pending.current = false
        if (mounted.current) setSending(false)
      }
    }
    if (hidden || !panel || panel.checkout.state !== 'ready') return null
    const operation = primaryOperation(panel)
    const label = sending
      ? text.sending
      : viewOnly
        ? text.viewPr
        : operation === 'pr' && request
          ? text.updatePr
          : text[operation]
    const checks = request?.snapshot?.checksRollup ?? 'unknown'
    const stale = !!request?.update && 'error' in request.update
    return (
      <div className="dsh-forge-chip">
        <div className="dsh-forge-chip-actions">
          <Pill
            className="dsh-forge-chip-trigger"
            disabled={!viewOnly && disabled}
            title={viewOnly ? text.viewPr : text.hint}
            aria-busy={sending}
            onClick={() => {
              if (viewOnly) showPanel()
              else void send(operation)
            }}
          >
            <IconBranchOutlineRegular aria-hidden="true" />
            {label}
          </Pill>
          <Menu
            open={open}
            side="top"
            portal
            compact
            onClose={() => setOpen(false)}
            items={[
              { id: 'commit', label: text.commit },
              ...(panel.repository
                ? [
                    { id: 'push', label: text.push },
                    { id: 'pr', label: request ? text.updatePr : text.pr },
                  ]
                : []),
              { id: 'panel', label: text.panel },
            ]}
            onSelect={(id) => {
              setOpen(false)
              if (id === 'panel') showPanel()
              else void send(id as Operation)
            }}
            anchor={
              <Pill
                className="dsh-forge-chip-trigger dsh-forge-chip-menu"
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
        </div>
        {request && (
          <Pill className="dsh-forge-chip-trigger" onClick={showPanel}>
            {text.checks}: {stale ? text.unknown : text[checks]}
          </Pill>
        )}
        {lookupError && (
          <Pill className="dsh-forge-chip-trigger" onClick={showPanel}>
            {text.lookupError}
          </Pill>
        )}
        {error && <span role="alert">{text.error}</span>}
      </div>
    )
  }
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register({ name: 'conversation.input.dock', id: name, order: -100 }, (props) => (
      <Chip key={props.sessionId} {...props} />
    ))
  )
  ctx.effect(() => installStyles(styles), 'ui-forge-chip: composer styles')
}
