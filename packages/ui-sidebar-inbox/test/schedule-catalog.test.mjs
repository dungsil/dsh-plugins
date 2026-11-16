import assert from 'node:assert/strict'
import test from 'node:test'
import { createCatalogReader } from '../src/schedule-catalog.ts'
import { automationSessionIds } from '../src/schedule-link.ts'

const task = (patch = {}) => ({
  id: 'task',
  lastDelivery: { deliveredAt: '2026-11-15T00:00:00Z', targetSessionId: 'latest' },
  scheduledAt: '2026-11-16T00:00:00Z',
  status: 'active',
  target: { kind: 'new' },
  ...patch,
})

/** Records calls and replays queued responses; the last response repeats once the queue runs out. */
function stub(...responses) {
  const queue = [...responses]
  const calls = []
  const fn = async (...args) => {
    calls.push(args)
    const next = queue.length > 1 ? queue.shift() : queue[0]
    return typeof next === 'function' ? await next(...args) : await next
  }
  fn.calls = calls
  return fn
}

const catalogOf = (entries) => stub({ ok: true, value: entries })

async function waitFor(check, timeoutMs = 1000) {
  const started = Date.now()
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

async function settled(reader) {
  let changes = 0
  const stop = reader.subscribe(() => {
    changes += 1
  })
  await reader.read()
  await waitFor(() => assert.ok(changes > 0))
  stop()
  return await reader.read()
}

const idsOf = (result) => result.ok && automationSessionIds(result.value)

await test('예약·일시정지·전달된 대상은 포함하고 작업을 만든 세션은 제외한다', () => {
  const created = { ...task(), involvedSessionIds: ['creator', 'editor'] }
  assert.deepEqual(
    automationSessionIds([
      created,
      task({ target: { kind: 'new_once', sessionId: 'reserved' } }),
      task({ status: 'paused', target: { kind: 'session', sessionId: 'existing' } }),
      task({ deliveredSessionIds: ['earlier'], status: 'ended' }),
    ]),
    new Set(['latest', 'reserved', 'existing', 'earlier'])
  )
})

await test('과거 전달 대상을 페이지 단위로 읽되 목록 준비를 늦추지 않고 같은 전달은 캐시한다', async () => {
  const history = stub(async (request) => ({
    ok: true,
    value:
      request.before === undefined
        ? { nextBefore: 'cursor', records: [{ messageId: 'head', targetSessionId: 'latest' }] }
        : { records: [{ messageId: 'old', targetSessionId: 'earlier' }] },
  }))
  const reader = createCatalogReader({ catalog: catalogOf([task()]), history })
  const result = await settled(reader)
  assert.deepEqual(idsOf(result), new Set(['latest', 'earlier']))
  await reader.read()
  assert.equal(history.calls.length, 2)
  reader.dispose()
})

await test('응답하지 않는 이력 요청이 목록 읽기를 막지 않는다', async () => {
  const history = stub(() => Promise.withResolvers().promise)
  const reader = createCatalogReader({ catalog: catalogOf([task()]), history })
  const result = await reader.read()
  assert.deepEqual(idsOf(result), new Set(['latest']))
  await reader.read()
  assert.equal(history.calls.length, 1)
  reader.dispose()
})

for (const { label, response } of [
  { label: '권한 실패', response: { ok: false } },
  { label: '도메인 미스', response: { ok: true, value: { code: 'schedule_not_found' } } },
]) {
  await test(`${label}는 재연결 전까지 이력 읽기를 반복하지 않는다`, async () => {
    const history = stub(response)
    const reader = createCatalogReader({ catalog: catalogOf([task()]), history })
    await settled(reader)
    await reader.read()
    assert.equal(history.calls.length, 1)
    reader.reset()
    await settled(reader)
    assert.equal(history.calls.length, 2)
    reader.dispose()
  })
}

await test('읽기가 거부되어도 알려진 대상을 유지하고 증분 읽기는 이전 전달에서 멈춘다', async () => {
  let entry = task()
  const history = stub(
    { ok: true, value: { records: [{ messageId: 'old', targetSessionId: 'earlier' }] } },
    () => Promise.reject(new Error('disconnected')),
    {
      ok: true,
      value: {
        nextBefore: 'unneeded',
        records: [
          { messageId: 'new', targetSessionId: 'next' },
          { messageId: 'old', targetSessionId: 'earlier' },
        ],
      },
    }
  )
  const reader = createCatalogReader({ catalog: async () => ({ ok: true, value: [entry] }), history })
  await settled(reader)
  entry = task({ lastDelivery: { deliveredAt: '2026-11-16T00:00:00Z', targetSessionId: 'next' } })
  const result = await settled(reader)
  assert.deepEqual(idsOf(result), new Set(['earlier', 'next']))
  reader.reset()
  await settled(reader)
  assert.equal(history.calls.length, 3)
  reader.dispose()
})

await test('목록을 바로 알리고 증분 페이지가 실패하면 이전 기준점을 유지한다', async () => {
  let entry = task()
  const first = Promise.withResolvers()
  const history = stub(
    () => first.promise,
    {
      ok: true,
      value: { nextBefore: 'more', records: [{ messageId: 'partial', targetSessionId: 'partial' }] },
    },
    { ok: false },
    {
      ok: true,
      value: {
        nextBefore: 'more',
        records: [
          { messageId: 'new', targetSessionId: 'new' },
          { messageId: 'partial', targetSessionId: 'partial' },
          { messageId: 'old', targetSessionId: 'old' },
          { messageId: 'ignored', targetSessionId: 'ignored' },
        ],
      },
    }
  )
  const reader = createCatalogReader({ catalog: async () => ({ ok: true, value: [entry] }), history })
  let changes = 0
  const stop = reader.subscribe(() => {
    changes += 1
  })
  const initial = await reader.read()
  assert.deepEqual(idsOf(initial), new Set(['latest']))
  first.resolve({ ok: true, value: { records: [{ messageId: 'old', targetSessionId: 'old' }] } })
  await waitFor(() => assert.equal(changes, 1))
  stop()
  entry = task({ lastDelivery: { deliveredAt: '2026-11-16T00:00:00Z', targetSessionId: 'new' } })
  const failed = await settled(reader)
  assert.deepEqual(idsOf(failed), new Set(['new', 'old', 'partial']))
  reader.reset()
  const retried = await settled(reader)
  assert.deepEqual(idsOf(retried), new Set(['new', 'old', 'partial']))
  assert.equal(history.calls.length, 4)
  reader.dispose()
})

await test('반복되는 커서는 끊고 재설정이나 해제 뒤에 끝난 이력은 무시한다', async () => {
  const history = stub({ ok: true, value: { nextBefore: 'same', records: [{ targetSessionId: 'earlier' }] } })
  const reader = createCatalogReader({ catalog: catalogOf([task()]), history })
  await settled(reader)
  assert.equal(history.calls.length, 2)
  reader.dispose()
  const late = Promise.withResolvers()
  const next = createCatalogReader({ catalog: catalogOf([task()]), history: async () => await late.promise })
  let changes = 0
  next.subscribe(() => {
    changes += 1
  })
  await next.read()
  next.reset()
  next.dispose()
  changes = 0
  late.resolve({ ok: true, value: { records: [{ targetSessionId: 'stale' }] } })
  await late.promise
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(changes, 0)
})

await test('접근 권한이나 전달 기록이 없으면 이력을 읽지 않고 목록 실패는 그대로 돌려준다', async () => {
  const history = stub({ ok: false })
  const source = stub(
    {
      ok: true,
      value: [
        {
          id: 'undelivered',
          scheduledAt: '2026-11-16T00:00:00Z',
          status: 'active',
          target: { kind: 'new_once', sessionId: 'reserved' },
        },
      ],
    },
    { ok: false }
  )
  const reader = createCatalogReader({ catalog: source, history })
  await reader.read()
  assert.equal(history.calls.length, 0)
  const denied = createCatalogReader({ catalog: catalogOf([task()]), history }, () => false)
  await denied.read()
  assert.equal(history.calls.length, 0)
  assert.deepEqual(await reader.read(), { ok: false })
  reader.dispose()
  denied.dispose()
})
