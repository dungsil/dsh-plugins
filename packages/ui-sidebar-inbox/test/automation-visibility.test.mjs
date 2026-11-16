import assert from 'node:assert/strict'
import test from 'node:test'
import { AUTOMATION_VISIBLE_KEY, createAutomationVisibility } from '../src/automation-visibility.ts'
import { createSnoozeState } from '../src/snooze-state.ts'

function setup(initial = null, denied = false) {
  let raw = initial
  const writes = []
  const storage = {
    read: () => {
      if (denied) throw new Error('denied')
      return raw
    },
    write: (value) => {
      if (denied) throw new Error('denied')
      raw = value
      writes.push(value)
    },
  }
  const manualWrites = []
  const snooze = createSnoozeState({
    now: () => 1000,
    onChange: () => undefined,
    schedule: () => () => {},
    storage: { read: () => null, write: (value) => manualWrites.push(value) },
  })
  const listeners = new Set()
  let ids = new Set(['auto'])
  const automation = {
    getSnapshot: () => ({ available: true, sessionIds: ids, settled: true, tasks: [] }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  const placementListeners = new Set()
  let snoozed = new Set(['auto'])
  const placement = {
    isSnoozed: (id) => snoozed.has(id),
    subscribe: (listener) => {
      placementListeners.add(listener)
      return () => {
        placementListeners.delete(listener)
      }
    },
  }
  let changes = 0
  const onChange = () => {
    changes += 1
  }
  const visibility = createAutomationVisibility({ automation, onChange, placement, snooze, storage })
  return {
    automation,
    changes: () => changes,
    listeners,
    manualWrites,
    placement,
    placementListeners,
    setIds: (next) => {
      ids = new Set(next)
      for (const listener of listeners) listener()
    },
    setSnoozed: (next) => {
      snoozed = new Set(next)
      for (const listener of placementListeners) listener()
    },
    snooze,
    storage,
    visibility,
    writes,
  }
}

await test('예외 저장 키는 dungsil 네임스페이스를 쓴다', () => {
  assert.equal(AUTOMATION_VISIBLE_KEY, 'dungsil.sidebar-inbox.automation-visible.v1')
})

await test('이미 있는 대상을 분류만 하고 가상 항목을 저장하지 않는다', () => {
  const { visibility, writes, manualWrites } = setup()
  assert.deepEqual(visibility.getAutomationIds(), new Set(['auto']))
  assert.equal(visibility.menuState.getSnapshot().get('auto'), Number.POSITIVE_INFINITY)
  assert.equal(writes.length, 0)
  assert.equal(manualWrites.length, 0)
})

await test('자동 항목과 수동 항목을 모두 깨우고 예외는 다시 불러와도 복원한다', () => {
  const { visibility, storage, automation, placement, snooze, writes, manualWrites } = setup()
  snooze.snooze('auto', '1h')
  visibility.menuState.wake('auto')
  assert.equal(visibility.menuState.getSnapshot().has('auto'), false)
  assert.equal(visibility.getAutomationIds().size, 0)
  assert.equal(writes.at(-1), '["auto"]')
  assert.equal(manualWrites.at(-1), '{}')
  const reloaded = createAutomationVisibility({ automation, onChange: () => undefined, placement, snooze, storage })
  assert.equal(reloaded.getAutomationIds().size, 0)
})

await test('잘못된 저장값은 무시하고 저장소가 막혀도 메모리의 예외는 유지한다', () => {
  for (const raw of ['{', '{}', '[null,1,"", "auto"]']) {
    const { visibility } = setup(raw)
    assert.equal(visibility.getAutomationIds().has('auto'), !raw.includes('"auto"'))
  }
  const { visibility } = setup(null, true)
  visibility.menuState.wake('auto')
  assert.equal(visibility.getAutomationIds().has('auto'), false)
})

await test('직접 일시정지하면 예외를 지우고 수동 항목을 우선한다', () => {
  const { visibility, snooze, writes } = setup()
  visibility.menuState.wake('auto')
  visibility.menuState.snooze('auto', '30m')
  assert.equal(writes.at(-1), '[]')
  assert.equal(visibility.getAutomationIds().has('auto'), true)
  assert.equal(visibility.menuState.getSnapshot().get('auto'), snooze.getSnapshot().get('auto'))
  snooze.wake('auto')
  assert.equal(visibility.menuState.getSnapshot().get('auto'), Number.POSITIVE_INFINITY)
})

await test('에이전트가 작업을 만들기 전에는 일반 세션을 계속 보이게 둔다', () => {
  const { visibility, setIds } = setup()
  visibility.keepVisible('normal')
  setIds(['auto', 'normal'])
  assert.deepEqual(visibility.getAutomationIds(), new Set(['auto']))
})

await test('대상이 숨김 목록에 배치된 동안에만 가상 항목을 내놓는다', () => {
  const { visibility, snooze, setSnoozed } = setup()
  setSnoozed([])
  assert.equal(visibility.getAutomationIds().has('auto'), true)
  assert.equal(visibility.menuState.getSnapshot().has('auto'), false)
  snooze.snooze('auto', '1h')
  assert.equal(visibility.menuState.getSnapshot().get('auto'), snooze.getSnapshot().get('auto'))
  snooze.wake('auto')
  setSnoozed(['auto'])
  assert.equal(visibility.menuState.getSnapshot().get('auto'), Number.POSITIVE_INFINITY)
  setSnoozed([])
  assert.equal(visibility.menuState.getSnapshot().has('auto'), false)
})

await test('직접 깨운 일반 세션은 이후 자동화에서 면제되지 않는다', () => {
  const { visibility, snooze, setIds, writes } = setup()
  snooze.snooze('normal', '1h')
  visibility.menuState.wake('normal')
  assert.equal(snooze.getSnapshot().has('normal'), false)
  assert.equal(writes.length, 0)
  setIds(['auto', 'normal'])
  assert.equal(visibility.getAutomationIds().has('normal'), true)
})

await test('각 출처와 예외 변경을 알리고 해제하면 구독을 모두 걷는다', () => {
  const { visibility, snooze, setIds, setSnoozed, listeners, placementListeners, changes } = setup()
  let heard = 0
  const stop = visibility.menuState.subscribe(() => {
    heard += 1
  })
  setIds(['auto', 'other'])
  snooze.snooze('manual', '1h')
  visibility.keepVisible('auto')
  setSnoozed([])
  assert.equal(heard, 4)
  assert.equal(changes(), 1)
  stop()
  assert.equal(listeners.size, 0)
  assert.equal(placementListeners.size, 0)
  setIds([])
  setSnoozed(['auto'])
  snooze.wake('manual')
  visibility.keepVisible('other')
  assert.equal(heard, 4)
})
