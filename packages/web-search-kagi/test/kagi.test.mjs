import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }
const ref = credentialRef('KAGI_API_KEY')

async function fixture(t, environment = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-kagi-test-'))
  const path = join(directory, 'credentials.yaml')
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  ctx.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source: 'process', values: environment }]))
  await ctx.plugin(LocalCredentialProvider, { path, watch: false })
  await ctx.plugin(Connection)
  await ctx.plugin(WebRuntime, { searchProvider: 'kagi' })
  await ctx.plugin(plugin)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (endpoint, payload = {}, peer = owner) => {
    const method = `dungsil-kagi/${endpoint}`
    return handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
      }),
      peer
    )
  }
  const view = async () => (await (await rpc('describe')).json()).result.value
  return { ctx, path, rpc, view }
}

await test('saved credentials enable search, stay private, persist, and can be replaced without restarting', async (t) => {
  const h = await fixture(t)
  assert.deepEqual(await h.view(), { configured: false, environment: false, writable: true })
  await assert.rejects(h.ctx.web.search({ query: 'before configuration' }), {
    code: 'WEB_PROVIDER_CREDENTIAL_MISSING',
  })
  const saved = await h.rpc('save', { apiKey: 'saved-kagi-test-key' })
  assert.equal(saved.status, 200)
  assert.equal(saved.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual((await saved.json()).result, {
    ok: true,
    value: { configured: true, environment: false, writable: true },
  })
  assert.equal((await stat(h.path)).mode & 0o777, 0o600)
  const stored = await readFile(h.path, 'utf8')
  assert.ok(stored.includes('saved-kagi-test-key'))
  await h.rpc('save', { apiKey: 'replacement-kagi-test-key' })
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://kagi.com/api/v1/search')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer replacement-kagi-test-key')
    assert.equal(options.redirect, 'error')
    assert.deepEqual(JSON.parse(options.body), { query: '비대칭 검색 query', limit: 2 })
    return Response.json({
      data: {
        search: [
          { url: 'https://a.example/', title: 'First', snippet: 'Excerpt', time: '2026-01-02T03:04:05Z' },
          { url: 'https://b.example/', title: 'Second' },
          { url: 'https://c.example/', title: 'Third' },
        ],
        news: [{ url: 'https://news.example/', title: 'Not a web result' }],
      },
    })
  })
  assert.deepEqual(await h.ctx.web.search({ query: '비대칭 검색 query', maxResults: 2 }), {
    sources: [
      { url: 'https://a.example/', title: 'First', snippet: 'Excerpt', publishedAt: '2026-01-02T03:04:05Z' },
      { url: 'https://b.example/', title: 'Second' },
    ],
    truncated: true,
  })
  const reopened = new Context()
  t.after(() => reopened.fiber.dispose())
  await reopened.plugin(LocalCredentialProvider, { path: h.path, watch: false })
  assert.equal((await reopened.credentials.resolve(ref)).value, 'replacement-kagi-test-key')
})

await test('host environment wins over a different saved key and disables unnecessary key entry', async (t) => {
  const h = await fixture(t, { KAGI_API_KEY: 'environment-kagi-test-key' })
  await h.ctx.credentials.set(ref, 'ignored-stored-test-key')
  assert.deepEqual(await h.view(), { configured: true, environment: true, writable: false })
  assert.equal((await h.rpc('save', { apiKey: 'must-not-be-saved' })).status, 400)
  assert.equal((await h.ctx.credentials.resolve(ref)).value, 'ignored-stored-test-key')
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer environment-kagi-test-key')
    return Response.json({ data: { search: [] } })
  })
  assert.deepEqual(await h.ctx.web.search({ query: 'No matches' }), { sources: [], truncated: false })
})

await test('credential routes reject non-owners and invalid keys without changing storage', async (t) => {
  const h = await fixture(t)
  for (const endpoint of ['describe', 'save']) {
    const response = await h.rpc(
      endpoint,
      { apiKey: 'untrusted-key' },
      {
        principal: { kind: 'shared', sessionId: 'shared-session' },
        interactions: 'answer',
      }
    )
    assert.equal(response.status, 403)
  }
  for (const apiKey of ['', '  ', 'line\nbreak', 42, 'x'.repeat(4097)])
    assert.equal((await h.rpc('save', { apiKey })).status, 400)
  assert.equal((await h.view()).configured, false)
  t.mock.method(h.ctx.credentials, 'set', async () => {
    throw new Error('private-submitted-key')
  })
  const response = await h.rpc('save', { apiKey: 'private-submitted-key' })
  const result = await response.text()
  assert.ok(result.includes('settings_failed'))
  assert.ok(!result.includes('private-submitted-key'))
})

await test('search reports HTTP, malformed response and cancellation errors without leaking secrets', async (t) => {
  const h = await fixture(t, { KAGI_API_KEY: 'private-kagi-test-key' })
  const responses = [
    () => new Response('private-kagi-test-key', { status: 401 }),
    () => new Response('private-kagi-test-key', { status: 429 }),
    () => Response.json({ error: [{ msg: 'private-kagi-test-key' }], data: { search: [] } }),
    () => Response.json({ data: [] }),
    () => Response.json({ data: { search: [null] } }),
    () => new Response('not json: private-kagi-test-key'),
    () => {
      throw new TypeError('private-kagi-test-key')
    },
  ]
  for (const response of responses) {
    const mock = t.mock.method(globalThis, 'fetch', response)
    await assert.rejects(h.ctx.web.search({ query: 'error case' }), (error) => {
      assert.equal(error.code, 'WEB_PROVIDER_ERROR')
      assert.ok(!String(error).includes('private-kagi-test-key'))
      assert.equal(error.cause, undefined)
      return true
    })
    mock.mock.restore()
  }
  const controller = new AbortController()
  controller.abort(new Error('private-kagi-test-key'))
  await assert.rejects(h.ctx.web.search({ query: 'cancelled' }, controller.signal), { code: 'WEB_ABORTED' })
})
