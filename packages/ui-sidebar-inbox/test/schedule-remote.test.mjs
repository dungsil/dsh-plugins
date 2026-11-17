import assert from 'node:assert/strict'
import test from 'node:test'
import { createScheduleLink } from '../src/schedule-link.ts'
import { connectSchedule, SCHEDULE_INJECT } from '../src/schedule-remote.ts'

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

function fixture() {
  const callbacks = new Map()
  const disposers = new Map()
  const events = new Map()
  const historyCalls = []
  const historyQueue = []
  const prompts = []
  const history = async (request) => {
    historyCalls.push(request)
    const next = historyQueue.length > 1 ? historyQueue.shift() : historyQueue[0]
    return typeof next === 'function' ? await next(request) : await next
  }
  const catalog = async () => ({
    ok: true,
    value: [
      {
        id: 'task',
        lastDelivery: { deliveredAt: '2026-11-15T00:00:00Z', targetSessionId: 'latest' },
        scheduledAt: '2026-11-16T00:00:00Z',
        status: 'active',
        target: { kind: 'new' },
      },
    ],
  })
  const listen = (event, listener) => {
    events.set(event, listener)
    return () => {
      events.delete(event)
    }
  }
  const context = {
    on: listen,
    remote: {
      $on: listen,
      schedule: { catalog, history },
      session: {
        prompt: async (request) => {
          prompts.push(request)
          return await Promise.resolve({ ok: true, value: null })
        },
      },
    },
    remoteAccess: {
      whenAccess: (action, activate) => {
        callbacks.set(action, activate)
        return () => {
          disposers.get(action)?.()
          disposers.delete(action)
          callbacks.delete(action)
        }
      },
    },
  }
  const grant = (action) => {
    const activate = callbacks.get(action)
    if (activate === undefined) throw new Error(`missing ${action}`)
    disposers.set(action, activate())
  }
  const lose = (action) => {
    disposers.get(action)?.()
    disposers.delete(action)
  }
  return { callbacks, context, events, grant, history, historyCalls, historyQueue, lose, prompts }
}

const page = (id) => ({ ok: true, value: { records: [{ messageId: id, targetSessionId: id }] } })

async function waitIds(link, ids) {
  await waitFor(() => {
    assert.deepEqual(link.getSnapshot().sessionIds, new Set(ids))
    assert.equal(link.getSnapshot().settled, true)
  })
}

await test('필요한 서비스 이름을 함께 주입한다', () => {
  assert.deepEqual(SCHEDULE_INJECT, ['remote', 'remote.schedule', 'remote.session', 'remoteAccess'])
})

await test('이력 권한 없이 목록을 읽고 이력 권한의 부여와 상실에 따라 따로 갱신한다', async () => {
  const f = fixture()
  const link = createScheduleLink()
  const deferred = Promise.withResolvers()
  f.historyQueue.push(() => deferred.promise, page('granted'))
  const stop = connectSchedule(f.context, link)
  f.grant('schedule/catalog')
  await waitIds(link, ['latest'])
  assert.equal(f.historyCalls.length, 0)
  f.grant('schedule/history')
  await waitFor(() => assert.equal(f.historyCalls.length, 1))
  f.lose('schedule/history')
  deferred.resolve(page('stale'))
  await deferred.promise
  await waitIds(link, ['latest'])
  f.grant('schedule/history')
  await waitIds(link, ['latest', 'granted'])
  assert.equal(f.historyCalls.length, 2)
  stop()
  assert.equal(link.getSnapshot().available, false)
  assert.equal(f.callbacks.size, 0)
  assert.equal(f.events.size, 0)
})

await test('연결 재설정 이전과 해제된 HMR 마운트의 이력은 무시한다', async () => {
  const f = fixture()
  const link = createScheduleLink()
  const first = Promise.withResolvers()
  const second = Promise.withResolvers()
  f.historyQueue.push(
    () => first.promise,
    () => second.promise,
    page('fresh')
  )
  const stop = connectSchedule(f.context, link)
  f.grant('schedule/catalog')
  await waitIds(link, ['latest'])
  f.grant('schedule/history')
  await waitFor(() => assert.equal(f.historyCalls.length, 1))
  f.events.get('connection/reset')?.()
  await waitFor(() => assert.equal(f.historyCalls.length, 2))
  first.resolve(page('stale-reset'))
  await first.promise
  await waitIds(link, ['latest'])
  stop()
  second.resolve(page('stale-dispose'))
  await second.promise
  assert.equal(link.getSnapshot().available, false)
  const stopNext = connectSchedule(f.context, link)
  f.grant('schedule/catalog')
  f.grant('schedule/history')
  await waitIds(link, ['latest', 'fresh'])
  assert.equal(f.historyCalls.length, 3)
  stopNext()
  assert.equal(f.events.size, 0)
  assert.equal(f.callbacks.size, 0)
})

await test('에이전트 요청은 대기열 모드와 브라우저 시간대를 실어 보낸다', async () => {
  const f = fixture()
  const link = createScheduleLink()
  const stop = connectSchedule(f.context, link)
  f.grant('schedule/catalog')
  await waitIds(link, ['latest'])
  assert.equal(await link.request('s1', 'hello'), true)
  assert.equal(f.prompts.length, 1)
  assert.equal(f.prompts[0].mode, 'queue')
  assert.equal(f.prompts[0].sessionId, 's1')
  assert.deepEqual(f.prompts[0].content, [{ text: 'hello', type: 'text' }])
  assert.match(f.prompts[0].requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(typeof f.prompts[0].clientTimeZone, 'string')
  stop()
  assert.equal(await link.request('s1', 'late'), false)
})
