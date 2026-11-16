import assert from 'node:assert/strict'
import test from 'node:test'
import { createSnoozeState } from '../src/snooze-state.ts'

const NOW = 1_000_000
const MINUTE = 60_000

/** Fakes only the injection points, so the expiry path runs without real timers. */
function createEnvironment(raw = null, denied = false) {
  let now = NOW
  let current = raw
  let nextTimer = 1
  let changes = 0
  const timers = new Map()
  const writes = []
  const state = createSnoozeState({
    now: () => now,
    onChange: () => {
      changes += 1
    },
    schedule: (callback, delayMs) => {
      const id = nextTimer
      nextTimer += 1
      timers.set(id, { at: now + delayMs, run: callback })
      return () => {
        timers.delete(id)
      }
    },
    storage: {
      read: () => {
        if (denied) throw new Error('denied')
        return current
      },
      write: (value) => {
        if (denied) throw new Error('denied')
        current = value
        writes.push(value)
      },
    },
  })
  return {
    advance: (ms) => {
      now += ms
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id)
          timer.run()
        }
      }
    },
    changes: () => changes,
    state,
    timers: () => timers.size,
    writes: () => writes,
  }
}

await test('저장된 맵을 읽고 만료된 항목은 버린다', () => {
  const environment = createEnvironment(JSON.stringify({ expired: NOW - 1, live: NOW + MINUTE, wrong: 'soon' }))
  assert.deepEqual([...environment.state.getSnapshot()], [['live', NOW + MINUTE]])
})

await test('일시정지하면 저장하고 구독자에게 알린다', () => {
  const environment = createEnvironment()
  const seen = []
  environment.state.subscribe(() => {
    seen.push(JSON.stringify([...environment.state.getSnapshot()]))
  })
  environment.state.snooze('s1', '30m')
  assert.equal(environment.state.getSnapshot().has('s1'), true)
  assert.ok('s1' in JSON.parse(environment.writes().at(-1) ?? 'null'))
  assert.equal(environment.changes(), 1)
  assert.equal(seen.length, 1)
})

await test('걸어 둔 타이머에서 만료된다', () => {
  const environment = createEnvironment()
  environment.state.snooze('s1', '30m')
  environment.advance(30 * MINUTE + 1000)
  assert.equal(environment.state.getSnapshot().size, 0)
  assert.equal(environment.writes().at(-1), '{}')
  assert.equal(environment.changes(), 2)
})

await test('일부만 만료되면 남은 기한으로 타이머를 다시 건다', () => {
  const environment = createEnvironment(JSON.stringify({ first: NOW + MINUTE, second: NOW + 2 * MINUTE }))
  environment.advance(MINUTE + 1000)
  assert.deepEqual([...environment.state.getSnapshot()], [['second', NOW + 2 * MINUTE]])
  environment.advance(MINUTE + 1000)
  assert.equal(environment.state.getSnapshot().size, 0)
  assert.equal(environment.writes().at(-1), '{}')
})

await test('없는 항목을 깨울 때는 onChange를 부르지 않는다', () => {
  const environment = createEnvironment()
  environment.state.wake('missing')
  assert.equal(environment.changes(), 0)
  environment.state.snooze('s1', '1h')
  environment.state.wake('s1')
  assert.equal(environment.state.getSnapshot().size, 0)
  assert.equal(environment.writes().at(-1), '{}')
  assert.equal(environment.changes(), 2)
})

await test('저장소가 막혀도 이번 페이지의 상태는 유지한다', () => {
  const environment = createEnvironment(null, true)
  assert.doesNotThrow(() => {
    environment.state.snooze('s1', '1h')
  })
  assert.equal(environment.state.getSnapshot().has('s1'), true)
  assert.equal(environment.writes().length, 0)
})

await test('해제하면 타이머와 구독자를 멈춘다', () => {
  const environment = createEnvironment(JSON.stringify({ s1: NOW + MINUTE }))
  let heard = 0
  environment.state.subscribe(() => {
    heard += 1
  })
  environment.state.dispose()
  environment.advance(2 * MINUTE)
  assert.equal(heard, 0)
  assert.equal(environment.changes(), 0)
})

await test('해제 뒤 늦은 깨우기는 저장만 하고 타이머와 화면을 되살리지 않는다', () => {
  const environment = createEnvironment(JSON.stringify({ first: NOW + MINUTE, second: NOW + 2 * MINUTE }))
  environment.state.dispose()
  // The path a late agent-request rejection takes after disposal.
  environment.state.wake('first')
  environment.advance(3 * MINUTE)
  assert.deepEqual(JSON.parse(environment.writes().at(-1) ?? 'null'), { second: NOW + 2 * MINUTE })
  assert.equal(environment.changes(), 0)
  assert.equal(environment.timers(), 0)
})

await test('에이전트에게 맡기면 요청 시각을 저장하고 판정 함수가 깨울 때까지 유지한다', () => {
  let verdict = { wake: false }
  let now = NOW
  const timers = new Map()
  let nextTimer = 1
  let writes = []
  const state = createSnoozeState({
    judgeAgent: () => verdict,
    now: () => now,
    onChange: () => undefined,
    schedule: (callback, delayMs) => {
      const id = nextTimer++
      timers.set(id, { at: now + delayMs, run: callback })
      return () => timers.delete(id)
    },
    storage: { read: () => null, write: (value) => writes.push(value) },
  })
  state.snoozeAgent('s1')
  assert.deepEqual(state.getSnapshot().get('s1'), { agent: NOW })
  assert.deepEqual(JSON.parse(writes.at(-1)), { s1: { agent: NOW } })
  assert.equal(timers.size, 0)
  verdict = { wake: true }
  state.prune()
  assert.equal(state.getSnapshot().size, 0)
})
