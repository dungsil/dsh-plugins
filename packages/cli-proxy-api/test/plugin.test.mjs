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
    if (path === '/v8/management/credentials')
      return send({
        files: [
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
