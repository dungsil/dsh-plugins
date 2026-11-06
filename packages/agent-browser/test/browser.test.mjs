import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../dist/index.js'

async function fixture(t) {
  let tool, route
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
          route = value
          return () => {}
        },
      },
    },
    sandboxPolicy: { resolve: () => ({ mode }) },
    subprocess: {
      resolveExecutable: async () => '/agent-browser',
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
        } else if (args[0] === 'get') data = { url: state.url }
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
    async view(sessionId, sequence) {
      const response = await route.fetch(
        new Request('http://localhost/api/dungsil-agent-browser/view', {
          method: 'POST',
          body: JSON.stringify({
            type: 'client-request',
            rpcId: 'test',
            method: 'dungsil-agent-browser/view',
            payload: { sessionId, sequence },
          }),
        })
      )
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      return (await response.json()).result.value
    },
  }
}

await test('대화별 브라우저와 화면을 분리하고 변경된 프레임만 전달한다', async (t) => {
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
