import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import {
  Button,
  Input,
  installSettingsIcon,
  PluginPage,
  pageStyles,
  SettingsRow,
  settingsStyles,
} from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { cliProxyIconSvg } from '@dungsil/dsh-ui/icons'
import { channel, endpointPrefix, type ConnectionView, type QuotaAccount, type QuotaResult } from './protocol.js'
import { localizedCopy } from './copy.js'
import { QuotaPanel, quotaStyles } from './quota-panel.js'
import { loadQuotaSnapshot, QuotaCache, quotaKey, subscribeQuotaGeneration, type QuotaSnapshot } from './quota-cache.js'

export const name = 'dungsil-cli-proxy-api'
export const inject = ['connection', 'locale', 'slots']

declare module '@deepseek-ai/cordis' {
  interface Events {
    'cli-proxy-api/connection-changed'(): void
  }
}

const styles = `${settingsStyles}${quotaStyles}${pageStyles}
.dsh-cli-proxy-icon { display: inline-flex; }
.dsh-cli-proxy-icon > svg { width: 100%; height: 100%; }
.dsh-cli-proxy { container-type: inline-size; color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-cli-proxy h3 { margin: 24px 0 0; font: inherit; color: var(--dsw-alias-label-secondary); }
.dsh-cli-proxy .controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; max-width: 65%; }
.dsh-cli-proxy .controls > span:has(> input) { box-sizing: border-box; width: 280px; min-width: 0; max-width: 100%; }
.dsh-cli-proxy .controls > button { max-width: 100%; }
.dsh-cli-proxy .hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; margin: 8px 0; }
.dsh-cli-proxy [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
.dsh-cli-proxy p, .dsh-cli-proxy .dsh-plugin-settings-text { overflow-wrap: anywhere; }
.dsh-cli-proxy .quota-window { padding: 8px 0; }
.dsh-cli-proxy .quota-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
.dsh-cli-proxy progress { display: block; width: 100%; height: 6px; margin: 8px 0; border: 0; border-radius: 3px; overflow: hidden; appearance: none; background: var(--dsw-alias-bg-module-platform); }
.dsh-cli-proxy progress::-webkit-progress-bar { background: var(--dsw-alias-bg-module-platform); }
.dsh-cli-proxy progress::-webkit-progress-value { background: var(--dsw-alias-brand-primary-new-colorprimary-new-color); }
.dsh-cli-proxy progress::-moz-progress-bar { background: var(--dsw-alias-brand-primary-new-colorprimary-new-color); }
@container (max-width: 480px) {
  .dsh-cli-proxy .dsh-plugin-settings-row { flex-direction: column; align-items: stretch; gap: 12px; }
  .dsh-cli-proxy .controls { width: 100%; max-width: 100%; justify-content: flex-start; }
  .dsh-cli-proxy .controls > span:has(> input) { width: 100%; }
}
`

type Notice = 'error' | 'success' | 'savedConnection'

function ProxyPage({ ctx, cache, settings = false }: { ctx: Context; cache: QuotaCache; settings?: boolean }) {
  const locale = useLocaleSnapshot(ctx.locale)
  const text = localizedCopy(locale.active)
  const id = useId()
  const [connectionVersion, setConnectionVersion] = useState(0)
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const cachedView = settings ? undefined : cache.connection
  const cached = cachedView && cache.read(cachedView)
  const [view, setView] = useState<ConnectionView | undefined>(cachedView)
  const [baseURL, setBaseURL] = useState(cachedView?.baseURL ?? '')
  // Secrets live only in the input draft and the in-flight RPC payload, never in persisted state.
  const [apiKey, setAPIKey] = useState('')
  const [managementKey, setManagementKey] = useState('')
  const [removeAPIKey, setRemoveAPIKey] = useState(false)
  const [removeManagementKey, setRemoveManagementKey] = useState(false)
  const [synchronized, setSynchronized] = useState(!!cached)
  const [busy, setBusy] = useState(!cached)
  const [notice, setNotice] = useState<Notice>()
  const [quotaAccounts, setQuotaAccounts] = useState<QuotaAccount[] | undefined>(cached?.accounts)
  const [quotas, setQuotas] = useState<Record<string, QuotaResult | null | undefined>>(cached?.quotas ?? {})
  const [fetchedAt, setFetchedAt] = useState<number | undefined>(cached?.fetchedAt)
  const [uncertain, setUncertain] = useState(false)
  const lock = useRef(true)
  const lifetime = useRef<AbortController>()

  const call = useCallback(
    async <T,>(endpoint: string, payload: Record<string, unknown>, controller: AbortController): Promise<T> => {
      const result = await connection.rpc.call(channel, endpointPrefix + endpoint, payload, controller.signal)
      if (controller.signal.aborted || lifetime.current !== controller) throw new Error('inactive')
      // Never expose server messages, details, or unknown error codes to the UI.
      if (!result.ok) throw new Error('request failed')
      return result.value as unknown as T
    },
    [connection]
  )

  const describe = useCallback(
    async (controller: AbortController) => {
      setSynchronized(false)
      const next = await call<ConnectionView>('describe', {}, controller)
      cache.read(next)
      setView(next)
      setBaseURL(next.baseURL)
      setSynchronized(true)
      setAPIKey('')
      setManagementKey('')
      setRemoveAPIKey(false)
      setRemoveManagementKey(false)
      setQuotaAccounts(undefined)
      setQuotas({})
      setFetchedAt(undefined)
      return next
    },
    [call, cache]
  )

  const showSnapshot = useCallback((snapshot: QuotaSnapshot) => {
    setQuotaAccounts(snapshot.accounts)
    setQuotas(snapshot.quotas)
    setFetchedAt(snapshot.fetchedAt)
  }, [])

  const loadAccounts = useCallback(
    async (next: ConnectionView, controller: AbortController) => {
      const snapshot = await loadQuotaSnapshot(
        () => call<QuotaAccount[]>('quota-list', {}, controller),
        (account) => call<QuotaResult>('quota-fetch', { name: account.name, authIndex: account.authIndex }, controller),
        controller.signal,
        showSnapshot
      )
      controller.signal.throwIfAborted()
      cache.write(next, snapshot)
      setUncertain(false)
      if (Object.values(snapshot.quotas).some((result) => result === null)) setNotice('error')
    },
    [call, cache, showSnapshot]
  )

  useEffect(() => {
    const invalidate = () => {
      lifetime.current?.abort()
      cache.clear()
      setConnectionVersion((version) => version + 1)
    }
    const dispose = settings ? undefined : ctx.on('cli-proxy-api/connection-changed', invalidate)
    const unsubscribe = subscribeQuotaGeneration(
      connection.generation,
      cache,
      () => lifetime.current?.abort(),
      (connected) => {
        if (connected) {
          setConnectionVersion((version) => version + 1)
          return
        }
        lock.current = true
        setBusy(true)
        setSynchronized(false)
        setView(undefined)
        setQuotaAccounts(undefined)
        setQuotas({})
        setFetchedAt(undefined)
        setAPIKey('')
        setManagementKey('')
        setNotice(undefined)
      }
    )
    return () => {
      dispose?.()
      unsubscribe()
    }
  }, [ctx, settings, connection, cache])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    const restoreView = settings ? undefined : cache.connection
    const restore = restoreView && cache.read(restoreView)
    if (restore && restoreView) {
      setView(restoreView)
      setBaseURL(restoreView.baseURL)
      setSynchronized(true)
      showSnapshot(restore)
      lock.current = false
      setBusy(false)
      return () => {
        controller.abort()
        if (lifetime.current === controller) lifetime.current = undefined
      }
    }
    lock.current = true
    setBusy(true)
    setSynchronized(false)
    setView(undefined)
    setQuotaAccounts(undefined)
    setQuotas({})
    setFetchedAt(undefined)
    setUncertain(false)
    setAPIKey('')
    setManagementKey('')
    setNotice(undefined)
    void describe(controller)
      .then(async (next) => {
        if (settings) return
        if (!next.managementKeySaved) return
        await loadAccounts(next, controller)
      })
      .catch(() => {
        if (!controller.signal.aborted && lifetime.current === controller) setNotice('error')
      })
      .finally(() => {
        if (!controller.signal.aborted && lifetime.current === controller) {
          lock.current = false
          setBusy(false)
        }
      })
    return () => {
      controller.abort()
      if (lifetime.current === controller) lifetime.current = undefined
    }
  }, [describe, connectionVersion, settings, cache, showSnapshot, loadAccounts])

  // One lock covers reads and writes. An aborted or uncertain write is never automatically repeated.
  const run = async (work: (controller: AbortController) => Promise<void>, mutation = false) => {
    const controller = lifetime.current
    if (lock.current || !controller || controller.signal.aborted) return
    lock.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      await work(controller)
    } catch {
      if (!controller.signal.aborted && lifetime.current === controller) {
        setNotice('error')
        if (mutation) {
          cache.clear()
          setUncertain(true)
          setQuotaAccounts(undefined)
        }
      }
    } finally {
      if (!controller.signal.aborted && lifetime.current === controller) {
        lock.current = false
        setBusy(false)
      }
    }
  }

  const save = () => {
    if (!view || !synchronized || lock.current) return
    const changedURL = baseURL.trim() !== view.baseURL
    const payload = {
      revision: view.revision,
      baseURL: baseURL.trim(),
      apiKey: apiKey || (removeAPIKey || changedURL ? '' : undefined),
      managementKey: managementKey || (removeManagementKey || changedURL ? '' : undefined),
    }
    // Clear immediately, including when the response is lost or the save fails.
    setAPIKey('')
    setManagementKey('')
    void run(async (controller) => {
      cache.clear()
      setSynchronized(false)
      let saved = false
      try {
        await call('save', payload, controller)
        saved = true
      } catch {
        if (controller.signal.aborted || lifetime.current !== controller) return
      }
      // Both success and failure require a fresh revision before any further save.
      await describe(controller)
      ctx.emit('cli-proxy-api/connection-changed')
      setNotice(saved ? 'savedConnection' : 'error')
    })
  }

  const draftChanged =
    !!view && (baseURL.trim() !== view.baseURL || !!apiKey || !!managementKey || removeAPIKey || removeManagementKey)
  const connected = !!view && synchronized && !draftChanged
  const canManage = connected && !!view?.managementKeySaved
  const managementDisabled = busy || !canManage || uncertain
  const row = (label: ReactNode, children: ReactNode) => (
    <SettingsRow label={label}>
      <div className="controls">{children}</div>
    </SettingsRow>
  )
  const button = (label: string, onClick: () => void, disabled = busy) => (
    <Button variant="outline" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  )

  return (
    <section className="dsh-cli-proxy" aria-label="CLIProxyAPI" aria-busy={busy}>
      {busy && <p role="status">{text.busy}</p>}
      {notice && <p role={notice === 'error' ? 'alert' : 'status'}>{text[notice]}</p>}
      {!synchronized && !busy && button(text.refresh, () => setConnectionVersion((version) => version + 1))}
      {settings ? (
        <>
          <h3>{text.connection}</h3>
          <p className="hint">{text.serverHint}</p>
          {row(
            <label htmlFor={`${id}-url`}>{text.baseURL}</label>,
            <Input
              id={`${id}-url`}
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={baseURL}
              disabled={busy || !synchronized}
              onChange={(event) => setBaseURL(event.target.value)}
            />
          )}
          {row(
            <label htmlFor={`${id}-api`}>{text.apiKey}</label>,
            <>
              <Input
                id={`${id}-api`}
                type="password"
                autoComplete="off"
                value={apiKey}
                disabled={busy || !synchronized}
                placeholder={removeAPIKey ? text.removed : view?.apiKeySaved ? text.saved : text.notSaved}
                onChange={(event) => {
                  setAPIKey(event.target.value)
                  setRemoveAPIKey(false)
                }}
              />
              {button(
                text.remove,
                () => {
                  setAPIKey('')
                  setRemoveAPIKey(true)
                },
                busy || !synchronized || !view?.apiKeySaved || removeAPIKey
              )}
            </>
          )}
          {row(
            <label htmlFor={`${id}-management`}>{text.managementKey}</label>,
            <>
              <Input
                id={`${id}-management`}
                type="password"
                autoComplete="off"
                value={managementKey}
                disabled={busy || !synchronized}
                placeholder={removeManagementKey ? text.removed : view?.managementKeySaved ? text.saved : text.notSaved}
                onChange={(event) => {
                  setManagementKey(event.target.value)
                  setRemoveManagementKey(false)
                }}
              />
              {button(
                text.remove,
                () => {
                  setManagementKey('')
                  setRemoveManagementKey(true)
                },
                busy || !synchronized || !view?.managementKeySaved || removeManagementKey
              )}
            </>
          )}
          <p className="hint">{text.keyHint}</p>
          {!synchronized && !busy && <p role="alert">{text.connectionLocked}</p>}
          {row(text.connection, button(text.save, save, busy || !synchronized || !baseURL.trim()))}
          {draftChanged && <p className="hint">{text.draftHint}</p>}
        </>
      ) : (
        <>
          <p className="hint">{text.connectionSettingsHint}</p>
          {!view?.managementKeySaved && <p className="hint">{text.managementHint}</p>}
          <QuotaPanel
            accounts={quotaAccounts}
            quotas={quotas}
            fetchedAt={fetchedAt}
            language={locale.active}
            text={text}
            busy={busy}
            canLoad={canManage}
            managementDisabled={managementDisabled}
            onLoad={() => {
              if (!canManage || !view) return
              void run(async (controller) => {
                cache.clear()
                await loadAccounts(view, controller)
              })
            }}
            onFetch={(account) => {
              const key = quotaKey(account)
              void run(async (controller) => {
                setQuotas((current) => ({ ...current, [key]: undefined }))
                try {
                  const next = await call<QuotaResult>(
                    'quota-fetch',
                    { name: account.name, authIndex: account.authIndex },
                    controller
                  )
                  setQuotas((current) => ({ ...current, [key]: next }))
                  if (view) cache.update(view, account, next)
                } catch {
                  if (!controller.signal.aborted && lifetime.current === controller) {
                    setQuotas((current) => ({ ...current, [key]: null }))
                    if (view) cache.update(view, account, null)
                  }
                  throw new Error('request failed')
                }
              })
            }}
            onReset={(account) => {
              void run(async (controller) => {
                await call('reset', { authIndex: account.authIndex }, controller)
                setNotice('success')
              }, true)
            }}
          />
        </>
      )}
    </section>
  )
}

function ProxyPanel({ ctx, cache }: { ctx: Context; cache: QuotaCache }) {
  return (
    <PluginPage contentClassName="dsh-cli-proxy">
      <h1>CLIProxyAPI</h1>
      <ProxyPage ctx={ctx} cache={cache} />
    </PluginPage>
  )
}

export function apply(ctx: Context) {
  const cache = new QuotaCache()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  ctx.effect(() => connection.generation.subscribe(() => cache.clear()), 'cli-proxy-api: cache generation')
  ctx.on('cli-proxy-api/connection-changed', () => cache.clear())
  ctx.effect(() => () => cache.clear(), 'cli-proxy-api: quota cache')
  ctx.effect(() => installStyles(styles), 'cli-proxy-api: styles')
  ctx.effect(() => installSettingsIcon(name, ['CLIProxyAPI'], cliProxyIconSvg))
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 17,
        label: () => 'CLIProxyAPI',
        inject: () => ({ ctx, cache }),
      },
      (props) => <ProxyPage {...props} settings />
    )
  )
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: name as MainPanelId, inject: () => ({ ctx, cache }) }, (props) => (
      <ProxyPanel {...props} />
    ))
  )
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: name as MainPanelId, order: 20, label: () => 'CLIProxyAPI' },
      ({ size }) => (
        <span
          className="dsh-cli-proxy-icon"
          style={{ width: size, height: size }}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: cliProxyIconSvg }}
        />
      )
    )
  )
}
