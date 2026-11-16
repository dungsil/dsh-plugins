import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createScheduleLink, toWakeTasks } from '../src/schedule-link.ts'

const noop = () => undefined
/** Wait until a read response has crossed its several awaits and reached the snapshot. */
const settle = async () => {
  await delay(0)
}
const AT = '2026-11-09T03:00:00.000Z'

const entry = (patch = {}) => ({
  scheduledAt: AT,
  status: 'active',
  target: { kind: 'session', sessionId: 's1' },
  ...patch,
})

/** Holds list reads so the test decides the order of responses. */
function deferredDeps() {
  const pending = []
  let changed = noop
  const deps = {
    list: async () => {
      const { promise, resolve } = Promise.withResolvers()
      pending.push(resolve)
      return await promise
    },
    prompt: async () => await Promise.resolve({ ok: true, value: {} }),
    subscribeChanged: (listener) => {
      changed = listener
      return noop
    },
    subscribeReset: () => noop,
  }
  return {
    changed: () => {
      changed()
    },
    deps,
    pending,
  }
}

await test('기존 세션으로 전달되는 작업만 깨우기 작업으로 남긴다', () => {
  const tasks = toWakeTasks([
    entry({ lastDelivery: { deliveredAt: AT } }),
    entry({ status: 'paused', target: { kind: 'new_once', sessionId: 'reserved' } }),
    entry({ target: { kind: 'new' } }),
    entry({ scheduledAt: 'not a date' }),
  ])
  assert.deepEqual(tasks, [{ active: true, deliveredAt: Date.parse(AT), scheduledAt: Date.parse(AT), sessionId: 's1' }])
})

await test('더 새로운 읽기에 추월당한 읽기는 버리고 실패한 읽기는 마지막 성공을 유지한다', async () => {
  const link = createScheduleLink()
  const { changed, deps, pending } = deferredDeps()
  link.attach(deps)
  changed()
  pending[1]?.({ ok: true, value: [entry()] })
  pending[0]?.({ ok: true, value: [] })
  await settle()
  assert.equal(link.getSnapshot().available, true)
  assert.equal(link.getSnapshot().settled, true)
  assert.equal(link.getSnapshot().tasks.length, 1)
  changed()
  pending[2]?.({ ok: false })
  await settle()
  assert.equal(link.getSnapshot().tasks.length, 1)
})

await test('떼어 낸 뒤에는 쓸 수 없음으로 답하고 늦게 도착한 읽기는 무시한다', async () => {
  const link = createScheduleLink()
  const { deps, pending } = deferredDeps()
  const detach = link.attach(deps)
  detach()
  pending[0]?.({ ok: true, value: [entry()] })
  await settle()
  assert.deepEqual(link.getSnapshot(), { available: false, sessionIds: new Set(), settled: false, tasks: [] })
  assert.equal(await link.request('s1', 'hello'), false)
})

await test('붙어 있는 동안 요청은 호스트 결과를 그대로 알린다', async () => {
  const link = createScheduleLink()
  const sent = []
  link.attach({
    list: async () => await Promise.resolve({ ok: false }),
    prompt: async (sessionId, text) => {
      sent.push([sessionId, text])
      return await Promise.resolve({ ok: sessionId === 's1' })
    },
    subscribeChanged: () => noop,
    subscribeReset: () => noop,
  })
  assert.equal(await link.request('s1', 'a'), true)
  assert.equal(await link.request('s2', 'b'), false)
  assert.deepEqual(sent, [
    ['s1', 'a'],
    ['s2', 'b'],
  ])
})

await test('요청이 예외를 던지면 거부로 처리한다', async () => {
  const link = createScheduleLink()
  link.attach({
    list: async () => await Promise.resolve({ ok: false }),
    prompt: async () => await Promise.reject(new Error('offline')),
    subscribeChanged: () => noop,
    subscribeReset: () => noop,
  })
  assert.equal(await link.request('s1', 'a'), false)
})
