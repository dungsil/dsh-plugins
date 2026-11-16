import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_PROMPT,
  AGENT_SETTLE_MS,
  AGENT_START_GRACE_MS,
  createAgentChoice,
  createAgentWake,
  nextWake,
} from '../src/agent-wake.ts'
import { createSnoozeState } from '../src/snooze-state.ts'

const snapshot = (tasks = [], settled = true) => ({ available: true, sessionIds: new Set(), settled, tasks })

await test('이전 요청의 턴 기록을 새 요청에 재사용하지 않는다', () => {
  let busy = true
  const wake = createAgentWake({ busy: () => busy, schedule: () => snapshot() })
  assert.deepEqual(wake.judge('s1', 0, 1000), { wake: false })
  // A request made after showing the row again has not seen a turn yet, so it follows the start grace.
  busy = false
  assert.deepEqual(wake.judge('s1', 2000, 3000), { recheckAt: 2000 + AGENT_START_GRACE_MS, wake: false })
  assert.deepEqual(wake.judge('s1', 0, 3000), { recheckAt: 3000 + AGENT_SETTLE_MS, wake: false })
})

await test('가장 이른 활성 작업을 따르고 일시정지된 작업은 무시한다', () => {
  const wake = createAgentWake({
    busy: () => false,
    schedule: () =>
      snapshot([
        { active: false, scheduledAt: 500, sessionId: 's1' },
        { active: true, scheduledAt: 9000, sessionId: 's1' },
        { active: true, scheduledAt: 7000, sessionId: 's1' },
        { active: true, scheduledAt: 100, sessionId: 'other' },
      ]),
  })
  assert.equal(wake.hasPlan('s1'), true)
  assert.deepEqual(wake.judge('s1', 0, 1000), { recheckAt: 7000, wake: false })
  assert.deepEqual(wake.judge('s1', 0, 7000), { wake: true })
})

await test('작업 목록을 읽기 전에는 작업이 없다고 단정하지 않고 유지한다', () => {
  const wake = createAgentWake({ busy: () => false, schedule: () => snapshot([], false) })
  assert.equal(wake.hasPlan('s1'), false)
  assert.deepEqual(wake.judge('s1', 0, 10 * AGENT_START_GRACE_MS), { wake: false })
})

await test('요청 뒤 한 번이라도 전달되었으면 반복 작업의 다음 시각을 기다리지 않고 깨운다', () => {
  const wake = createAgentWake({
    busy: () => false,
    schedule: () => snapshot([{ active: true, deliveredAt: 2000, scheduledAt: 99_999, sessionId: 's1' }]),
  })
  assert.deepEqual(wake.judge('s1', 1000, 3000), { wake: true })
  assert.deepEqual(wake.judge('s1', 5000, 6000), { recheckAt: 99_999, wake: false })
})

await test('예약이 없으면 턴 종료 뒤 갱신을 기다렸다가 깨운다', () => {
  let busy = true
  const wake = createAgentWake({ busy: () => busy, schedule: () => snapshot() })
  assert.deepEqual(wake.judge('s1', 0, 100), { wake: false })
  busy = false
  assert.deepEqual(wake.judge('s1', 0, 200), { recheckAt: 200 + AGENT_SETTLE_MS, wake: false })
  assert.deepEqual(wake.judge('s1', 0, 200 + AGENT_SETTLE_MS), { wake: true })
})

await test('턴이 시작되지 않으면 시작 유예 시간 뒤 깨운다', () => {
  const wake = createAgentWake({ busy: () => false, schedule: () => snapshot() })
  assert.deepEqual(wake.judge('s1', 0, 1000), { recheckAt: AGENT_START_GRACE_MS, wake: false })
  assert.deepEqual(wake.judge('s1', 0, AGENT_START_GRACE_MS), { wake: true })
})

await test('다음 실행 시각은 이 세션의 활성 작업 중 가장 이른 것이다', () => {
  const tasks = [
    { active: true, scheduledAt: 30, sessionId: 's1' },
    { active: true, scheduledAt: 10, sessionId: 's1' },
    { active: false, scheduledAt: 1, sessionId: 's1' },
    { active: true, scheduledAt: 5, sessionId: 's2' },
  ]
  assert.equal(nextWake(tasks, 's1'), 10)
  assert.equal(nextWake(tasks, 'missing'), undefined)
})

/** A snooze state whose timers never fire, so only the choice's own writes matter. */
const quietState = () =>
  createSnoozeState({
    now: () => 1000,
    onChange: () => undefined,
    schedule: () => () => undefined,
    storage: { read: () => null, write: () => undefined },
  })

await test('이미 전달되는 작업이 있으면 에이전트에게 묻지 않고 숨긴다', () => {
  const state = quietState()
  const requests = []
  createAgentChoice({
    hasPlan: () => true,
    request: async (...args) => {
      requests.push(args)
      return await Promise.resolve(true)
    },
    state,
  })('s1')
  assert.deepEqual(state.getSnapshot().get('s1'), { agent: 1000 })
  assert.equal(requests.length, 0)
})

await test('예약이 없으면 에이전트에게 한 번 요청하고 받아들여지면 숨김을 유지한다', async () => {
  const state = quietState()
  const requests = []
  createAgentChoice({
    hasPlan: () => false,
    request: async (sessionId, text) => {
      requests.push([sessionId, text])
      return await Promise.resolve(true)
    },
    state,
  })('s1')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(requests, [['s1', AGENT_PROMPT]])
  assert.equal(state.getSnapshot().has('s1'), true)
})

await test('호스트가 요청을 받지 않으면 숨김을 되돌린다', async () => {
  const state = quietState()
  createAgentChoice({ hasPlan: () => false, request: async () => await Promise.resolve(false), state })('s1')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.getSnapshot().has('s1'), false)
})

await test('거부되기 전에 다른 기한을 고른 항목은 건드리지 않는다', async () => {
  const state = quietState()
  const gate = Promise.withResolvers()
  createAgentChoice({ hasPlan: () => false, request: async () => await gate.promise, state })('s1')
  state.snooze('s1', '1h')
  gate.resolve(false)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.getSnapshot().has('s1'), true)
})
