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
  IconPluginPinwheelOutlineRegular,
  SegmentedTabs,
  SettingsPicker,
  SettingsRow,
  settingsStyles,
} from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import {
  channel,
  endpointPrefix,
  oauthProviders,
  providerFamilies,
  type ConnectionView,
  type ManagementView,
  type OAuthSession,
  type ProviderView,
  type QuotaAccount,
  type QuotaResult,
  type ProxyModel,
} from './protocol.js'
import { localizedCopy } from './copy.js'
import { QuotaPanel, quotaStyles } from './quota-panel.js'

export const name = 'dungsil-cli-proxy-api'
export const inject = ['connection', 'locale', 'slots']

declare module '@deepseek-ai/cordis' {
  interface Events {
    'cli-proxy-api/connection-changed'(): void
  }
}

const styles = `${settingsStyles}${quotaStyles}
.dsh-cli-proxy { container-type: inline-size; color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-cli-proxy-page { height: 100%; min-height: 0; box-sizing: border-box; overflow-y: auto; padding: 24px; padding-inline-start: max(24px, var(--dsh-frame-leading-clearance, 0px)); }
.dsh-cli-proxy-page > .dsh-cli-proxy { max-width: 960px; margin: 0 auto; }
.dsh-cli-proxy h1 { font-size: 20px; line-height: 28px; font-weight: 500; margin: 0 0 24px; }
.dsh-cli-proxy h3 { margin: 24px 0 0; font: inherit; color: var(--dsw-alias-label-secondary); }
.dsh-cli-proxy .controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; max-width: 65%; }
.dsh-cli-proxy .controls > span:has(> input) { box-sizing: border-box; width: 280px; min-width: 0; max-width: 100%; }
.dsh-cli-proxy .controls > button { max-width: 100%; }
.dsh-cli-proxy .oauth-link { color: var(--dsw-alias-state-business-primary); }
.dsh-cli-proxy .hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; margin: 8px 0; }
.dsh-cli-proxy [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
.dsh-cli-proxy p, .dsh-cli-proxy .dsh-plugin-settings-text { overflow-wrap: anywhere; }
.dsh-cli-proxy .oauth-code { user-select: all; }
.dsh-cli-proxy .quota-window { padding: 8px 0; }
.dsh-cli-proxy .quota-heading { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
.dsh-cli-proxy progress { display: block; width: 100%; height: 6px; margin: 8px 0; border: 0; border-radius: 3px; overflow: hidden; appearance: none; background: var(--dsw-alias-bg-module-platform); }
.dsh-cli-proxy progress::-webkit-progress-bar { background: var(--dsw-alias-bg-module-platform); }
.dsh-cli-proxy progress::-webkit-progress-value { background: var(--dsw-alias-brand-primary-new-colorprimary-new-color); }
.dsh-cli-proxy progress::-moz-progress-bar { background: var(--dsw-alias-brand-primary-new-colorprimary-new-color); }
@container (max-width: 480px) {
  .dsh-cli-proxy .dsh-plugin-settings-row { flex-direction: column; align-items: stretch; gap: 12px; }
  .dsh-cli-proxy .controls { width: 100%; max-width: 100%; justify-content: flex-start; }
  .dsh-cli-proxy .controls > span:has(> input), .dsh-cli-proxy .dsh-plugin-settings-picker, .dsh-cli-proxy .dsh-plugin-settings-selector { width: 100%; }
  .dsh-cli-proxy .dsh-plugin-settings-selector { justify-content: space-between; }
}
`

type Notice = 'error' | 'success' | 'savedConnection' | 'callbackSent' | 'cancelled'
type OAuthStatus = 'wait' | 'ok' | 'oauthError'
type Strategy = 'round-robin' | 'weighted-round-robin' | 'fill-first'

function safeAuthorizationURL(value: string) {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.href
      : undefined
  } catch {
    return undefined
  }
}

function ProxyPage({
  ctx,
  settings = false,
  page = 'overview',
}: {
  ctx: Context
  settings?: boolean
  page?: 'overview' | 'providers' | 'quota'
}) {
  const locale = useLocaleSnapshot(ctx.locale)
  const text = localizedCopy(locale.active)
  const id = useId()
  const [connectionVersion, setConnectionVersion] = useState(0)
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<ConnectionView>()
  const [baseURL, setBaseURL] = useState('')
  // Secrets live only in the input draft and the in-flight RPC payload, never in persisted state.
  const [apiKey, setAPIKey] = useState('')
  const [managementKey, setManagementKey] = useState('')
  const [removeAPIKey, setRemoveAPIKey] = useState(false)
  const [removeManagementKey, setRemoveManagementKey] = useState(false)
  const [synchronized, setSynchronized] = useState(false)
  const [busy, setBusy] = useState(true)
  const [notice, setNotice] = useState<Notice>()
  const [models, setModels] = useState<ProxyModel[]>()
  const [management, setManagement] = useState<ManagementView>()
  const [providers, setProviders] = useState<ProviderView>()
  const [quotaAccounts, setQuotaAccounts] = useState<QuotaAccount[]>()
  const [quotas, setQuotas] = useState<Record<string, QuotaResult | null | undefined>>({})
  const [family, setFamily] = useState<string>(providerFamilies[0])
  const [groupName, setGroupName] = useState('')
  const [upstreamURL, setUpstreamURL] = useState('')
  const [upstreamKey, setUpstreamKey] = useState('')
  const [modelIDs, setModelIDs] = useState('')
  const [strategy, setStrategy] = useState('')
  const [retry, setRetry] = useState('0')
  const [provider, setProvider] = useState<(typeof oauthProviders)[number]>(oauthProviders[0])
  const [session, setSession] = useState<OAuthSession>()
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatus>()
  const [redirectURL, setRedirectURL] = useState('')
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
      setView(next)
      setBaseURL(next.baseURL)
      setSynchronized(true)
      setAPIKey('')
      setManagementKey('')
      setRemoveAPIKey(false)
      setRemoveManagementKey(false)
      setModels(undefined)
      setManagement(undefined)
      setProviders(undefined)
      setQuotaAccounts(undefined)
      setQuotas({})
      setUpstreamKey('')
    },
    [call]
  )

  useEffect(() => {
    const dispose = settings
      ? undefined
      : ctx.on('cli-proxy-api/connection-changed', () => setConnectionVersion((version) => version + 1))
    const unsubscribe = connection.generation.subscribe(() => {
      if (connection.generation.getSnapshot()) setConnectionVersion((version) => version + 1)
    })
    return () => {
      dispose?.()
      unsubscribe()
    }
  }, [ctx, settings, connection])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    lock.current = true
    setBusy(true)
    setSynchronized(false)
    setView(undefined)
    setModels(undefined)
    setManagement(undefined)
    setProviders(undefined)
    setQuotaAccounts(undefined)
    setQuotas({})
    setUpstreamKey('')
    setSession(undefined)
    setOAuthStatus(undefined)
    setStrategy('')
    setRetry('0')
    setUncertain(false)
    setRedirectURL('')
    setAPIKey('')
    setManagementKey('')
    setNotice(undefined)
    void describe(controller)
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
  }, [describe, connectionVersion, page])

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
          setUncertain(true)
          setManagement(undefined)
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
    setSession(undefined)
    setRedirectURL('')
    void run(async (controller) => {
      setSynchronized(false)
      setModels(undefined)
      setManagement(undefined)
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
  const strategies: { id: Strategy; label: string }[] = [
    { id: 'round-robin', label: text.roundRobin },
    { id: 'weighted-round-robin', label: text.weighted },
    { id: 'fill-first', label: text.fillFirst },
  ]
  const validStrategy = strategies.some((item) => item.id === strategy)
  const validRetry = /^\d+$/.test(retry) && Number.isSafeInteger(Number(retry))
  const oauthURL = session && safeAuthorizationURL(session.url)
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
  const mutate = (endpoint: string, payload: Record<string, unknown>) => {
    if (managementDisabled || (!management && !quotaAccounts)) return
    void run(async (controller) => {
      await call(endpoint, payload, controller)
      setManagement(undefined)
      setQuotaAccounts(undefined)
      setNotice('success')
    }, true)
  }
  const refreshManagement = () => {
    if (!canManage) return
    void run(async (controller) => {
      if (page === 'providers') {
        setQuotaAccounts(undefined)
        setQuotaAccounts(await call<QuotaAccount[]>('quota-list', {}, controller))
      } else {
        setManagement(undefined)
        const next = await call<ManagementView>('management', {}, controller)
        setManagement(next)
        setStrategy(next.strategy)
        setRetry(String(next.requestRetry))
      }
      setUncertain(false)
    })
  }

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
          {page === 'quota' && (
            <>
              {!view?.managementKeySaved && <p className="hint">{text.managementHint}</p>}
              <QuotaPanel
                accounts={quotaAccounts}
                quotas={quotas}
                language={locale.active}
                text={text}
                busy={busy}
                canLoad={canManage}
                managementDisabled={managementDisabled}
                onLoad={() => {
                  if (!canManage) return
                  void run(async (controller) => {
                    setQuotaAccounts(undefined)
                    setQuotas({})
                    setQuotaAccounts(await call<QuotaAccount[]>('quota-list', {}, controller))
                    setUncertain(false)
                  })
                }}
                onFetch={(account) => {
                  const key = JSON.stringify([account.name, account.authIndex])
                  void run(async (controller) => {
                    setQuotas((current) => ({ ...current, [key]: undefined }))
                    try {
                      const next = await call<QuotaResult>(
                        'quota-fetch',
                        { name: account.name, authIndex: account.authIndex },
                        controller
                      )
                      setQuotas((current) => ({ ...current, [key]: next }))
                    } catch {
                      if (!controller.signal.aborted && lifetime.current === controller)
                        setQuotas((current) => ({ ...current, [key]: null }))
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
          {page === 'overview' && (
            <>
              <h3>{text.models}</h3>
              {row(
                text.models,
                button(
                  text.refreshModels,
                  () => {
                    if (!connected) return
                    void run(async (controller) => {
                      setModels(undefined)
                      setModels(await call<ProxyModel[]>('models', {}, controller))
                    })
                  },
                  busy || !connected
                )
              )}
              {!models ? (
                <p className="hint">{text.unloadedModels}</p>
              ) : models.length === 0 ? (
                <p>{text.emptyModels}</p>
              ) : (
                models.map((model) => (
                  <SettingsRow key={model.id} label={model.name}>
                    <span>{model.id}</span>
                  </SettingsRow>
                ))
              )}
            </>
          )}
          {page === 'providers' && (
            <>
              <h3>{text.providers}</h3>
              {row(
                text.providers,
                button(
                  text.refreshProviders,
                  () => {
                    if (!canManage) return
                    void run(async (controller) => {
                      setProviders(undefined)
                      setProviders(await call<ProviderView>('providers', {}, controller))
                      setUncertain(false)
                    })
                  },
                  busy || !canManage
                )
              )}
              {!providers ? (
                <p className="hint">{text.loadProvidersHint}</p>
              ) : providers.groups.length === 0 ? (
                <p>{text.emptyProviders}</p>
              ) : (
                providers.groups.map((group, index) => (
                  <SettingsRow
                    key={index}
                    label={
                      <>
                        {group.name}
                        <div className="hint">{group.family}</div>
                      </>
                    }
                  >
                    <span>
                      {text.keyCount}: {group.keys}
                    </span>
                  </SettingsRow>
                ))
              )}
              {row(
                text.providerFamily,
                <SettingsPicker
                  aria-label={text.providerFamily}
                  value={family}
                  selectedId={family}
                  items={providerFamilies.map((id) => ({ id, label: id }))}
                  disabled={managementDisabled}
                  onSelect={setFamily}
                />
              )}
              {row(
                <label htmlFor={`${id}-group`}>{text.providerName}</label>,
                <Input
                  id={`${id}-group`}
                  value={groupName}
                  maxLength={256}
                  disabled={managementDisabled}
                  onChange={(event) => setGroupName(event.target.value)}
                />
              )}
              {row(
                <label htmlFor={`${id}-upstream-url`}>{text.upstreamURL}</label>,
                <Input
                  id={`${id}-upstream-url`}
                  type="url"
                  value={upstreamURL}
                  disabled={managementDisabled}
                  autoComplete="off"
                  onChange={(event) => setUpstreamURL(event.target.value)}
                />
              )}
              {row(
                <label htmlFor={`${id}-upstream-key`}>{text.providerKey}</label>,
                <Input
                  id={`${id}-upstream-key`}
                  type="password"
                  value={upstreamKey}
                  disabled={managementDisabled}
                  autoComplete="off"
                  onChange={(event) => setUpstreamKey(event.target.value)}
                />
              )}
              {row(
                <label htmlFor={`${id}-model-ids`}>{text.modelIDs}</label>,
                <Input
                  id={`${id}-model-ids`}
                  value={modelIDs}
                  disabled={managementDisabled}
                  onChange={(event) => setModelIDs(event.target.value)}
                />
              )}
              <p className="hint">{text.providerHint}</p>
              {row(
                text.providers,
                button(
                  text.addProvider,
                  () => {
                    if (!providers || lock.current) return
                    const payload = {
                      revision: providers.revision,
                      family,
                      name: groupName.trim(),
                      baseURL: upstreamURL.trim(),
                      apiKey: upstreamKey,
                      models: modelIDs
                        .split(/[,\n]/)
                        .map((id) => id.trim())
                        .filter(Boolean),
                    }
                    setUpstreamKey('')
                    void run(async (controller) => {
                      setProviders(undefined)
                      await call('provider-add', payload, controller)
                      setNotice('success')
                      setGroupName('')
                      setUpstreamURL('')
                      setModelIDs('')
                    }, true)
                  },
                  managementDisabled ||
                    !providers ||
                    !groupName.trim() ||
                    !upstreamKey.trim() ||
                    (family === 'openai-compatibility' && (!upstreamURL.trim() || !modelIDs.trim()))
                )
              )}
              <h3>{text.accounts}</h3>
              {!view?.managementKeySaved && <p className="hint">{text.managementHint}</p>}
              {row(text.accounts, button(text.refreshManagement, refreshManagement, busy || !canManage))}
              {!quotaAccounts ? (
                <p className="hint">{text.unloadedManagement}</p>
              ) : quotaAccounts.length === 0 ? (
                <p>{text.emptyAccounts}</p>
              ) : (
                quotaAccounts.map((account, index) => (
                  <SettingsRow
                    key={`${account.authIndex}-${index}`}
                    label={
                      <>
                        {account.name}
                        <div className="hint">
                          {account.provider} · {account.disabled ? text.disabled : text.enabled}
                          {!account.editable && ` · ${text.readOnly}`}
                        </div>
                      </>
                    }
                  >
                    <div className="controls">
                      {button(
                        account.disabled ? text.enable : text.disable,
                        () => mutate('account', { name: account.name, disabled: !account.disabled }),
                        managementDisabled || !account.editable
                      )}
                      {button(
                        text.reset,
                        () => mutate('reset', { authIndex: account.authIndex }),
                        managementDisabled || !account.editable
                      )}
                    </div>
                  </SettingsRow>
                ))
              )}
              {row(
                text.provider,
                <>
                  <SettingsPicker
                    aria-label={text.provider}
                    value={provider}
                    selectedId={provider}
                    items={oauthProviders.map((item) => ({ id: item, label: item }))}
                    disabled={managementDisabled || !!session}
                    onSelect={(value) => {
                      if (oauthProviders.some((item) => item === value)) setProvider(value as typeof provider)
                    }}
                  />
                  {button(
                    text.start,
                    () => {
                      if (managementDisabled || session) return
                      void run(async (controller) => {
                        const next = await call<OAuthSession>('oauth-start', { provider }, controller)
                        setSession(next)
                        setOAuthStatus('wait')
                        setRedirectURL('')
                      }, true)
                    },
                    managementDisabled || !!session
                  )}
                </>
              )}
              {oauthStatus && <p role={oauthStatus === 'oauthError' ? 'alert' : 'status'}>{text[oauthStatus]}</p>}
              {session && (
                <>
                  {oauthURL ? (
                    <p>
                      <a className="oauth-link" href={oauthURL} target="_blank" rel="noopener noreferrer">
                        {text.open}
                      </a>
                    </p>
                  ) : (
                    <p role="alert">{text.unsafeURL}</p>
                  )}
                  {session.userCode && (
                    <p>
                      {text.userCode}: <span className="oauth-code">{session.userCode}</span>
                    </p>
                  )}
                  {row(
                    text.accounts,
                    <>
                      {button(
                        text.check,
                        () => {
                          if (managementDisabled) return
                          void run(async (controller) => {
                            const next = await call<{ status: 'wait' | 'ok' | 'error' }>(
                              'oauth-status',
                              { state: session.state },
                              controller
                            )
                            setOAuthStatus(next.status === 'error' ? 'oauthError' : next.status)
                            if (next.status !== 'wait') {
                              setSession(undefined)
                              setRedirectURL('')
                            }
                          })
                        },
                        managementDisabled
                      )}
                      {button(
                        text.cancel,
                        () => {
                          if (managementDisabled) return
                          void run(async (controller) => {
                            await call('oauth-cancel', { state: session.state }, controller)
                            setSession(undefined)
                            setRedirectURL('')
                            setOAuthStatus(undefined)
                            setNotice('cancelled')
                          }, true)
                        },
                        managementDisabled
                      )}
                    </>
                  )}
                  {row(
                    <label htmlFor={`${id}-callback`}>{text.redirectURL}</label>,
                    <>
                      <Input
                        id={`${id}-callback`}
                        type="password"
                        autoComplete="off"
                        value={redirectURL}
                        disabled={managementDisabled}
                        onChange={(event) => setRedirectURL(event.target.value)}
                      />
                      {button(
                        text.submitCallback,
                        () => {
                          if (managementDisabled || !redirectURL.trim() || lock.current) return
                          const payload = {
                            state: session.state,
                            provider: session.provider,
                            redirectURL: redirectURL.trim(),
                          }
                          setRedirectURL('')
                          void run(async (controller) => {
                            await call('oauth-callback', payload, controller)
                            setNotice('callbackSent')
                          }, true)
                        },
                        managementDisabled || !redirectURL.trim()
                      )}
                    </>
                  )}
                  <p className="hint">{text.callbackHint}</p>
                </>
              )}
            </>
          )}
          {page === 'overview' && (
            <>
              <h3>{text.routing}</h3>
              {row(text.routing, button(text.refreshManagement, refreshManagement, busy || !canManage))}
              {row(
                text.strategy,
                <SettingsPicker
                  aria-label={text.strategy}
                  value={strategies.find((item) => item.id === strategy)?.label ?? text.unknownStrategy}
                  selectedId={strategy}
                  items={strategies}
                  disabled={managementDisabled || !management}
                  onSelect={setStrategy}
                />
              )}
              {row(
                <label htmlFor={`${id}-retry`}>{text.retry}</label>,
                <Input
                  id={`${id}-retry`}
                  type="number"
                  min="0"
                  step="1"
                  value={retry}
                  disabled={managementDisabled || !management}
                  onChange={(event) => setRetry(event.target.value)}
                />
              )}
              <p className="hint">{text.retryHint}</p>
              {row(
                text.routing,
                button(
                  text.saveRouting,
                  () => {
                    if (validStrategy && validRetry) mutate('routing', { strategy, requestRetry: Number(retry) })
                  },
                  managementDisabled || !management || !validStrategy || !validRetry
                )
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

function ProxyPanel({ ctx }: { ctx: Context }) {
  const locale = useLocaleSnapshot(ctx.locale)
  const text = localizedCopy(locale.active)
  const id = useId()
  const [page, setPage] = useState<'overview' | 'providers' | 'quota'>('overview')
  const tabs = [
    { value: 'overview', label: text.overview, id: `${id}-overview`, panelId: `${id}-overview-panel` },
    { value: 'providers', label: text.providers, id: `${id}-providers`, panelId: `${id}-providers-panel` },
    { value: 'quota', label: text.quota, id: `${id}-quota`, panelId: `${id}-quota-panel` },
  ] as const
  return (
    <div className="dsh-cli-proxy-page">
      <div className="dsh-cli-proxy">
        <h1>CLIProxyAPI</h1>
        <SegmentedTabs items={tabs} value={page} onChange={setPage} label="CLIProxyAPI" />
        {tabs.map((tab) => (
          <div
            key={tab.value}
            id={tab.panelId}
            role="tabpanel"
            aria-labelledby={tab.id}
            hidden={page !== tab.value}
            tabIndex={0}
          >
            {page === tab.value && <ProxyPage ctx={ctx} page={tab.value} />}
          </div>
        ))}
      </div>
    </div>
  )
}

export function apply(ctx: Context) {
  ctx.effect(() => installStyles(styles), 'cli-proxy-api: styles')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 17,
        label: () => 'CLIProxyAPI',
        inject: () => ({ ctx }),
      },
      (props) => <ProxyPage {...props} settings />
    )
  )
  ctx.slots.inject('main', () =>
    ctx.slots.register({ name: 'main', key: name as MainPanelId, inject: () => ({ ctx }) }, (props) => (
      <ProxyPanel {...props} />
    ))
  )
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      { name: 'sidebar.panellist', id: name as MainPanelId, order: 20, label: () => 'CLIProxyAPI' },
      ({ size }) => <IconPluginPinwheelOutlineRegular size={size} />
    )
  )
}
