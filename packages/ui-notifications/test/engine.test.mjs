import assert from 'node:assert/strict'
import test from 'node:test'
import { createEngine, RELEASE_GRACE_MS, SETTLE_MS } from '../src/engine.ts'

function store(value) {
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

/** Fakes the DSH list, status map, connection state, event windows and timers. */
function environment({ connected = true, pending = {}, running = {} } = {}) {
  const ids = ['a', 'b']
  const rows = (runningMap) => Object.fromEntries(ids.map((id) => [id, { running: runningMap[id] ?? false }]))
  const list = store({ ids, byId: rows(running), phase: 'ready' })
  const statusOf = (pendingMap, runningMap) =>
    new Map(
      ids.map((id) => [
        id,
        {
          running: runningMap[id] ?? false,
          pendingInteraction: pendingMap[id] && { key: pendingMap[id].key, kind: pendingMap[id].kind, sessionId: id },
        },
      ])
    )
  let currentPending = pending
  let currentRunning = running
  const status = store(statusOf(pending, running))
  const connection = store(connected ? 'connected' : 'connecting')
  const timers = []
  const emitted = []
  const withdrawn = []
  const watches = new Map()
  const engine = createEngine({
    list,
    status,
    connection,
    watch(id) {
      const source = store({ change: { kind: 'replace', entries: [] } })
      let resolve, reject
      const ready = new Promise((ok, fail) => {
        resolve = ok
        reject = fail
      })
      const entry = { source, released: false, resolve: () => resolve({ eventSource: source }), reject }
      watches.set(id, entry)
      return { ready, release: () => (entry.released = true) }
    },
    emit: (event) => emitted.push(event),
    withdraw: (key) => withdrawn.push(key),
    schedule(callback, delay) {
      const timer = { callback, delay, cancelled: false }
      timers.push(timer)
      return () => (timer.cancelled = true)
    },
  })
  return {
    engine,
    emitted,
    withdrawn,
    watches,
    connection,
    flush(delay) {
      for (const timer of timers.splice(0)) {
        if (timer.cancelled) continue
        if (timer.delay === delay) timer.callback()
        else timers.push(timer)
      }
    },
    setPending(next) {
      currentPending = next
      status.set(statusOf(currentPending, currentRunning))
    },
    setRunning(next) {
      currentRunning = next
      list.set({ ids, byId: rows(next), phase: 'ready' })
      status.set(statusOf(currentPending, currentRunning))
    },
    append(id, ...events) {
      watches.get(id).source.set({ change: { kind: 'append', entries: events.map((event) => ({ event })) } })
    },
    replace(id, ...events) {
      watches.get(id).source.set({ change: { kind: 'replace', entries: events.map((event) => ({ event })) } })
    },
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))
const end = (turn, kind, extra = {}) => ({ type: 'turn/end', data: { turn, reason: { kind, ...extra } } })

await test('시작할 때 이미 대기 중인 요청은 알리지 않는다', () => {
  const env = environment({ pending: { a: { key: 'approval:1', kind: 'approval' } } })
  env.flush(SETTLE_MS)
  env.setPending({ a: { key: 'approval:1', kind: 'approval' } })
  assert.deepEqual(env.emitted, [])
})

await test('연결이 안정된 뒤 새로 나타난 승인·질문·계획 검토를 각각 알린다', () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setPending({ a: { key: 'k1', kind: 'approval' }, b: { key: 'k2', kind: 'question' } })
  env.setPending({ a: { key: 'k3', kind: 'plan-review' } })
  assert.deepEqual(
    env.emitted.map(({ key, kind, sessionId }) => [key, kind, sessionId]),
    [
      ['k1', 'approval', 'a'],
      ['k2', 'question', 'b'],
      ['k3', 'planReview', 'a'],
    ]
  )
})

await test('답변하거나 취소된 요청은 알림을 거두고 다시 나타나도 반복하지 않는다', () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setPending({ a: { key: 'k1', kind: 'question' } })
  env.setPending({})
  env.setPending({ a: { key: 'k1', kind: 'question' } })
  assert.equal(env.emitted.length, 1)
  assert.deepEqual(env.withdrawn, ['k1'])
})

await test('재연결 직후 복원된 요청은 다시 알리지 않고 그 뒤의 새 요청만 알린다', () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.connection.set('connecting')
  env.setPending({ a: { key: 'during-outage', kind: 'approval' } })
  env.connection.set('connected')
  env.setPending({ a: { key: 'during-outage', kind: 'approval' } })
  env.flush(SETTLE_MS)
  env.setPending({ a: { key: 'during-outage', kind: 'approval' }, b: { key: 'new', kind: 'question' } })
  assert.deepEqual(
    env.emitted.map(({ key }) => key),
    ['new']
  )
})

await test('알 수 없는 대기 상호작용 종류는 알리지 않는다', () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setPending({ a: { key: 'x', kind: 'secret-request' } })
  assert.deepEqual(env.emitted, [])
})

await test('실행 중인 세션의 completed turn/end만 완료로 알린다', async () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setRunning({ a: true })
  env.watches.get('a').resolve()
  await tick()
  env.append('a', { type: 'turn/start', data: { turn: 3 } })
  env.append('a', end(3, 'completed'))
  assert.deepEqual(env.emitted, [{ key: 'completed:a:3', kind: 'completed', sessionId: 'a' }])
})

await test('오류·취소·중단·max-tokens로 끝난 턴은 완료로 알리지 않는다', async () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setRunning({ a: true })
  env.watches.get('a').resolve()
  await tick()
  env.append(
    'a',
    end(1, 'error', { error: { message: 'boom' } }),
    end(2, 'aborted', { reason: { kind: 'user' } }),
    end(3, 'interrupted'),
    end(4, 'max-tokens'),
    end(5, 'blocked')
  )
  assert.deepEqual(env.emitted, [])
})

await test('running 플래그가 꺼지기만 해서는 완료로 알리지 않는다', async () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setRunning({ a: true })
  env.watches.get('a').resolve()
  await tick()
  env.setRunning({ a: false })
  env.flush(RELEASE_GRACE_MS)
  assert.deepEqual(env.emitted, [])
  assert.equal(env.watches.get('a').released, true)
})

await test('재연결 기준 창에 들어 있는 이전 턴 종료는 다시 알리지 않는다', async () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setRunning({ a: true })
  env.watches.get('a').resolve()
  await tick()
  env.append('a', end(1, 'completed'))
  env.replace('a', end(1, 'completed'), end(0, 'completed'))
  env.append('a', end(1, 'completed'))
  assert.equal(env.emitted.length, 1)
})

await test('running이 꺼진 직후에 도착한 turn/end도 유예 시간 안에서는 알린다', async () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setRunning({ a: true })
  env.watches.get('a').resolve()
  await tick()
  env.setRunning({ a: false })
  env.append('a', end(2, 'completed'))
  assert.equal(env.emitted.length, 1)
})

await test('세션 감시를 열지 못하면 다시 실행될 때까지 재시도하지 않는다', async () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setRunning({ a: true })
  const first = env.watches.get('a')
  first.reject(new Error('offline'))
  await tick()
  env.setRunning({ a: true, b: false })
  assert.equal(env.watches.get('a'), first)
  env.setRunning({ a: false })
  env.setRunning({ a: true })
  assert.notEqual(env.watches.get('a'), first)
})

await test('해제하면 감시를 놓고 표시한 요청 알림을 거둔다', async () => {
  const env = environment()
  env.flush(SETTLE_MS)
  env.setPending({ a: { key: 'k1', kind: 'approval' } })
  env.setRunning({ b: true })
  env.engine.dispose()
  assert.deepEqual(env.withdrawn, ['k1'])
  assert.equal(env.watches.get('b').released, true)
})
