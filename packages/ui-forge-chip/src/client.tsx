import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
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
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
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
import { canCreatePr, requestForCheckout } from './model.js'
import { channel, methods, type ActionErrorCode, type DefaultAction } from './protocol.js'
import { styles } from './styles.js'

export const name = 'dungsil-ui-forge-chip'
export const inject = ['slots', 'locale', 'connection', 'remote', 'remote.forgePanel', 'sidebarRight']

const translations: Record<string, typeof en> = { en, ko, zh, ja, es, fr, de, ru, pt }
type Copy = Omit<typeof en, 'meta'>
type Busy = DefaultAction | 'pr'

const errorKeys: Record<ActionErrorCode, keyof Copy> = {
  unavailable: 'errorUnavailable',
  'nothing-to-commit': 'errorNothingToCommit',
  'message-failed': 'errorMessageFailed',
  'commit-failed': 'errorCommitFailed',
  'no-remote': 'errorNoRemote',
  'push-failed': 'errorPushFailed',
  'not-pushed': 'errorNotPushed',
  unsupported: 'errorUnsupported',
  'pr-failed': 'errorPrFailed',
}

export function apply(ctx: Context) {
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const call = async (method: string, payload: Record<string, unknown>, signal?: AbortSignal) => {
    const result = await connection.rpc.call(channel, method, payload, signal)
    if (!result.ok) throw Object.assign(new Error('rpc'), { code: (result.error as { code?: string }).code })
    return result.value
  }

  function Chip({ sessionId, useSession, useAccess, useProjection }: PropsRuntime<'conversation.input.dock'>) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = localizedCopy(translations, active)
    const hidden = useSession((s) => s.blank || s.awaitingFirstTurn || s.removed || s.openState !== 'open')
    const unavailable = useSession(
      (s) => s.running || s.pendingSubmissions.length > 0 || s.removed || s.openState !== 'open'
    )
    const canPrompt = useAccess('session.prompt')
    const cwd = useProjection('workingDirectory')
    const [panel, setPanel] = useState<ForgePanelState>()
    const [facts, setFacts] = useState<{ panel: ForgePanelState; dirty: boolean }>()
    const [defaultAction, setDefaultAction] = useState<DefaultAction>('commit')
    const [lookupError, setLookupError] = useState(false)
    const [error, setError] = useState<keyof Copy>()
    const [busy, setBusy] = useState<Busy>()
    const [open, setOpen] = useState(false)
    const [generation, setGeneration] = useState(0)
    const [version, setVersion] = useState(0)
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
      const controller = new AbortController()
      void call(methods.settings, {}, controller.signal)
        .then((value) => {
          const action = (value as { defaultAction?: unknown } | null)?.defaultAction
          if (!controller.signal.aborted && (action === 'commit' || action === 'push')) setDefaultAction(action)
        })
        .catch(() => {})
      return () => controller.abort()
    }, [generation])

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

    // Changes are read only while the Session is idle; the last answer stays visible, disabled, during a turn.
    useEffect(() => {
      if (!panel || panel.checkout.state !== 'ready' || unavailable) return
      const controller = new AbortController()
      let sequence = 0
      const refresh = async () => {
        const current = ++sequence
        try {
          const local = await ctx.remote.forgePanel.localDiff(sessionId, { kind: 'uncommitted' }, controller.signal)
          if (controller.signal.aborted || current !== sequence) return
          if (!local.ok) {
            setLookupError(true)
            return
          }
          setFacts({ panel, dirty: local.value.files.length > 0 || local.value.omitted > 0 })
          setLookupError(false)
        } catch {
          if (!controller.signal.aborted && current === sequence) setLookupError(true)
        }
      }
      void refresh()
      const onFocus = () => void refresh()
      window.addEventListener('focus', onFocus)
      return () => {
        controller.abort()
        window.removeEventListener('focus', onFocus)
      }
    }, [panel, sessionId, unavailable, version])

    const request = panel && requestForCheckout(panel)
    const fresh = facts?.panel === panel && facts !== undefined
    const disabled = !canPrompt || unavailable || !!busy || !fresh || lookupError
    useEffect(() => {
      if (disabled) setOpen(false)
    }, [disabled])
    const showPanel = () => ctx.sidebarRight.openTab('forge-panel')
    const act = async (operation: Busy) => {
      if (disabled || pending.current) return
      pending.current = true
      setBusy(operation)
      setOpen(false)
      setError(undefined)
      try {
        if (operation === 'pr') await call(methods.pr, { sessionId })
        else await call(methods.commit, { sessionId, push: operation === 'push' })
      } catch (failure) {
        const code = (failure as { code?: ActionErrorCode }).code
        if (mounted.current) setError((code && errorKeys[code]) || 'error')
      } finally {
        pending.current = false
        void ctx.remote.forgePanel.refresh(sessionId).catch(() => {})
        if (mounted.current) {
          setBusy(undefined)
          setVersion((n) => n + 1)
        }
      }
    }
    const saveDefault = (action: DefaultAction) => {
      const previous = defaultAction
      setDefaultAction(action)
      void call(methods.saveDefault, { defaultAction: action }).catch(() => {
        if (mounted.current) {
          setDefaultAction(previous)
          setError('error')
        }
      })
    }
    if (hidden || !panel || panel.checkout.state !== 'ready') return null
    const dirty = !!facts?.dirty
    const showCreate = !dirty && fresh && canCreatePr(panel)
    if (!dirty && !showCreate && !request && !lookupError && !error) return null
    const commitLabel =
      busy === 'commit'
        ? text.committing
        : busy === 'push'
          ? text.pushing
          : text[defaultAction === 'push' ? 'commitPush' : 'commit']
    const checks = request?.snapshot?.checksRollup ?? 'unknown'
    const stale = !!request?.update && 'error' in request.update
    return (
      <div className="dsh-forge-chip">
        {dirty && (
          <div className="dsh-forge-chip-actions">
            <Pill
              className="dsh-forge-chip-trigger dsh-forge-chip-commit"
              disabled={disabled}
              aria-busy={busy === 'commit' || busy === 'push'}
              onClick={() => void act(defaultAction)}
            >
              <IconBranchOutlineRegular aria-hidden="true" />
              {commitLabel}
            </Pill>
            <Menu
              open={open}
              side="top"
              portal
              compact
              onClose={() => setOpen(false)}
              selectedId={`default-${defaultAction}`}
              items={[
                { id: 'commit', label: text.commit },
                ...(panel.repository ? [{ id: 'push', label: text.commitPush }] : []),
                { type: 'separator', id: 'separator' },
                { type: 'label', id: 'default', text: text.defaultAction },
                { id: 'default-commit', label: text.commit },
                { id: 'default-push', label: text.commitPush },
              ]}
              onSelect={(id) => {
                setOpen(false)
                if (id === 'default-commit' || id === 'default-push')
                  saveDefault(id === 'default-push' ? 'push' : 'commit')
                else void act(id as DefaultAction)
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
        )}
        {showCreate && (
          <Pill
            className="dsh-forge-chip-trigger dsh-forge-chip-create"
            disabled={disabled}
            aria-busy={busy === 'pr'}
            onClick={() => void act('pr')}
          >
            <IconBranchOutlineRegular aria-hidden="true" />
            {busy === 'pr' ? text.creatingPr : text.pr}
          </Pill>
        )}
        {/* Viewing is read-only, so it stays available while a turn runs. */}
        {request && (
          <Pill className="dsh-forge-chip-trigger dsh-forge-chip-view" onClick={showPanel}>
            {text.viewPr}
          </Pill>
        )}
        {request && (
          <Pill className="dsh-forge-chip-trigger dsh-forge-chip-checks" onClick={showPanel}>
            {text.checks}: {stale ? text.unknown : text[checks]}
          </Pill>
        )}
        {lookupError && (
          <Pill className="dsh-forge-chip-trigger" onClick={showPanel}>
            {text.lookupError}
          </Pill>
        )}
        {error && <span role="alert">{text[error]}</span>}
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
