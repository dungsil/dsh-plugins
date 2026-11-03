import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Window } from 'happy-dom'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }
const args = { ref: 'DSH_SECRET_TEST', label: 'Test credential', reason: 'Used by the test DSH provider.' }

async function setup(t, provider) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const directory = await mkdtemp(join(tmpdir(), 'dsh-secret-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'credentials.yaml')
  await ctx.plugin(LocalCredentialProvider, { path, watch: false })
  await ctx.plugin(Connection)
  if (provider) {
    for (const [method, implementation] of Object.entries(provider))
      t.mock.method(ctx.credentials, method, implementation)
  }
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const agent = { session: { id: 'secret-test-session' } }
  ctx.provide('agents', { roots: () => [agent] })
  const fork = ctx.plugin(plugin)
  await fork
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (endpoint, payload = {}, peer = owner) => {
    const method = `dungsil-secrets/${endpoint}`
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'fixture', method, payload }),
      }),
      peer
    )
    if (response.status === 403) return { ok: false, error: { code: 'forbidden' } }
    assert.equal(response.status, 200)
    return (await response.json()).result
  }
  const run = (input = args, signal = new AbortController().signal, caller = agent) =>
    ctx.tools.execute({
      name: 'request_secret',
      callId: 'secret-test-call',
      arguments: input,
      agent: caller,
      signal,
    })
  const next = async () => {
    for (let i = 0; i < 100; i++) {
      const response = await rpc('pending')
      if (response.value.length) return response.value[0]
      await delay(5)
    }
    assert.fail('No private input request appeared')
  }
  return { ctx, fork, rpc, run, next, path }
}

await test('stores exact input privately and returns only reference/status through the tool runtime', async (t) => {
  const h = await setup(t)
  assert.equal((await h.run()).value.status, 'unavailable')
  await h.rpc('pending')
  const seen = []
  h.ctx.on('tools/result', (_exec, result) => {
    seen.push(result)
  })
  const running = h.run()
  const request = await h.next()
  assert.equal(request.configured, false)
  const secret = '  synthetic-$value-한글-"\\  '
  const answer = await h.rpc('answer', { id: request.id, action: 'save', value: secret })
  assert.deepEqual(answer, { ok: true, value: null })
  const result = await running
  assert.equal(result.isError, false)
  assert.deepEqual(result.value, { status: 'saved', ref: args.ref })
  assert.deepEqual(JSON.parse(result.content[0].text), result.value)
  assert.equal((await h.ctx.credentials.resolve(credentialRef(args.ref))).value, secret)
  assert.equal((await stat(h.path)).mode & 0o777, 0o600)
  assert.ok(!JSON.stringify([request, answer, result, seen]).includes('synthetic-$value-'))
  assert.deepEqual((await h.rpc('pending')).value, [])
  assert.equal((await h.rpc('answer', { id: request.id, action: 'save', value: 'overwrite' })).ok, false)

  const declined = h.run()
  const replacement = await h.next()
  assert.equal(replacement.configured, true)
  await h.rpc('answer', { id: replacement.id, action: 'decline' })
  assert.equal((await declined).value.status, 'declined')
  assert.equal((await h.ctx.credentials.resolve(credentialRef(args.ref))).value, secret)
  await h.fork.dispose()
  assert.equal(h.ctx.tools.get('request_secret'), undefined)
  // Reloading does not remove stored credentials or duplicate tool registrations.
  await h.ctx.plugin(plugin)
  assert.ok(h.ctx.tools.get('request_secret'))
  assert.equal((await h.ctx.credentials.resolve(credentialRef(args.ref))).value, secret)
})

await test('rejects unauthorized, malformed and late answers; cancellation and timeout never write', async (t) => {
  const h = await setup(t)
  for (const peer of [
    { principal: { kind: 'session', sessionId: 'secret-test-session' }, interactions: 'answer' },
    { principal: { kind: 'observer' }, interactions: 'none' },
  ]) {
    assert.equal((await h.rpc('pending', {}, peer)).error.code, 'forbidden')
  }
  await h.rpc('pending')
  assert.equal((await h.run(args, undefined, { session: { id: 'child' } })).value.status, 'unavailable')
  assert.equal((await h.run({ ...args, ref: '../invalid' })).isError, true)
  assert.equal((await h.run({ ...args, timeout_ms: 999 })).isError, true)
  const abort = new AbortController()
  const cancelled = h.run(args, abort.signal)
  const request = await h.next()
  for (const value of ['', 23, 'x'.repeat(65_537)]) {
    assert.equal((await h.rpc('answer', { id: request.id, action: 'save', value })).ok, false)
  }
  assert.equal((await h.run()).isError, true)
  abort.abort()
  assert.equal((await cancelled).isError, true)
  assert.deepEqual((await h.rpc('pending')).value, [])
  assert.equal((await h.rpc('answer', { id: request.id, action: 'save', value: 'too-late' })).ok, false)
  const timed = h.run({ ...args, timeout_ms: 1000 })
  await h.next()
  // Keep a real timer alive: the plugin's deadline intentionally does not hold Node open.
  await delay(1100)
  assert.equal((await timed).value.status, 'timed_out')
  assert.equal(await h.ctx.credentials.resolve(credentialRef(args.ref)), undefined)
  const unloaded = h.run()
  await h.next()
  await h.fork.dispose()
  assert.equal((await unloaded).value.status, 'cancelled')
})

await test('sanitizes storage failures and admits only one concurrent save, including cancellation during a write', async (t) => {
  const secret = 'synthetic-provider-error-secret'
  let release
  let stored
  let fail = true
  const h = await setup(t, {
    describe: async () => ({ configured: false, writable: true }),
    set: async (_ref, value) => {
      if (fail) throw new Error(`Provider echoed ${value}`)
      await new Promise((resolve) => {
        release = resolve
      })
      stored = value
    },
  })
  await h.rpc('pending')
  const abort = new AbortController()
  const running = h.run(args, abort.signal)
  const request = await h.next()
  const rejected = await h.rpc('answer', { id: request.id, action: 'save', value: secret })
  assert.equal(rejected.error.code, 'save_failed')
  assert.ok(!JSON.stringify(rejected).includes(secret))
  fail = false
  const first = h.rpc('answer', { id: request.id, action: 'save', value: secret })
  await delay(0)
  const second = await h.rpc('answer', { id: request.id, action: 'save', value: 'wrong-winner' })
  assert.equal(second.error.code, 'closed')
  abort.abort()
  release()
  assert.equal((await first).ok, true)
  const result = await running
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.equal(stored, secret)
  assert.deepEqual((await h.rpc('pending')).value, [])
})

await test('inline card isolates sessions and calls, clears private input and retains only the settled status', async (t) => {
  const window = new Window()
  const previous = Object.getOwnPropertyDescriptors(globalThis)
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const require = createRequire(import.meta.url)
  let client
  window.__ModuleLoader__ = {
    load: ({ factory }) => {
      client = factory(require)
    },
  }
  new Function('window', await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'))(window)
  const h = await setup(t)
  const clientCtx = new Context()
  const document = window.document
  document.body.innerHTML = '<main></main><textarea aria-label="Chat composer"></textarea>'
  const container = document.querySelector('main')
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => {
      root.unmount()
      await clientCtx.fiber.dispose()
    })
    await window.happyDOM.close()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
      else delete globalThis[key]
    }
  })
  let Card
  clientCtx.provide('slots', {
    inject: (_slot, register) => register(),
    register: (_options, component) => {
      Card = component
      return () => {}
    },
  })
  let fail = true
  clientCtx.provide('locale', { getSnapshot: () => ({ active: 'ko' }) })
  clientCtx.provide('connection', {
    interactions: 'answer',
    rpc: {
      call: (_channel, endpoint, payload) => {
        if (endpoint === 'dungsil-secrets/answer' && fail) return Promise.reject(new Error(`echo ${payload.value}`))
        return h.rpc(endpoint.replace('dungsil-secrets/', ''), payload)
      },
    },
  })
  await clientCtx.plugin(client)
  await h.rpc('pending')
  const running = h.run({ ...args, label: '<script>no HTML</script>' })
  const request = await h.next()
  await delay(1100)
  const props = {
    sessionId: request.sessionId,
    callId: request.callId,
    phase: 'start',
    block: { args: { text: (key) => args[key] } },
  }
  const render = async (overrides = {}) => {
    await act(async () => {
      root.render(createElement(Card, { ...props, ...overrides }))
    })
  }
  await render({ sessionId: 'another-session' })
  assert.equal(container.querySelector('input'), null)
  await render({ callId: 'another-call' })
  assert.equal(container.querySelector('input'), null)
  await render()
  assert.equal(document.querySelector('dialog'), null)
  assert.equal(container.querySelector('script'), null)
  assert.equal(container.querySelector('h3').textContent, '<script>no HTML</script>')
  assert.equal(container.querySelector('p').textContent, args.reason)
  assert.equal(container.textContent, `<script>no HTML</script>${args.reason}거절비밀값 저장`)
  let input = container.querySelector('input')
  assert.equal(input.type, 'password')
  assert.equal(container.querySelector('button[type=submit]').disabled, true)
  const enter = async () => {
    await act(async () => {
      input.value = 'synthetic-browser-secret'
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  }
  const submit = async () => {
    await act(async () => {
      container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      await delay(10)
    })
  }
  await enter()
  // Leaving the session removes its input without moving its value into another card.
  await render({ sessionId: 'another-session' })
  assert.equal(input.value, '')
  await render()
  input = container.querySelector('input')
  await enter()
  await submit()
  assert.equal(input.value, '')
  assert.equal(document.activeElement, input)
  assert.ok(container.querySelector('[role=alert]').textContent.includes('저장 여부'))
  assert.ok(!document.body.textContent.includes('synthetic-browser-secret'))
  assert.equal(document.querySelector('textarea').value, '')
  fail = false
  await enter()
  await submit()
  const result = await running
  assert.equal(result.value.status, 'saved')
  assert.equal(container.querySelector('input'), null)
  assert.ok(container.textContent.includes('비밀값을 저장했습니다.'))
  assert.equal(input.value, '')
  // A remounted historical row uses the durable tool result, never a stored value.
  await render({ key: 'history', phase: 'result', block: { ...props.block, ...result } })
  assert.equal(container.querySelector('input'), null)
  assert.ok(container.textContent.includes('비밀값을 저장했습니다.'))
  const declined = h.run()
  await h.next()
  await act(async () => {
    await delay(1100)
  })
  await render({ key: 'next' })
  await act(async () => {
    container.querySelector('button[type=button]').click()
    await delay(10)
  })
  assert.equal((await declined).value.status, 'declined')
  assert.ok(container.textContent.includes('요청을 거절했습니다.'))
  await render({
    key: 'expired',
    phase: 'result',
    block: { ...props.block, content: [{ type: 'text', text: '{"status":"timed_out"}' }] },
  })
  assert.ok(container.textContent.includes('입력 시간이 만료되었습니다.'))
  assert.equal(container.querySelector('input'), null)
})
