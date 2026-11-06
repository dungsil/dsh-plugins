import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { apply } from '../dist/index.js'

async function fixture(t) {
  let tool
  const routes = new Map()
  const effects = [],
    listeners = new Map(),
    sessions = new Map(),
    sockets = []
  let mode = 'danger-full-access'
  let streamAvailable = true
  class Stream extends EventTarget {
    static OPEN = 1
    readyState = 1
    constructor(url) {
      super()
      this.port = Number(new URL(url).port)
      sockets.push(this)
      queueMicrotask(() => this.dispatchEvent(new Event('open')))
    }
    frame(data) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'frame', data }) }))
    }
    send(data) {
      const input = JSON.parse(data)
      const state = [...sessions.values()].find((state) => state.port === this.port)
      // Like Chrome's key event endpoint, reject a whole paste as one key.
      if (input.text?.length >= 4) return
      if (input.type === 'input_keyboard' && input.text) state.text = (state.text ?? '') + input.text
    }
    close() {
      this.readyState = 3
      queueMicrotask(() => this.dispatchEvent(new Event('close')))
    }
  }
  const originalWebSocket = globalThis.WebSocket
  globalThis.WebSocket = Stream
  t.after(() => {
    globalThis.WebSocket = originalWebSocket
  })
  await apply({
    effect: (effect) => effects.push(effect()),
    on: (event, handler) => listeners.set(event, handler),
    logger: { warn: () => {} },
    tools: {
      register: (value) => {
        tool = value
      },
    },
    connection: {
      fetch: {
        register: (value) => {
          routes.set(value.path, value)
          return () => {}
        },
      },
    },
    sandboxPolicy: { resolve: () => ({ mode }) },
    sessionController: { resolveAgent: async (id) => ({ agent: { session: { id } } }) },
    subprocess: {
      resolveExecutable: async () => {
        throw new Error('No executable on PATH')
      },
      spawn(spec) {
        const id = spec.argv[spec.argv.indexOf('--session') + 1]
        const args = spec.argv.slice(spec.argv.indexOf('--json') + 1)
        let state = sessions.get(id)
        if (!state) {
          state = { port: 10000 + sessions.size, url: 'about:blank' }
          sessions.set(id, state)
        }
        let data, error
        if (args[0] === 'open') {
          state.url = args[1]
          data = { url: state.url }
        } else if (args[0] === 'stream') {
          if (streamAvailable) data = { enabled: true, port: state.port }
          else error = 'Stream unavailable'
        } else if (args[0] === 'get') data = args[1] === 'text' ? { text: state.text } : { url: state.url }
        else if (args[0] === 'click') error = 'Element was not found'
        else if (args[0] === 'close') {
          sessions.delete(id)
          data = { closed: true }
        } else data = { snapshot: 'button Submit [ref=e1]' }
        const done =
          args[0] === 'wait'
            ? new Promise((_, reject) =>
                spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true })
              )
            : Promise.resolve({ exitCode: error ? 1 : 0 })
        return {
          done,
          terminate() {},
          waitForExit: async () => {},
          collected: {
            stdout: { readFrom: () => ({ text: JSON.stringify({ success: !error, data, error }), lossy: false }) },
          },
        }
      },
    },
  })
  t.after(async () => {
    for (const dispose of effects.reverse()) await dispose?.()
  })
  return {
    tool,
    sessions,
    sockets,
    listeners,
    setMode(value) {
      mode = value
    },
    setStreamAvailable(value) {
      streamAvailable = value
    },
    execute: (sessionId, command, args = [], signal) =>
      tool.execute({ command, args }, { agent: { session: { id: sessionId } }, signal }),
    async control(sessionId, tabId, action, value) {
      return routes.get('/api/dungsil-agent-browser/control').fetch(
        new Request('http://localhost/api/dungsil-agent-browser/control', {
          method: 'POST',
          body: JSON.stringify({
            type: 'client-request',
            rpcId: 'test-control',
            method: 'dungsil-agent-browser/control',
            payload: { sessionId, tabId, action, value },
          }),
        })
      )
    },
    async view(sessionId, sequence, tabId) {
      const response = await routes.get('/api/dungsil-agent-browser/view').fetch(
        new Request('http://localhost/api/dungsil-agent-browser/view', {
          method: 'POST',
          body: JSON.stringify({
            type: 'client-request',
            rpcId: 'test',
            method: 'dungsil-agent-browser/view',
            payload: { sessionId, sequence, tabId },
          }),
        })
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      return (await response.json()).result.value
    },
  }
}

await test('전역 설치 없이 대화별 브라우저와 화면을 분리하고 변경된 프레임만 전달한다', async (t) => {
  const f = await fixture(t)
  assert.equal((await f.view('a')).status, 'idle')
  assert.equal(f.sessions.size, 0)
  await f.execute('a', 'open', ['https://one.example/'])
  await f.execute('b', 'open', ['https://two.example/'])
  assert.deepEqual(JSON.parse((await f.execute('a', 'get', ['url'])).output), { url: 'https://one.example/' })
  assert.deepEqual(JSON.parse((await f.execute('b', 'get', ['url'])).output), { url: 'https://two.example/' })
  f.sockets[0].frame('YWJj')
  f.sockets[1].frame('ZGVm')
  const a = await f.view('a'),
    b = await f.view('b')
  assert.equal(a.image, 'YWJj')
  assert.equal(b.image, 'ZGVm')
  assert.equal((await f.view('a', a.sequence)).image, undefined)
  assert.equal(a.status, 'live')
  assert.ok(!JSON.stringify(a).includes('10000'))
  f.sockets[0].dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ type: 'command', params: { password: 'private' } }) })
  )
  assert.deepEqual(await f.view('a'), a)
  await f.execute('a', 'close')
  assert.equal((await f.view('a')).image, undefined)
  assert.equal((await f.view('b')).image, 'ZGVm')
  await f.execute('a', 'open', ['https://new.example/'])
  f.sockets.at(-1).frame('bmV3')
  assert.equal((await f.view('a', a.sequence)).image, 'bmV3')
})

await test('브라우저 식별자와 연결을 바꾸는 인자 및 샌드박스 우회를 거부한다', async (t) => {
  const f = await fixture(t)
  for (const args of [
    ['--session', 'other'],
    ['--cdp=9222'],
    ['--config', '/tmp/other.json'],
    ['--namespace', 'other'],
    ['--all'],
    ['-p', 'kernel'],
  ]) {
    await assert.rejects(f.execute('a', 'open', args), /Unsupported browser arguments/)
  }
  await assert.rejects(f.execute('a', 'batch', ['close']), /command/)
  for (const mode of ['read-only', 'workspace-write']) {
    f.setMode(mode)
    await assert.rejects(f.execute('a', 'open', ['https://example.com']), /danger-full-access/)
  }
  assert.equal(f.sessions.size, 0)
})

await test('실패를 도구에 반환하고 스트림 연결이 끊기면 다음 명령에서 재연결한다', async (t) => {
  const f = await fixture(t)
  await f.execute('a', 'open', ['https://example.com'])
  f.sockets[0].frame('YWJj')
  await assert.rejects(f.execute('a', 'click', ['@missing']), /Element was not found/)
  assert.equal((await f.view('a')).image, 'YWJj')
  assert.equal((await f.view('a')).error, 'command_failed')
  await f.execute('a', 'snapshot', ['-i'])
  assert.equal((await f.view('a')).status, 'live')
  assert.equal((await f.view('a')).error, undefined)
  f.sockets[0].close()
  await new Promise(setImmediate)
  assert.equal((await f.view('a')).error, 'stream_failed')
  await f.execute('a', 'snapshot', ['-i'])
  f.sockets.at(-1).frame('YWJj')
  assert.equal((await f.view('a')).status, 'live')
})

await test('취소와 권한 축소는 진행 중인 명령과 소유한 브라우저를 종료한다', async (t) => {
  const f = await fixture(t)
  await f.execute('a', 'open', ['https://example.com'])
  const controller = new AbortController()
  const pending = f.execute('a', 'wait', ['--text', 'never'], controller.signal)
  const rejected = assert.rejects(pending)
  await new Promise(setImmediate)
  await assert.rejects(f.execute('a', 'snapshot', ['-i']), /Another browser command/)
  controller.abort()
  await rejected
  assert.equal(f.sessions.size, 0)
  assert.equal((await f.view('a')).status, 'closed')
  await f.execute('a', 'open', ['https://example.com'])
  f.setMode('workspace-write')
  f.listeners.get('session/event')({ id: 'a' }, { type: 'sandbox/mode' })
  await new Promise(setImmediate)
  assert.equal(f.sessions.size, 0)
  assert.equal((await f.view('a')).image, undefined)
})

await test('화면 연결 실패를 이미 성공한 브라우저 명령의 실패로 반환하지 않는다', async (t) => {
  const f = await fixture(t)
  f.setStreamAvailable(false)
  const output = JSON.parse((await f.execute('a', 'open', ['https://one.example/'])).output)
  assert.deepEqual(output.result, { url: 'https://one.example/' })
  assert.match(output.warning, /Command completed.*Do not repeat/)
  assert.equal((await f.view('a')).error, 'stream_failed')
  f.setStreamAvailable(true)
  assert.deepEqual(JSON.parse((await f.execute('a', 'get', ['url'])).output), { url: 'https://one.example/' })
  f.sockets.at(-1).frame('YWJj')
  assert.equal((await f.view('a')).status, 'live')
})

await test('별도 화면 없이 기존 브라우저 본문을 유지하고 해제하면 원래 제공자를 복원한다', async (t) => {
  const core = new SlotCore()
  const slot = 'sidebar.right.pane.tab'
  const browser = '@deepseek-ai/dsh-client-ui-sidebar-browser'
  core.register({ name: 'root', children: { [slot]: { kind: 'keyed', scope: 'session' } } }, () => null)
  const effects = []
  t.after(() => effects.reverse().forEach((dispose) => dispose?.()))
  let client
  const require = createRequire(import.meta.url)
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          client = factory((id) => (id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id)))
        },
      },
    },
    document: { createElement: () => ({ remove() {} }), head: { append() {} } },
  })
  client.apply({
    get: () => ({}),
    effect: (effect) => effects.push(effect()),
    slots: {
      inject: (_, setup) => effects.push(setup()),
      entries: (key) => core.entries(key),
      subscribe: (key, listener) => core.subscribe(key, listener),
      register: (options, component) => core.register(options, component),
    },
  })
  assert.deepEqual(core.entriesOfSlot(slot), [])
  const Native = () => null
  const mountNative = () => core.register({ name: slot, key: browser }, Native)
  let removeNative = mountNative()
  await new Promise(setImmediate)
  assert.deepEqual(
    core.entriesOfSlot(slot).map((entry) => entry.options.key),
    [browser]
  )
  assert.equal(core.entriesOfSlot(slot)[0].component, Native)
  assert.equal(typeof core.entriesOfSlot(slot)[0].inject, 'function')
  removeNative()
  await new Promise(setImmediate)
  assert.deepEqual(core.entriesOfSlot(slot), [])
  removeNative = mountNative()
  await new Promise(setImmediate)
  for (const dispose of effects.splice(0).reverse()) dispose?.()
  assert.deepEqual(
    core.entriesOfSlot(slot).map((entry) => entry.options.key),
    [browser]
  )
  assert.equal(core.entriesOfSlot(slot)[0].component, Native)
  removeNative()
})

await test('기존 주소창과 사용자 입력이 도구와 같은 페이지를 제어하고 탭을 전환해도 각각의 페이지를 보존한다', async (t) => {
  const f = await fixture(t)
  const control = async (tab, action, value) => {
    const response = await f.control('a', tab, action, value)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).result.ok, true)
  }
  await f.execute('a', 'open', ['https://agent.example/'])
  await control('one', 'activate')
  assert.equal(f.sessions.size, 1)
  await control('one', 'open', 'https://user.example/')
  assert.deepEqual(JSON.parse((await f.execute('a', 'get', ['url'])).output), { url: 'https://user.example/' })
  await control('one', 'input', { type: 'input_keyboard', eventType: 'keyDown', text: '사용자 입력😀' })
  assert.deepEqual(JSON.parse((await f.execute('a', 'get', ['text'])).output), { text: '사용자 입력😀' })
  await control('two', 'activate')
  await control('two', 'open', 'https://second.example/')
  assert.deepEqual(JSON.parse((await f.execute('a', 'get', ['url'])).output), { url: 'https://second.example/' })
  await control('one', 'activate')
  assert.deepEqual(JSON.parse((await f.execute('a', 'get', ['url'])).output), { url: 'https://user.example/' })
  await control('two', 'close')
  assert.equal(f.sessions.size, 1)
  assert.deepEqual(JSON.parse((await f.execute('a', 'get', ['text'])).output), { text: '사용자 입력😀' })
  assert.equal((await f.control('a', 'one', 'input', { type: 'eval', expression: 'bad' })).status, 400)
  f.setMode('workspace-write')
  const blocked = await f.control('a', 'one', 'input', { type: 'input_keyboard', eventType: 'keyDown', text: '차단' })
  assert.deepEqual((await blocked.json()).result, {
    ok: false,
    error: { code: 'permission', message: 'permission', details: {} },
  })
  assert.equal(f.sessions.size, 0)
})
