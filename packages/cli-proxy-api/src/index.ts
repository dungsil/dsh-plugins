import { createHash, randomUUID } from 'node:crypto'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import type { PiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
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
  type ProxyModel,
} from './protocol.js'
import { fetchQuota, supportsQuota } from './quota.js'
import { isDisabled, mergeAPIKeyAccounts } from './api-key-accounts.js'

export const name = 'dungsil-cli-proxy-api'
export const inject = ['connection', 'configEditor', 'credentials', 'llm']
const provider = 'cli-proxy-api'
const defaultURL = 'http://127.0.0.1:8317'

export const Config = z.object({
  baseURL: z.string().default(defaultURL).volatile(),
  revision: z.string().default('').volatile(),
})

export interface Config {
  baseURL: Volatile<string>
  revision: Volatile<string>
}

function serverURL(value: string) {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('invalid')
  return url.href.replace(/\/+$/, '')
}

function keyRef(baseURL: string, kind: 'api' | 'management') {
  return credentialRef(`DSH_CLIPROXY_${kind.toUpperCase()}_${createHash('sha256').update(baseURL).digest('hex')}`)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_response')
  return value as Record<string, unknown>
}

function text(value: unknown, max = 1024): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('invalid')
  return value
}

export function apply(ctx: Context, config: Config) {
  let busy = false
  const sessions = new Map<string, { provider: string; baseURL: string; expires: number }>()
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())
  const currentURL = () => serverURL(config.baseURL.get())
  const ownerEntry = () => {
    const entries = ctx.configEditor.entries().filter((entry) => entry.fiber === ctx.fiber)
    if (entries.length !== 1) throw new Error('unavailable')
    return entries[0]!
  }
  const adapterEntry = () => {
    const entries = ctx.configEditor
      .entries()
      .filter((entry) => entry.options.name === '@deepseek-ai/dsh-llm-pi-ai' && entry.fiber?.state === 2)
    if (entries.length !== 1) throw new Error('unavailable')
    return entries[0]!
  }
  const revision = () =>
    createHash('sha256')
      .update(JSON.stringify(ownerEntry().options.config ?? {}))
      .digest('hex')
  const describe = async (): Promise<ConnectionView> => {
    const baseURL = currentURL()
    const [api, management] = await Promise.all(
      (['api', 'management'] as const).map((kind) => ctx.credentials.describe(keyRef(baseURL, kind)))
    )
    return { baseURL, revision: revision(), apiKeySaved: api.configured, managementKeySaved: management.configured }
  }

  const request = async (
    baseURL: string,
    path: string,
    kind: 'api' | 'management',
    signal: AbortSignal,
    method = 'GET',
    body?: unknown,
    ifMatch?: string
  ): Promise<{ data: unknown; etag: string | null }> => {
    const key = (await ctx.credentials.resolve(keyRef(baseURL, kind)))?.value
    if (!key) throw new Error(kind === 'management' ? 'management_key_missing' : 'api_key_missing')
    const response = await fetch(`${baseURL}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(15_000)]),
      headers: {
        Authorization: `Bearer ${key}`,
        ...(ifMatch ? { 'If-Match': ifMatch } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'unauthorized'
          : response.status === 412
            ? 'conflict'
            : response.status === 404
              ? 'not_found'
              : 'upstream_failed'
      )
    }
    if (!response.body) throw new Error('invalid_response')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > 4 * 1024 * 1024) throw new Error('invalid_response')
        chunks.push(next.value)
      }
      return { data: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown, etag: response.headers.get('ETag') }
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  // The official pi-ai adapter owns serialization, streaming, tools, and image handling.
  // Change only our provider key; never replace another provider's settings.
  const syncModels = async (baseURL: string, models?: ProxyModel[]) => {
    const entry = adapterEntry()
    await ctx.configEditor.edit(entry, (current) => {
      const providers = { ...(current.providers as Record<string, PiAiProviderProfile> | undefined) }
      const previous = providers[provider]
      if (!models?.length) delete providers[provider]
      else {
        const matching = previous?.baseURL === `${baseURL}/v1` ? previous : undefined
        providers[provider] = {
          ...matching,
          displayName: 'CLIProxyAPI',
          api: 'openai-completions',
          baseURL: `${baseURL}/v1`,
          apiKeyEnv: keyRef(baseURL, 'api'),
          models: models.map((model) => ({ ...matching?.models?.find((item) => item.id === model.id), ...model })),
        }
      }
      return { ...current, providers }
    })
  }

  const handle = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<unknown> => {
    if (endpoint === 'describe') return describe()
    const input = record(payload)
    const baseURL = currentURL()
    const management = async (path: string, method = 'GET', body?: unknown) =>
      (await request(baseURL, `/v8/management/${path}`, 'management', signal, method, body)).data
    if (endpoint === 'providers' || endpoint === 'provider-add') {
      const snapshot = await request(baseURL, '/v8/management/config', 'management', signal)
      if (!snapshot.etag) throw new Error('unavailable')
      const families = record(record(snapshot.data)['api-keys'] ?? {})
      if (endpoint === 'providers') {
        const groups: ProviderView['groups'] = []
        for (const family of providerFamilies) {
          const rows = families[family] ?? []
          if (!Array.isArray(rows)) throw new Error('invalid_response')
          for (const value of rows) {
            const row = record(value)
            if (!Array.isArray(row.keys)) throw new Error('invalid_response')
            groups.push({
              family,
              name: text(row.name),
              keys: row.keys.length,
            })
          }
        }
        return { revision: snapshot.etag, groups } satisfies ProviderView
      }
      if (input.revision !== snapshot.etag) throw new Error('conflict')
      const family = text(input.family)
      if (!(providerFamilies as readonly string[]).includes(family)) throw new Error('invalid')
      const name = text(input.name, 256).trim()
      const apiKey = text(input.apiKey, 16_384).trim()
      if (/[\r\n\0]/.test(apiKey)) throw new Error('invalid')
      const upstreamURL =
        typeof input.baseURL === 'string' && input.baseURL.trim() ? serverURL(input.baseURL.trim()) : undefined
      if (!Array.isArray(input.models) || input.models.length > 500) throw new Error('invalid')
      const models = [...new Set(input.models.map((model) => text(model, 256).trim()))]
      if (family === 'openai-compatibility' && (!upstreamURL || models.length === 0)) throw new Error('invalid')
      const groups = families[family] ?? []
      if (!Array.isArray(groups)) throw new Error('invalid_response')
      if (groups.some((group) => record(group).name === name)) throw new Error('conflict')
      await request(
        baseURL,
        `/v8/management/config/api-keys/${family}`,
        'management',
        signal,
        'PUT',
        [
          ...groups,
          {
            name,
            ...(upstreamURL ? { 'base-url': upstreamURL } : {}),
            keys: [{ 'api-key': apiKey }],
            ...(models.length ? { models: models.map((id) => ({ name: id, alias: id })) } : {}),
          },
        ],
        snapshot.etag
      )
      return null
    }
    if (endpoint === 'save') {
      if (input.revision !== revision()) throw new Error('conflict')
      const nextURL = serverURL(text(input.baseURL, 4096))
      for (const kind of ['apiKey', 'managementKey'] as const) {
        const value = input[kind]
        if (value !== undefined && (typeof value !== 'string' || value.length > 16_384 || /[\r\n\0]/.test(value)))
          throw new Error('invalid')
      }
      const owner = ownerEntry()
      // Withdraw the old route before changing destinations or removing its key.
      // Key rotation at the same destination preserves model capability overrides.
      if (nextURL !== baseURL || (typeof input.apiKey === 'string' && !input.apiKey.trim())) await syncModels(baseURL)
      for (const [field, kind] of [
        ['apiKey', 'api'],
        ['managementKey', 'management'],
      ] as const) {
        const value = input[field]
        if (value === undefined && nextURL === baseURL) continue
        const ref = keyRef(nextURL, kind)
        if (typeof value === 'string' && value.trim()) await ctx.credentials.set(ref, value.trim())
        else await ctx.credentials.unset(ref)
      }
      signal.throwIfAborted()
      await ctx.configEditor.edit(owner, (current) => {
        if (input.revision !== revision()) throw new Error('conflict')
        return { ...current, baseURL: nextURL, revision: randomUUID() }
      })
      sessions.clear()
      return null
    }
    if (endpoint === 'models') {
      const response = record((await request(baseURL, '/v1/models', 'api', signal)).data)
      if (!Array.isArray(response.data)) throw new Error('invalid_response')
      const models = new Map<string, ProxyModel>()
      for (const item of response.data) {
        const row = record(item)
        const id = text(row.id)
        models.set(id, { id, name: typeof row.name === 'string' && row.name.trim() ? row.name : id })
      }
      signal.throwIfAborted()
      await syncModels(baseURL, [...models.values()])
      return [...models.values()]
    }
    if (endpoint === 'quota-list' || endpoint === 'quota-fetch') {
      const getAccounts = async () => {
        const files = record(await management('credentials')).files
        if (!Array.isArray(files)) throw new Error('invalid_response')
        const snapshot = await request(baseURL, '/v8/management/config', 'management', signal)
        if (!snapshot.etag) throw new Error('unavailable')
        return mergeAPIKeyAccounts(files.map(record), snapshot.data, snapshot.etag)
      }
      const accounts = await getAccounts()
      if (endpoint === 'quota-list') {
        return accounts.map(
          (row) =>
            ({
              name: text(row.name),
              provider: typeof row.provider === 'string' ? row.provider : typeof row.type === 'string' ? row.type : '',
              status: '',
              disabled: isDisabled(row.disabled),
              authIndex: typeof row.auth_index === 'string' ? row.auth_index : '',
              editable: row.source === 'file' && row.runtime_only !== true,
              supported: supportsQuota(row),
            }) satisfies QuotaAccount
        )
      }
      const find = (rows: Record<string, unknown>[]) =>
        rows.find((row) => row.name === text(input.name) && row.auth_index === text(input.authIndex))
      const account = find(accounts)
      if (!account || isDisabled(account.disabled)) throw new Error('conflict')
      const connectionRevision = revision()
      const result = await fetchQuota(account, management)
      const current = find(await getAccounts())
      if (
        revision() !== connectionRevision ||
        !current ||
        isDisabled(current.disabled) ||
        current.provider !== account.provider ||
        current.type !== account.type ||
        current.modtime !== account.modtime ||
        current.updated_at !== account.updated_at ||
        current.quotaConfigRevision !== account.quotaConfigRevision
      )
        throw new Error('conflict')
      return result
    }
    if (endpoint === 'management') {
      const files = record(await management('credentials')).files
      const routing = record(await management('config/routing'))
      if (!Array.isArray(files)) throw new Error('invalid_response')
      const retry = record(routing.retry ?? {})['request-retry'] ?? 3
      if (typeof routing.strategy !== 'string' || !Number.isInteger(retry)) throw new Error('invalid_response')
      return {
        accounts: files.map((item) => {
          const row = record(item)
          return {
            name: text(row.name),
            provider: typeof row.provider === 'string' ? row.provider : '',
            status: typeof row.status === 'string' ? row.status : '',
            disabled: row.disabled === true,
            authIndex: typeof row.auth_index === 'string' ? row.auth_index : '',
            editable: row.source === 'file' && row.runtime_only !== true,
          }
        }),
        strategy: routing.strategy,
        requestRetry: retry as number,
      } satisfies ManagementView
    }
    if (endpoint === 'routing') {
      if (
        !['round-robin', 'weighted-round-robin', 'fill-first'].includes(String(input.strategy)) ||
        typeof input.requestRetry !== 'number' ||
        !Number.isSafeInteger(input.requestRetry) ||
        input.requestRetry < 0
      )
        throw new Error('invalid')
      await management('config/routing', 'PATCH', {
        strategy: input.strategy,
        retry: { 'request-retry': input.requestRetry },
      })
      return null
    }
    if (endpoint === 'account') {
      if (typeof input.disabled !== 'boolean') throw new Error('invalid')
      await management('credentials/status', 'PATCH', { name: text(input.name), disabled: input.disabled })
      return null
    }
    if (endpoint === 'reset') {
      await management('routing/cooldown/reset', 'POST', { auth_index: text(input.authIndex) })
      return null
    }
    if (endpoint === 'oauth-start') {
      const selected = text(input.provider)
      if (!(oauthProviders as readonly string[]).includes(selected)) throw new Error('invalid')
      for (const [state, session] of sessions) if (session.expires <= Date.now()) sessions.delete(state)
      if (sessions.size >= 10) throw new Error('busy')
      const response = record(await management(`oauth/auth-url?provider=${encodeURIComponent(selected)}&is_webui=true`))
      const state = text(response.state)
      const url = new URL(text(response.url, 16_384))
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_response')
      sessions.set(state, { provider: selected, baseURL, expires: Date.now() + 30 * 60_000 })
      return {
        provider: selected,
        state,
        url: url.href,
        ...(typeof response.user_code === 'string' ? { userCode: response.user_code } : {}),
      } satisfies OAuthSession
    }
    if (['oauth-status', 'oauth-cancel', 'oauth-callback'].includes(endpoint)) {
      const state = text(input.state)
      const session = sessions.get(state)
      if (!session || session.baseURL !== baseURL || session.expires <= Date.now()) throw new Error('oauth_expired')
      if (endpoint === 'oauth-cancel') {
        await management(`oauth/session?state=${encodeURIComponent(state)}`, 'DELETE')
        sessions.delete(state)
        return null
      }
      if (endpoint === 'oauth-callback') {
        if (input.provider !== session.provider) throw new Error('invalid')
        const redirect = new URL(text(input.redirectURL, 16_384))
        if (!['http:', 'https:'].includes(redirect.protocol) || redirect.searchParams.get('state') !== state)
          throw new Error('invalid')
        await management('oauth/callback', 'POST', { provider: session.provider, state, redirect_url: redirect.href })
        return null
      }
      const response = record(await management(`oauth/status?state=${encodeURIComponent(state)}`))
      if (!['wait', 'ok', 'error'].includes(String(response.status))) throw new Error('invalid_response')
      if (response.status !== 'wait') sessions.delete(state)
      return { status: response.status }
    }
    throw new Error('invalid')
  }

  const errors = new Set([
    'invalid',
    'invalid_response',
    'unavailable',
    'conflict',
    'api_key_missing',
    'management_key_missing',
    'unauthorized',
    'not_found',
    'upstream_failed',
    'unsupported',
    'oauth_expired',
    'busy',
  ])
  for (const endpoint of [
    'describe',
    'save',
    'models',
    'management',
    'providers',
    'provider-add',
    'quota-list',
    'quota-fetch',
    'routing',
    'account',
    'reset',
    'oauth-start',
    'oauth-status',
    'oauth-cancel',
    'oauth-callback',
  ]) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${endpointPrefix}${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            let body
            try {
              body = clientRequestSchema.safeParse(await request.json())
            } catch {
              return new Response('Invalid request', { status: 400 })
            }
            if (!body.success || body.data.method !== `${endpointPrefix}${endpoint}`)
              return new Response('Invalid request', { status: 400 })
            let result
            if (busy)
              result = {
                ok: false,
                error: { code: 'busy', message: 'CLIProxyAPI operation in progress.', details: {} },
              }
            else {
              busy = true
              try {
                result = { ok: true, value: await handle(endpoint, body.data.payload, request.signal) }
              } catch (error) {
                const code = error instanceof Error && errors.has(error.message) ? error.message : 'operation_failed'
                result = {
                  ok: false,
                  error: { code, message: 'CLIProxyAPI operation could not be confirmed.', details: {} },
                }
              } finally {
                busy = false
              }
            }
            return Response.json(
              { type: 'server-response', rpcId: body.data.rpcId, result },
              {
                headers: { 'Cache-Control': 'no-store' },
              }
            )
          },
        }),
      `cli-proxy-api: owner-only ${endpoint}`
    )
  }
}
