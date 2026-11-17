import assert from 'node:assert/strict'
import test from 'node:test'
import { attachRetention, confirmedBlank, selectionMemory } from '../src/retention.ts'

const first = { provider: 'provider', model: 'first' }
const second = { provider: 'provider', model: 'second', reasoningEffort: 'high' }
const groups = [
  {
    id: 'provider',
    models: [{ id: 'first' }, { id: 'second', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }],
  },
]

function fixture(initial = {}, blank = true) {
  let state = { status: 'ready', pending: null, routable: true, current: first, groups, failures: [], ...initial }
  const listeners = new Set()
  const requests = []
  const update = (patch) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const directory = {
    store: {
      getSnapshot: () => state,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    select(target) {
      update({ status: 'selecting', pending: target })
      return new Promise((resolve, reject) => requests.push({ target, resolve, reject }))
    },
  }
  return {
    directory,
    update,
    requests,
    isBlank: () => blank,
    get state() {
      return state
    },
    listeners,
  }
}

function memory(value) {
  return {
    read: () => value,
    write: (next) => {
      value = next
    },
  }
}

await test('마지막으로 보던 모델과 추론 수준을 새 빈 세션에 한 번만 적용한다', async () => {
  const remembered = memory()
  const source = fixture({ current: second }, false)
  attachRetention(source.directory, source.isBlank, remembered)()
  assert.deepEqual(remembered.read(), second)
  const blank = fixture()
  const dispose = attachRetention(blank.directory, blank.isBlank, remembered)
  assert.deepEqual(
    blank.requests.map((request) => request.target),
    [second]
  )
  blank.update({ status: 'ready', pending: null })
  assert.deepEqual(remembered.read(), second)
  blank.requests[0].resolve({ ok: true })
  await Promise.resolve()
  assert.deepEqual(remembered.read(), second)
  blank.update({ current: second })
  assert.deepEqual(remembered.read(), second)
  blank.update({ current: first })
  assert.deepEqual(remembered.read(), first)
  assert.equal(blank.requests.length, 1)
  dispose()
})

await test('첫 메시지가 있는 세션을 덮어쓰지 않고 현재 보이는 선택을 기억한다', () => {
  const h = fixture({}, false)
  const remembered = memory(second)
  const dispose = attachRetention(h.directory, h.isBlank, remembered)
  assert.equal(h.requests.length, 0)
  assert.deepEqual(remembered.read(), first)
  dispose()
})

await test('목록과 선택이 준비된 뒤에만 빈 세션의 모델을 정한다', () => {
  const h = fixture({ current: null, status: 'loading', routable: null })
  const dispose = attachRetention(h.directory, h.isBlank, memory(second))
  assert.equal(h.requests.length, 0)
  h.update({ current: first, status: 'ready', routable: true })
  assert.equal(h.requests.length, 1)
  dispose()
})

await test('사라진 모델을 적용하지 않고 지원이 끝난 추론 수준만 제거한다', () => {
  for (const [remembered, expected] of [
    [{ provider: 'gone', model: 'missing' }, []],
    [{ ...second, reasoningEffort: 'max' }, [{ provider: 'provider', model: 'second' }]],
    [first, []],
  ]) {
    const h = fixture()
    const dispose = attachRetention(h.directory, h.isBlank, memory(remembered))
    assert.deepEqual(
      h.requests.map((request) => request.target),
      expected
    )
    dispose()
  }
})

await test('사용할 수 없거나 변경 중인 선택은 기억하지 않는다', () => {
  const remembered = memory(second)
  const h = fixture({ routable: false }, false)
  const dispose = attachRetention(h.directory, h.isBlank, remembered)
  h.update({ routable: true, pending: first, status: 'selecting' })
  assert.deepEqual(remembered.read(), second)
  dispose()
})

await test('실패와 해제 뒤에 늦게 도착한 응답이 기억을 덮어쓰지 않는다', async () => {
  const remembered = memory(second)
  const h = fixture()
  const dispose = attachRetention(h.directory, h.isBlank, remembered)
  dispose()
  assert.equal(h.listeners.size, 0)
  h.update({ status: 'ready', pending: null, current: first })
  h.requests[0].resolve({ ok: true })
  await Promise.resolve()
  assert.deepEqual(remembered.read(), second)
})

await test('적용 중 다시 마운트해도 이전 기본 모델이 기억을 덮어쓰지 않는다', async () => {
  const remembered = memory(second)
  const h = fixture()
  attachRetention(h.directory, h.isBlank, remembered)()
  const dispose = attachRetention(h.directory, h.isBlank, remembered)
  assert.deepEqual(remembered.read(), second)
  h.requests[0].resolve({ ok: true })
  await Promise.resolve()
  h.update({ current: first })
  assert.deepEqual(remembered.read(), second)
  h.update({ current: second })
  assert.deepEqual(remembered.read(), second)
  assert.equal(h.requests.length, 1)
  dispose()
})

await test('선택 요청이 실패해도 반복 적용하지 않고 다음 사용자 선택을 추적한다', async () => {
  for (const rejects of [true, false]) {
    const remembered = memory(second)
    const h = fixture()
    const dispose = attachRetention(h.directory, h.isBlank, remembered)
    h.update({ status: 'error', pending: null })
    if (rejects) h.requests[0].reject(new Error('offline'))
    else h.requests[0].resolve({ ok: false })
    await Promise.resolve()
    h.update({ status: 'ready', current: first })
    assert.equal(h.requests.length, 1)
    assert.deepEqual(remembered.read(), second)
    h.update({ current: { provider: 'provider', model: 'second', reasoningEffort: 'low' } })
    assert.deepEqual(remembered.read(), { provider: 'provider', model: 'second', reasoningEffort: 'low' })
    dispose()
  }
})

await test('저장소를 매번 읽고 다른 탭의 삭제와 잘못된 값을 존중한다', () => {
  const data = new Map()
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
  const a = selectionMemory(storage)
  const b = selectionMemory(storage)
  a.write(second)
  assert.deepEqual(b.read(), second)
  b.write(first)
  assert.deepEqual(a.read(), first)
  const [key] = data.keys()
  for (const invalid of [
    '{',
    '{}',
    '{"provider":1,"model":"first"}',
    '{"provider":"","model":"first"}',
    '{"provider":"p","model":"m","reasoningEffort":5}',
  ]) {
    data.set(key, invalid)
    assert.notDeepEqual(selectionMemory(storage).read(), second)
  }
  data.delete(key)
  assert.equal(a.read(), undefined)
})

await test('명시적 모델 선택이나 기록이 있으면 빈 세션이어도 유지 적용을 허용하지 않는다', () => {
  assert.equal(confirmedBlank(true, undefined, undefined), undefined)
  assert.equal(confirmedBlank(true, {}, { next: null }), undefined)
  assert.equal(confirmedBlank(true, { blank: true }, { next: null }), true)
  assert.equal(confirmedBlank(true, { blank: false }, { next: null }), false)
  assert.equal(confirmedBlank(false, { blank: true }, { next: null }), false)
  assert.equal(confirmedBlank(true, { blank: true }, { next: second }), false)
})

await test('확인된 빈 세션 메타데이터가 도착할 때까지 낙관적인 빈 상태에 모델을 적용하지 않는다', () => {
  const h = fixture()
  let blank
  let notify
  let unsubscribed = false
  const dispose = attachRetention(
    h.directory,
    () => blank,
    memory(second),
    (listener) => {
      notify = listener
      return () => {
        unsubscribed = true
      }
    }
  )
  assert.equal(h.requests.length, 0)
  blank = false
  notify()
  assert.equal(h.requests.length, 0)
  dispose()
  assert.equal(unsubscribed, true)

  const fresh = fixture()
  blank = undefined
  const stop = attachRetention(
    fresh.directory,
    () => blank,
    memory(second),
    (listener) => {
      notify = listener
      return () => {}
    }
  )
  blank = true
  notify()
  assert.deepEqual(
    fresh.requests.map((request) => request.target),
    [second]
  )
  stop()
})

await test('기억한 제공자가 일시적으로 실패하면 기본 모델로 기억을 덮어쓰지 않는다', () => {
  const remembered = memory(second)
  const h = fixture({ groups: [], failures: [{ id: 'provider' }] })
  const dispose = attachRetention(h.directory, h.isBlank, remembered)
  assert.equal(h.requests.length, 0)
  assert.deepEqual(remembered.read(), second)
  h.update({ groups, failures: [] })
  assert.deepEqual(
    h.requests.map((request) => request.target),
    [second]
  )
  dispose()
})

await test('다시 방문한 빈 세션은 다른 세션에서 보던 선택으로 덮어쓰지 않는다', () => {
  const remembered = memory(second)
  const h = fixture({ current: second })
  attachRetention(h.directory, h.isBlank, remembered)()
  remembered.write(first)
  const dispose = attachRetention(h.directory, h.isBlank, remembered)
  assert.equal(h.requests.length, 0)
  assert.deepEqual(remembered.read(), second)
  dispose()
})

await test('백그라운드 탭의 목록 새로고침은 다른 탭이 기억한 최신 선택을 덮어쓰지 않는다', () => {
  const remembered = memory(first)
  const h = fixture({}, false)
  const dispose = attachRetention(h.directory, h.isBlank, remembered)
  remembered.write(second)
  h.update({ groups: [...groups] })
  assert.deepEqual(remembered.read(), second)
  h.update({ current: second })
  h.update({ current: first })
  assert.deepEqual(remembered.read(), first)
  dispose()
})

await test('저장소 접근이 막히거나 용량이 부족해도 페이지 안에서 선택을 유지한다', () => {
  for (const storage of [
    undefined,
    {
      getItem() {
        throw new Error('denied')
      },
      setItem() {
        throw new Error('full')
      },
    },
    {
      getItem() {
        return null
      },
      setItem() {
        throw new Error('full')
      },
    },
  ]) {
    const remembered = selectionMemory(storage)
    remembered.write(second)
    assert.deepEqual(remembered.read(), second)
  }
})
