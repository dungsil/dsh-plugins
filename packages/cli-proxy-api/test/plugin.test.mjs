import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import Llm, { BlockAssembler } from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-cliproxy-test-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const requests = []
  let catalog = [{ id: 'custom-alias', name: 'Custom alias' }, { id: 'other-alias' }]
  let rejected = false
  let strategy = 'round-robin'
  let retries = 3
  let disabled = false
  let oauthStatus = 'wait'
  let configVersion = 1
  let configETag = true
  let conflictWrite = false
  let quotaAccounts
  let quotaStatus = 200
  let quotaAfter
  const quotaBodies = new Map()
  const credentialFiles = new Map()
  const providerGroups = {
    gemini: [
      {
        name: 'existing',
        keys: [{ 'api-key': 'private-upstream-secret' }],
        headers: { 'X-Custom': 'keep' },
        priority: 7,
      },
    ],
  }
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : undefined
    requests.push({ url: req.url, method: req.method, body, authorization: req.headers.authorization })
    const send = (value, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (rejected) return send({ error: 'private-upstream-secret' }, 401)
    if (req.url === '/v1/models') return send({ data: catalog })
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const frame = (value) => res.write(`data: ${JSON.stringify(value)}\n\n`)
      if (body.tools?.length) {
        frame({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"query":' } },
                ],
              },
            },
          ],
        })
        frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"proxy"}' } }] } }] })
        frame({
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          usage: { prompt_tokens: 11, completion_tokens: 5 },
        })
      } else {
        frame({ choices: [{ index: 0, delta: { role: 'assistant', content: 'proxy ' } }] })
        frame({ choices: [{ index: 0, delta: { content: 'works' } }] })
        frame({
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 11, completion_tokens: 5 },
        })
      }
      res.end('data: [DONE]\n\n')
      return
    }
    const path = new URL(req.url, 'http://localhost').pathname
    if (path === '/v8/management/config') {
      if (configETag) res.setHeader('ETag', `"${configVersion}"`)
      return send({ 'api-keys': providerGroups, management: { 'secret-key': 'private-management-secret' } })
    }
    if (path.startsWith('/v8/management/config/api-keys/')) {
      if (conflictWrite || req.headers['if-match'] !== `"${configVersion}"`) {
        conflictWrite = false
        return send({ error: 'precondition_failed' }, 412)
      }
      providerGroups[path.split('/').at(-1)] = body
      configVersion++
      return send({ status: 'ok' })
    }
    if (path === '/v8/management/credentials')
      return send({
        files: quotaAccounts ?? [
          {
            name: 'demo.json',
            provider: 'codex',
            auth_index: 'auth-1',
            disabled,
            source: 'file',
            status: 'ready',
            access_token: 'private-upstream-secret',
          },
          { name: 'virtual', provider: 'claude', runtime_only: true, source: 'config', disabled: false },
        ],
      })
    if (path === '/v8/management/credentials/download')
      return send(credentialFiles.get(new URL(req.url, 'http://localhost').searchParams.get('name')) ?? {})
    if (path === '/v8/management/requests/api-call') {
      const result = quotaBodies.get(body.url) ?? {}
      quotaAfter?.()
      return send({ status_code: quotaStatus, body: JSON.stringify(result) })
    }
    if (path.startsWith('/v8/management/plugins/') && path.endsWith('/quota'))
      return send(quotaBodies.get(path), quotaStatus)
    if (path === '/v8/management/config/routing') {
      if (body) {
        strategy = body.strategy
        retries = body.retry['request-retry']
      }
      return send(body ? { status: 'ok' } : { strategy, retry: { 'request-retry': retries, 'max-retry-interval': 30 } })
    }
    if (path === '/v8/management/credentials/status') {
      disabled = body.disabled
      return send({ status: 'ok' })
    }
    if (path === '/v8/management/routing/cooldown/reset') return send({ status: 'ok' })
    if (path === '/v8/management/oauth/auth-url')
      return send({
        url: 'https://auth.example/authorize?state=test-state',
        state: 'test-state',
        user_code: 'TEST-CODE',
      })
    if (path === '/v8/management/oauth/status') return send({ status: oauthStatus })
    if (path === '/v8/management/oauth/callback') {
      oauthStatus = 'ok'
      return send({ status: 'ok' })
    }
    if (path === '/v8/management/oauth/session') return send({ status: 'ok', cancelled: true })
    send({}, 404)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const baseURL = `http://127.0.0.1:${server.address().port}`
  const dir = join(home, 'profiles', 'web')
  initProfile(dir, ['fixture-bundle'])
  const bundle = join(dir, 'node_modules', 'fixture-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"fixture"}')
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  await writeFile(
    join(bundle, 'package.json'),
    JSON.stringify({ name: 'fixture-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } })
  )
  await writeFile(
    join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'editor', name: 'cordis:editor' },
          {
            id: 'llm-pi-ai',
            name: '@deepseek-ai/dsh-llm-pi-ai',
            config: {
              providers: {
                unrelated: { api: 'openai-completions', baseURL: `${baseURL}/v1`, models: [{ id: 'untouched' }] },
              },
            },
          },
          { id: 'dungsil-cli-proxy-api', name: '@dungsil/dsh-plugin-cli-proxy-api' },
        ],
      },
    ])
  )
  const profile = {
    name: 'web',
    dir,
    home,
    cwd: home,
    startedBundles: ['fixture-bundle'],
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  let ctx
  let handler
  const start = async () => {
    ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
      root.provide('profileContext', profile)
      root.loader.builtins.editor = ConfigEditor
      root.loader.internal = {
        version: 'v2',
        import: async (specifier) => (specifier === '@deepseek-ai/dsh-llm-pi-ai' ? PiAi : plugin),
      }
      await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
      await root.plugin(Connection)
      await root.plugin(Llm)
    })
    handler = ctx.connection.createSharedFetchHandler('/api')
  }
  await start()
  t.after(() => ctx.fiber.dispose())
  const rpc = async (endpoint, payload = {}, peer = owner) => {
    const method = `dungsil-cli-proxy-api/${endpoint}`
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
      }),
      peer
    )
    return response.status === 200 ? (await response.json()).result : { status: response.status }
  }
  return {
    get ctx() {
      return ctx
    },
    requests,
    baseURL,
    profile,
    rpc,
    setCatalog(value) {
      catalog = value
    },
    reject(value) {
      rejected = value
    },
    providerGroups,
    quotaBodies,
    credentialFiles,
    setQuotaAccounts(value) {
      quotaAccounts = value
    },
    setQuotaStatus(value) {
      quotaStatus = value
    },
    afterQuota(callback) {
      quotaAfter = callback
    },
    changeConfig() {
      configVersion++
    },
    setConfigETag(value) {
      configETag = value
    },
    conflictWrite() {
      conflictWrite = true
    },
    async save(values = {}) {
      const described = await rpc('describe')
      assert.equal(described.ok, true, JSON.stringify(described))
      const before = described.value
      const saved = await rpc('save', {
        ...before,
        baseURL,
        apiKey: 'test-api-key',
        managementKey: 'test-management-key',
        ...values,
      })
      assert.equal(saved.ok, true, JSON.stringify(saved))
      return saved
    },
    async restart() {
      await ctx.fiber.dispose()
      await start()
    },
  }
}

await test('persists connection and discovered routes, streams text and fragmented tool calls through the official adapter', async (t) => {
  const h = await fixture(t)
  const initial = (await h.rpc('describe')).value
  assert.equal((await h.save()).ok, true)
  assert.equal((await h.rpc('save', { ...initial, baseURL: h.baseURL })).error.code, 'conflict')
  assert.deepEqual(
    (await h.rpc('models')).value.map((model) => model.id),
    ['custom-alias', 'other-alias']
  )
  assert.ok(h.ctx.llm.listProviders().some((item) => item.id === 'cli-proxy-api'))
  assert.equal((await h.ctx.llm.listModels('unrelated'))[0].id, 'untouched')
  const stream = async (tools) => {
    const prepared = await h.ctx.llm.prepareCall({ provider: 'cli-proxy-api', model: 'custom-alias' })
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream({
      ...prepared.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
      ...(tools ? { tools } : {}),
    }))
      assembler.push(chunk)
    return assembler
  }
  assert.deepEqual((await stream()).blocks(), [{ type: 'text', text: 'proxy works' }])
  const tool = await stream([
    {
      name: 'lookup',
      description: 'Find data',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
  ])
  assert.deepEqual(tool.blocks(), [{ type: 'tool-call', id: 'call_1', name: 'lookup', arguments: '{"query":"proxy"}' }])
  assert.equal(tool.finish.kind, 'tool-calls')
  assert.equal(h.requests.find((req) => req.url === '/v1/chat/completions').authorization, 'Bearer test-api-key')
  const entry = h.ctx.configEditor.entries().find((row) => row.options.id === 'llm-pi-ai')
  await h.ctx.configEditor.edit(entry, (current) => ({
    ...current,
    providers: {
      ...current.providers,
      'cli-proxy-api': {
        ...current.providers['cli-proxy-api'],
        models: [{ id: 'custom-alias', contextWindow: 8192, maxTokens: 1234, input: ['text', 'image'] }],
      },
    },
  }))
  assert.equal((await h.rpc('models')).ok, true)
  assert.equal((await h.save({ apiKey: 'rotated-api-key' })).ok, true)
  const resolved = await h.ctx.llm.resolveModelInfo('cli-proxy-api', 'custom-alias')
  assert.equal(resolved.context.contextWindow, 8192)
  assert.equal(resolved.defaultMaxTokens, 1234)
  assert.deepEqual(resolved.inputModalities, ['text', 'image'])
  await stream()
  assert.equal(h.requests.at(-1).authorization, 'Bearer rotated-api-key')
  const persisted = await readFile(h.profile.patchPath, 'utf8')
  assert.equal(persisted.includes('test-api-key'), false)
  assert.equal(persisted.includes('test-management-key'), false)
  assert.equal(persisted.includes('rotated-api-key'), false)
  await h.restart()
  assert.equal((await h.rpc('describe')).value.apiKeySaved, true)
  assert.equal((await h.ctx.llm.listModels('cli-proxy-api')).length, 2)
  h.reject(true)
  const failure = await h.rpc('models')
  assert.equal(failure.error.code, 'unauthorized')
  assert.equal(JSON.stringify(failure).includes('private-upstream-secret'), false)
  assert.equal(
    (await h.ctx.llm.listModels('cli-proxy-api')).length,
    2,
    'failed discovery preserves the working catalog'
  )
  h.reject(false)
  h.setCatalog([])
  assert.deepEqual((await h.rpc('models')).value, [])
  assert.equal(
    h.ctx.llm.listProviders().some((item) => item.id === 'cli-proxy-api'),
    false
  )
})

await test('management stays owner-only, separates keys, filters credentials and validates OAuth state', async (t) => {
  const h = await fixture(t)
  assert.equal((await h.save()).ok, true)
  const denied = await h.rpc('management', {}, { principal: { kind: 'anonymous' }, interactions: 'none' })
  assert.ok(denied.status === 401 || denied.status === 403)
  assert.equal(h.requests.length, 0)
  const view = (await h.rpc('management')).value
  assert.equal(view.accounts[0].editable, true)
  assert.equal(view.accounts[1].editable, false)
  assert.equal(JSON.stringify(view).includes('private-upstream-secret'), false)
  assert.ok(h.requests.every((req) => req.authorization === 'Bearer test-management-key'))
  assert.equal((await h.rpc('routing', { strategy: 'fill-first', requestRetry: -1 })).error.code, 'invalid')
  assert.equal((await h.rpc('routing', { strategy: 'fill-first', requestRetry: 0 })).ok, true)
  assert.equal((await h.rpc('management')).value.requestRetry, 0)
  assert.equal((await h.rpc('account', { name: 'demo.json', disabled: true })).ok, true)
  assert.equal((await h.rpc('management')).value.accounts[0].disabled, true)
  assert.equal((await h.rpc('reset', { authIndex: 'auth-1' })).ok, true)
  const login = (await h.rpc('oauth-start', { provider: 'codex' })).value
  assert.equal(login.userCode, 'TEST-CODE')
  assert.equal((await h.rpc('oauth-status', { state: login.state })).value.status, 'wait')
  assert.equal(
    (await h.rpc('oauth-callback', { ...login, redirectURL: 'http://localhost/callback?state=other&code=x' })).error
      .code,
    'invalid'
  )
  assert.equal(
    (await h.rpc('oauth-callback', { ...login, redirectURL: `http://localhost/callback?state=${login.state}&code=x` }))
      .ok,
    true
  )
  assert.equal((await h.rpc('oauth-status', { state: login.state })).value.status, 'ok')
  assert.equal((await h.rpc('oauth-status', { state: login.state })).error.code, 'oauth_expired')
  const second = (await h.rpc('oauth-start', { provider: 'claude' })).value
  assert.equal((await h.rpc('oauth-cancel', { state: second.state })).ok, true)
  assert.equal((await h.rpc('oauth-status', { state: second.state })).error.code, 'oauth_expired')
})

await test('changing endpoints never forwards old credentials and rejects unsafe URLs before making requests', async (t) => {
  const h = await fixture(t)
  assert.equal((await h.save()).ok, true)
  assert.equal((await h.rpc('models')).ok, true)
  let before = (await h.rpc('describe')).value
  assert.equal((await h.rpc('save', { ...before, baseURL: 'http://remote.example' })).error.code, 'invalid')
  assert.equal(
    (await h.rpc('save', { ...before, baseURL: 'https://user:password@remote.example' })).error.code,
    'invalid'
  )
  assert.equal((await h.rpc('describe')).value.baseURL, h.baseURL)
  assert.equal((await h.rpc('save', { ...before, baseURL: 'https://remote.example' })).ok, true)
  before = (await h.rpc('describe')).value
  assert.equal(before.apiKeySaved, false)
  assert.equal(before.managementKeySaved, false)
  const count = h.requests.length
  assert.equal((await h.rpc('models')).error.code, 'api_key_missing')
  assert.equal((await h.rpc('management')).error.code, 'management_key_missing')
  assert.equal(h.requests.length, count)
  assert.equal(
    h.ctx.llm.listProviders().some((item) => item.id === 'cli-proxy-api'),
    false
  )
})

await test('registers provider API keys without exposing secrets or overwriting existing groups and concurrent edits', async (t) => {
  const h = await fixture(t)
  await h.save()
  let view = (await h.rpc('providers')).value
  assert.equal(view.groups[0].name, 'existing')
  assert.equal(JSON.stringify(view).includes('private-'), false)
  const existing = structuredClone(h.providerGroups.gemini[0])
  const payload = {
    revision: view.revision,
    family: 'gemini',
    name: 'new-gemini',
    apiKey: 'registered-secret',
    baseURL: '',
    models: [],
  }
  assert.equal((await h.rpc('provider-add', payload)).ok, true)
  assert.deepEqual(h.providerGroups.gemini[0], existing)
  assert.deepEqual(h.providerGroups.gemini[1], { name: 'new-gemini', keys: [{ 'api-key': 'registered-secret' }] })
  view = (await h.rpc('providers')).value
  assert.equal(JSON.stringify(view).includes('registered-secret'), false)
  h.changeConfig()
  assert.equal(
    (await h.rpc('provider-add', { ...payload, name: 'stale', revision: view.revision })).error.code,
    'conflict'
  )
  view = (await h.rpc('providers')).value
  h.conflictWrite()
  assert.equal(
    (await h.rpc('provider-add', { ...payload, name: 'raced', revision: view.revision })).error.code,
    'conflict'
  )
  assert.equal(h.providerGroups.gemini.length, 2)
  for (const family of ['interactions', 'codex', 'meta', 'xai', 'claude', 'vertex', 'openai-compatibility']) {
    view = (await h.rpc('providers')).value
    const added = await h.rpc('provider-add', {
      ...payload,
      family,
      name: family,
      revision: view.revision,
      baseURL: 'https://upstream.example/v1',
      models: ['model-b', 'model-a'],
    })
    assert.equal(added.ok, true, JSON.stringify(added))
    assert.deepEqual(h.providerGroups[family][0].models, [
      { name: 'model-b', alias: 'model-b' },
      { name: 'model-a', alias: 'model-a' },
    ])
  }
  const denied = await h.rpc('providers', {}, { principal: { kind: 'anonymous' }, interactions: 'none' })
  assert.ok(denied.status === 401 || denied.status === 403)
})

await test('quota lookup normalizes observations, distinguishes exhausted from unknown and rejects stale or unauthorized accounts', async (t) => {
  const h = await fixture(t)
  await h.save()
  const codex = {
    name: 'codex.json',
    provider: 'codex',
    auth_index: 'c',
    source: 'file',
    access_token: 'private-token',
  }
  const external = {
    name: 'plugin.json',
    provider: 'codex',
    auth_index: 'p',
    supports_quota: true,
    quota_plugin_id: 'fixture',
  }
  h.setQuotaAccounts([codex, external, { name: 'unknown.json', provider: 'gemini', auth_index: 'u' }])
  h.quotaBodies.set('https://chatgpt.com/backend-api/wham/usage', {
    plan_type: 'pro',
    rate_limit: {
      primary_window: { used_percent: 72, limit_window_seconds: 604800, reset_at: 4070926800 },
      secondary_window: { used_percent: null },
    },
    access_token: 'private-token',
  })
  h.quotaBodies.set('/v8/management/plugins/fixture/quota', {
    groups: [
      {
        displayName: 'Requests',
        buckets: [
          { window: '5h', remainingFraction: 0, resetTime: '2099-01-01T05:00:00Z' },
          { window: 'unknown', remainingFraction: null },
        ],
      },
    ],
    api_key: 'private-token',
  })
  const denied = await h.rpc(
    'quota-fetch',
    { name: codex.name, authIndex: 'c' },
    { principal: { kind: 'anonymous' }, interactions: 'none' }
  )
  assert.ok(denied.status === 401 || denied.status === 403)
  assert.equal(h.requests.length, 0)
  const accounts = (await h.rpc('quota-list')).value
  assert.deepEqual(
    accounts.map((account) => account.supported),
    [true, true, false]
  )
  assert.equal(JSON.stringify(accounts).includes('private-token'), false)
  let result = await h.rpc('quota-fetch', { name: codex.name, authIndex: 'c', url: 'https://evil.example' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.plan, 'pro')
  assert.equal(result.value.windows[0].usedPercent, 72)
  assert.equal(result.value.windows[0].periodSeconds, 604800)
  assert.equal(result.value.windows[0].resetAt, '2099-01-01T05:00:00.000Z')
  assert.equal(result.value.windows.find((window) => window.id === 'secondary_window')?.usedPercent, undefined)
  result = await h.rpc('quota-fetch', { name: external.name, authIndex: 'p' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.windows[0].usedPercent, 100)
  assert.equal(result.value.windows.find((window) => window.id.includes('unknown'))?.usedPercent, undefined)
  assert.equal(JSON.stringify(result).includes('private-token'), false)
  assert.equal(
    h.requests.some((request) => request.body?.auth_index === 'p' && request.url.includes('api-call')),
    false
  )
  h.setQuotaStatus(429)
  result = await h.rpc('quota-fetch', { name: codex.name, authIndex: 'c' })
  assert.equal(result.error.code, 'upstream_failed')
  assert.equal(JSON.stringify(result).includes('private-token'), false)
  h.setQuotaStatus(200)
  h.afterQuota(() => h.setQuotaAccounts([{ ...codex, auth_index: 'rotated' }]))
  assert.equal((await h.rpc('quota-fetch', { name: codex.name, authIndex: 'c' })).error.code, 'conflict')
  const count = h.requests.filter((request) => request.url.includes('api-call')).length
  assert.equal((await h.rpc('quota-fetch', { name: codex.name, authIndex: 'c' })).error.code, 'conflict')
  assert.equal(h.requests.filter((request) => request.url.includes('api-call')).length, count)
  assert.equal(
    h.requests.some((request) => /credentials\/refresh|cooldown|consume|chat\/completions/.test(request.url)),
    false
  )
  assert.equal(
    h.requests.some((request) => request.body?.url === 'https://evil.example'),
    false
  )
})

await test('native quota providers keep credential downloads server-side and use only their fixed read-only endpoints', async (t) => {
  const h = await fixture(t)
  await h.save()
  const cases = [
    {
      provider: 'claude',
      url: 'https://api.anthropic.com/api/oauth/usage',
      payload: { five_hour: { utilization: 31, resets_at: '2099-01-01T05:00:00Z' } },
      usedPercent: 31,
    },
    {
      provider: 'antigravity',
      url: 'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
      payload: { groups: [{ displayName: 'Fixture model', buckets: [{ remainingFraction: 0.35, window: '5h' }] }] },
      usedPercent: 65,
    },
    {
      provider: 'kimi-ai',
      url: 'https://api.kimi.ai/coding/v1/usages',
      payload: {
        limits: [
          {
            detail: { limit: '100', used: '5', remaining: '95', resetTime: '2099-01-01T05:00:00Z' },
            window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
          },
        ],
        usages: { limit_month_total: { used_ratio: 0.2529 } },
      },
      usedPercent: 5,
    },
    {
      provider: 'devin',
      url: 'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus',
      payload: {
        userStatus: {
          planStatus: {
            dailyQuotaRemainingPercent: 75,
            weeklyQuotaRemainingPercent: 50,
            planInfo: { planName: 'Fixture plan' },
          },
        },
      },
      usedPercent: 25,
    },
    {
      provider: 'meta',
      url: 'https://api.meta.ai/muse-code/key',
      payload: {
        api_key: 'must-not-leak',
        user_email: 'private@example.invalid',
        subs_tier_name: 'Fixture plan',
        subs_usage: { window: { used_percent: 19, window_duration_mins: 300, resets_at: 4070926800 } },
      },
      usedPercent: 19,
    },
    {
      provider: 'xai',
      url: 'https://cli-chat-proxy.grok.com/v1/billing?format=credits',
      payload: { config: { currentPeriod: { type: 'weekly', end: '2099-01-08T00:00:00Z' }, creditUsagePercent: 37 } },
      usedPercent: 37,
    },
  ]
  for (const { provider, url, payload, usedPercent } of cases) {
    const account = {
      name: `${provider}.json`,
      provider,
      auth_index: provider,
      source: 'file',
      project_id: 'fixture-project',
    }
    h.setQuotaAccounts([account])
    h.credentialFiles.set(account.name, {
      domain: 'ai',
      base_url: 'https://evil.example',
      project_id: 'fixture-project',
      dca_token: 'dca:must-not-leak',
      access_token: 'must-not-leak',
    })
    h.quotaBodies.set(url, payload)
    if (provider === 'xai') h.quotaBodies.set('https://cli-chat-proxy.grok.com/v1/billing', payload)
    const result = await h.rpc('quota-fetch', { name: account.name, authIndex: provider })
    assert.equal(result.ok, true, `${provider}: ${JSON.stringify(result)}`)
    assert.ok(
      result.value.windows.some((window) => Math.abs(window.usedPercent - usedPercent) < 0.001),
      `${provider}: ${JSON.stringify(result)}`
    )
    assert.equal(/must-not-leak|private@example/.test(JSON.stringify(result)), false)
    if (provider === 'kimi-ai')
      assert.ok(result.value.windows.some((window) => Math.abs(window.usedPercent - 25.29) < 0.001))
  }
  const meta = h.requests.find((request) => request.body?.url === 'https://api.meta.ai/muse-code/key')
  assert.equal(meta.body.header.Authorization, 'Bearer dca:must-not-leak')
  const devin = h.requests.find((request) => request.body?.url?.endsWith('/GetUserStatus'))
  assert.equal(JSON.parse(devin.body.data).metadata.apiKey, '$TOKEN$')
  assert.equal(
    h.requests.some((request) => request.body?.url?.includes('evil.example')),
    false
  )
  assert.equal(
    h.requests.some((request) =>
      /chat\/completions|consume|credentials\/refresh|cooldown/.test(request.body?.url ?? request.url)
    ),
    false
  )
})

await test('API-key quota accounts merge config with credentials and project only display fields', async (t) => {
  const h = await fixture(t)
  await h.save()
  h.setQuotaAccounts([
    { name: 'oauth.json', provider: 'codex', auth_index: 'oauth', source: 'file' },
    {
      name: 'runtime-go',
      provider: 'openai-compatible-custom',
      auth_index: 'go',
      runtime_only: true,
      supports_quota: true,
      quota_plugin_id: 'unrelated-plugin',
    },
  ])
  h.providerGroups['openai-compatibility'] = [
    {
      name: 'Custom Go',
      'base-url': 'https://opencode.ai/zen/go/v1',
      headers: { Authorization: 'private-custom-header' },
      keys: [
        { 'api-key': 'private-go-key', auth_index: 'go' },
        { 'api-key': 'private-go-key-2', auth_index: 'go-2' },
      ],
    },
    {
      name: 'Custom Ollama',
      'base-url': 'https://ollama.com/v1',
      keys: [{ 'api-key': 'private-ollama-key', auth_index: 'ollama' }],
    },
  ]
  h.quotaBodies.set('https://opencode.ai/zen/go/v1/usage', {
    usage: {
      rolling: { percent: 1, resetsAt: '2099-01-01T05:00:00Z' },
      weekly: { percent: 100, resetsAt: '2099-01-08T00:00:00Z' },
      monthly: { percent: 32 },
    },
    token: 'private-go-key',
  })
  h.quotaBodies.set('https://ollama.com/api/balance', {
    included: {
      balance_usd: 72.5,
      allowance_usd: 100,
      period: { from: '2099-01-01T00:00:00Z', until: '2099-02-01T00:00:00Z' },
    },
    purchased: { balance_usd: 25 },
    token: 'private-ollama-key',
  })
  const accounts = (await h.rpc('quota-list')).value
  assert.equal(accounts.length, 4)
  assert.equal(accounts.filter((row) => row.authIndex === 'go').length, 1)
  assert.deepEqual(
    accounts.map((row) => row.provider),
    ['codex', 'opencode-go', 'opencode-go', 'ollama-cloud']
  )
  assert.equal(accounts[1].name, 'Custom Go · 1')
  assert.ok(accounts.every((row) => row.supported))
  assert.ok(accounts.slice(1).every((row) => !row.editable))
  assert.equal(/private-|quotaConfigRevision|base-url|headers/.test(JSON.stringify(accounts)), false)
  const go = await h.rpc('quota-fetch', { name: accounts[1].name, authIndex: 'go', url: 'https://evil.example' })
  assert.equal(go.ok, true, JSON.stringify(go))
  assert.deepEqual(
    go.value.windows.map((row) => row.usedPercent),
    [1, 100, 32]
  )
  assert.equal(go.value.windows[0].periodSeconds, 18000)
  assert.equal(go.value.windows[2].periodSeconds, undefined)
  const ollama = await h.rpc('quota-fetch', { name: accounts[3].name, authIndex: 'ollama' })
  assert.equal(ollama.ok, true, JSON.stringify(ollama))
  assert.equal(ollama.value.windows.length, 1)
  assert.ok(Math.abs(ollama.value.windows[0].usedPercent - 27.5) < 0.001)
  assert.equal(ollama.value.windows[0].resetAt, '2099-02-01T00:00:00.000Z')
  assert.equal(/private-/.test(JSON.stringify([go, ollama])), false)
  const calls = h.requests.filter((row) => row.url.endsWith('/requests/api-call'))
  assert.equal(calls.length, 2)
  assert.ok(calls.every((row) => row.body.method === 'GET' && row.body.header.Authorization === 'Bearer $TOKEN$'))
  assert.ok(calls.every((row) => !row.body.data && !row.body.header.Host && !row.body.proxy_url))
  assert.equal(/private-|evil/.test(JSON.stringify(calls.map((row) => row.body))), false)
  assert.equal(
    h.requests.some((row) => /credentials\/download|cooldown|consume|chat\/completions/.test(row.url)),
    false
  )
})

await test('API-key quota endpoint allowlist accepts official bases without name-based credential forwarding', async (t) => {
  const h = await fixture(t)
  await h.save()
  h.setQuotaAccounts([])
  const accepted = [
    'https://opencode.ai/zen/go/v1/',
    'https://opencode.ai/inference/go/openai/v1',
    'https://opencode.ai/inference/go/anthropic/v1',
    'https://opencode.ai/inference/go/google/v1beta',
    'https://ollama.com',
    'https://ollama.com/api/',
    'https://ollama.com/v1',
  ]
  const rejected = [
    'http://opencode.ai/zen/go/v1',
    'https://opencode.ai.evil.example/zen/go/v1',
    'https://evil.example/zen/go/v1',
    'https://opencode.ai/zen/v1',
    'https://opencode.ai/zen/go/v1?token=private-key',
    'https://private-key@ollama.com/v1',
    'https://ollama.com:8443/v1',
    'https://ollama.com/v1#private-key',
    'https://ollama.com.evil.example/v1',
    'https://ollama.com/%76%31',
    'not a url',
  ]
  h.providerGroups['openai-compatibility'] = [...accepted, ...rejected].map((url, i) => ({
    name: 'OpenCode Go Ollama Cloud',
    'base-url': url,
    keys: [{ 'api-key': 'private-key', auth_index: `key-${i}` }],
  }))
  h.providerGroups.claude = [
    {
      name: 'Anthropic Go',
      'base-url': 'https://opencode.ai/inference/go/anthropic/v1',
      keys: [{ 'api-key': 'private-key', auth_index: 'claude-go' }],
    },
  ]
  const accounts = (await h.rpc('quota-list')).value
  assert.equal(accounts.length, accepted.length + 1)
  assert.equal(accounts.find((row) => row.authIndex === 'claude-go').provider, 'opencode-go')
  assert.equal(JSON.stringify(accounts).includes('private-key'), false)
  assert.equal(
    h.requests.some((row) => row.url.endsWith('/requests/api-call')),
    false
  )
  for (let i = accepted.length; i < accepted.length + rejected.length; i++) {
    const result = await h.rpc('quota-fetch', { name: 'OpenCode Go Ollama Cloud · 1', authIndex: `key-${i}` })
    assert.equal(result.error.code, 'conflict')
  }
})

await test('API-key quota handles Ollama legacy limits, unknown values and upstream errors', async (t) => {
  const h = await fixture(t)
  await h.save()
  h.setQuotaAccounts([])
  h.providerGroups['openai-compatibility'] = [
    {
      name: 'Ollama',
      'base-url': 'https://ollama.com/v1',
      keys: [{ 'api-key': 'private-key', auth_index: 'ollama' }],
    },
  ]
  const account = (await h.rpc('quota-list')).value[0]
  const lookup = () => h.rpc('quota-fetch', { name: account.name, authIndex: account.authIndex })
  h.quotaBodies.set('https://ollama.com/api/balance', {
    included: {
      session: { remaining_percent: 75, resets_at: '2099-01-01T05:00:00Z' },
      weekly: { remaining_percent: 0 },
    },
  })
  let result = await lookup()
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(
    result.value.windows.map((row) => row.usedPercent),
    [25, 100]
  )
  assert.equal(result.value.windows[0].periodSeconds, undefined)
  for (const included of [
    { allowance_usd: 0, balance_usd: 0 },
    { allowance_usd: null, balance_usd: null },
    { allowance_usd: 'invalid', balance_usd: 10 },
    { session: { remaining_percent: -1 }, weekly: { remaining_percent: 101 } },
  ]) {
    h.quotaBodies.set('https://ollama.com/api/balance', { included, purchased: { balance_usd: 25 } })
    result = await lookup()
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(result.value.windows.every((row) => row.usedPercent === undefined))
  }
  for (const [balance, expected] of [
    ['72.5', 27.5],
    [0, 100],
    [120, 0],
    [-10, 100],
  ]) {
    h.quotaBodies.set('https://ollama.com/api/balance', { included: { allowance_usd: '100', balance_usd: balance } })
    result = await lookup()
    assert.ok(Math.abs(result.value.windows[0].usedPercent - expected) < 0.001)
  }
  for (const status of [401, 403, 429, 503]) {
    h.setQuotaStatus(status)
    result = await lookup()
    assert.equal(result.error.code, 'upstream_failed')
    assert.equal(JSON.stringify(result).includes('private-key'), false)
  }
})

await test('API-key quota rejects disabled, removed and rotated configuration snapshots', async (t) => {
  const h = await fixture(t)
  await h.save()
  h.setQuotaAccounts([])
  const group = {
    name: 'Go',
    'base-url': 'https://opencode.ai/zen/go/v1',
    keys: [{ 'api-key': 'private-before', auth_index: 'go' }],
  }
  h.providerGroups['openai-compatibility'] = [group]
  h.quotaBodies.set('https://opencode.ai/zen/go/v1/usage', { usage: { rolling: { percent: 50 } } })
  const account = (await h.rpc('quota-list')).value[0]
  const lookup = () => h.rpc('quota-fetch', { name: account.name, authIndex: account.authIndex })
  for (const disabled of [true, 'true', '1', 1]) {
    group.disabled = disabled
    assert.equal((await h.rpc('quota-list')).value[0].supported, false)
    assert.equal((await lookup()).error.code, 'conflict')
  }
  delete group.disabled
  group.keys[0].disabled = true
  assert.equal((await lookup()).error.code, 'conflict')
  delete group.keys[0].disabled
  h.afterQuota(() => {
    group.keys[0]['api-key'] = 'private-after'
    h.changeConfig()
  })
  assert.equal((await lookup()).error.code, 'conflict')
  h.afterQuota(() => {
    group['base-url'] = 'https://evil.example'
    h.changeConfig()
  })
  assert.equal((await lookup()).error.code, 'conflict')
  assert.equal((await lookup()).error.code, 'conflict')
  assert.equal(h.requests.filter((row) => row.url.endsWith('/requests/api-call')).length, 2)
})

await test('API-key quota uses management ETag changes and rejects missing version metadata', async (t) => {
  const h = await fixture(t)
  await h.save()
  h.setQuotaAccounts([])
  h.providerGroups['openai-compatibility'] = [
    {
      name: 'Go',
      'base-url': 'https://opencode.ai/zen/go/v1',
      keys: [{ 'api-key': 'private-key', auth_index: 'go' }],
    },
  ]
  h.quotaBodies.set('https://opencode.ai/zen/go/v1/usage', { usage: { rolling: { percent: 25 } } })
  const account = (await h.rpc('quota-list')).value[0]
  const lookup = () => h.rpc('quota-fetch', { name: account.name, authIndex: account.authIndex })
  h.afterQuota(() => h.changeConfig())
  const stale = await lookup()
  assert.equal(stale.ok, false, JSON.stringify(stale))
  assert.equal(stale.error.code, 'conflict')
  h.afterQuota(undefined)
  const current = await lookup()
  assert.equal(current.ok, true, JSON.stringify(current))
  assert.equal(current.value.windows[0].usedPercent, 25)
  assert.equal(/private-key|quotaConfigRevision/.test(JSON.stringify(current)), false)
  h.setConfigETag(false)
  const calls = h.requests.filter((row) => row.url.endsWith('/requests/api-call')).length
  assert.equal((await h.rpc('quota-list')).error.code, 'unavailable')
  assert.equal((await lookup()).error.code, 'unavailable')
  assert.equal(h.requests.filter((row) => row.url.endsWith('/requests/api-call')).length, calls)
})

await test('API-key quota requires a server auth index and never invents missing OpenCode usage', async (t) => {
  const h = await fixture(t)
  await h.save()
  h.setQuotaAccounts([])
  h.providerGroups['openai-compatibility'] = [
    {
      name: 'Go',
      'base-url': 'https://opencode.ai/zen/go/v1',
      keys: [{ 'api-key': 'private-key' }],
    },
  ]
  let account = (await h.rpc('quota-list')).value[0]
  assert.equal(account.supported, false)
  assert.equal(account.authIndex, '')
  const blocked = await h.rpc('quota-fetch', { name: account.name, authIndex: 'forged' })
  assert.equal(blocked.error.code, 'conflict')
  h.providerGroups['openai-compatibility'][0].keys[0].auth_index = 'go'
  account = (await h.rpc('quota-list')).value[0]
  for (const payload of [
    {},
    { usage: {} },
    { usage: { rolling: null } },
    {
      usage: { rolling: { percent: null }, weekly: { percent: -1 }, monthly: { percent: 101 } },
    },
  ]) {
    h.quotaBodies.set('https://opencode.ai/zen/go/v1/usage', payload)
    const result = await h.rpc('quota-fetch', { name: account.name, authIndex: account.authIndex })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(result.value.windows.every((window) => window.usedPercent === undefined))
    assert.ok(result.value.windows.every((window) => window.resetAt === undefined))
  }
})
