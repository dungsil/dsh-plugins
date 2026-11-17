import assert from 'node:assert/strict'
import test from 'node:test'
import { createPresence, electLeader } from '../src/coordination.ts'
import { createPreferenceStore, endpointOf, parsePreferences, scopedName, toggleMuted } from '../src/preferences.ts'
import { copy } from '../src/copy.ts'

const tick = () => new Promise((resolve) => setImmediate(resolve))

await test('같은 엔드포인트의 여러 탭 중 한 탭만 알림을 전달하고 닫히면 다음 탭이 이어받는다', async () => {
  const name = `leader-${Math.random()}`
  const states = [[], [], []]
  const stops = states.map((log) => electLeader(navigator.locks, name, (leader) => log.push(leader)))
  await tick()
  const leaders = () => states.filter((log) => log.at(-1) === true).length
  assert.equal(leaders(), 1)
  const first = states.findIndex((log) => log.at(-1) === true)
  stops[first]()
  await tick()
  assert.equal(leaders(), 1)
  assert.equal(states[first].at(-1), false)
  for (const stop of stops) stop()
})

await test('다른 엔드포인트의 탭은 각자 알림을 전달한다', async () => {
  const one = []
  const two = []
  const a = electLeader(navigator.locks, scopedName(endpointOf('http://h/one/'), 'leader'), (v) => one.push(v))
  const b = electLeader(navigator.locks, scopedName(endpointOf('http://h/two/'), 'leader'), (v) => two.push(v))
  await tick()
  assert.deepEqual([one.at(-1), two.at(-1)], [true, true])
  a()
  b()
})

await test('다른 탭이 앞에 띄운 세션을 보고 있는 것으로 판단한다', async () => {
  const name = `tabs-${Math.random()}`
  const first = new BroadcastChannel(name)
  const second = new BroadcastChannel(name)
  let shown = 'a'
  const leader = createPresence({ channel: first, tab: 'leader', local: () => null })
  const other = createPresence({ channel: second, tab: 'other', local: () => shown })
  other.publish()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(leader.isViewing('a'), true)
  shown = null
  other.publish()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(leader.isViewing('a'), false)
  leader.dispose()
  other.dispose()
  first.close()
  second.close()
})

await test('손상된 설정은 항목별로 기본값을 쓰고 알 수 없는 값은 버린다', () => {
  assert.equal(parsePreferences('{bad').sound, true)
  const parsed = parsePreferences(
    JSON.stringify({ desktop: 'yes', volume: 'loud', events: { completed: false }, muted: ['a', 1, 'a'] })
  )
  assert.equal(parsed.desktop, false)
  assert.equal(parsed.volume, 'medium')
  assert.equal(parsed.events.completed, false)
  assert.equal(parsed.events.approval, true)
  assert.deepEqual(parsed.muted, ['a'])
})

await test('다른 탭에서 바꾼 설정을 storage 이벤트로 반영하고 다른 키는 무시한다', () => {
  let fire
  const store = createPreferenceStore({
    key: 'k',
    storage: { getItem: () => null, setItem: () => {} },
    onStorage: (listener) => ((fire = listener), () => {}),
  })
  fire({ key: 'other', newValue: JSON.stringify({ sound: false }) })
  assert.equal(store.getSnapshot().sound, true)
  fire({ key: 'k', newValue: JSON.stringify({ sound: false }) })
  assert.equal(store.getSnapshot().sound, false)
})

await test('저장소 쓰기가 거부되어도 현재 탭의 설정은 바뀐다', () => {
  const store = createPreferenceStore({
    key: 'k',
    storage: {
      getItem: () => null,
      setItem() {
        throw new Error('quota')
      },
    },
  })
  store.update((value) => toggleMuted(value, 's', true))
  assert.deepEqual(store.getSnapshot().muted, ['s'])
  store.update((value) => toggleMuted(value, 's', false))
  assert.deepEqual(store.getSnapshot().muted, [])
})

await test('엔드포인트는 문서 경로 접두사까지 구분한다', () => {
  assert.equal(endpointOf('https://h.example/ui/index.html'), 'https://h.example/ui/')
  assert.notEqual(endpointOf('https://h.example/a/'), endpointOf('https://h.example/b/'))
})

await test('모든 로케일이 같은 키와 비어 있지 않은 문구를 제공한다', () => {
  const keys = Object.keys(copy.en).sort()
  for (const [language, words] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(words).sort(), keys, language)
    for (const key of keys) assert.ok(words[key].trim(), `${language}: ${key}`)
    assert.match(words.body, /\{workspace\}/, language)
    assert.match(words.mutedCount, /\{count\}/, language)
  }
})
