import assert from 'node:assert/strict'
import test from 'node:test'

import { ARCHIVED_RECORD, mergeArchiveProjection } from '../src/projection.ts'

const eventOf = (type, data) => ({ data, ignorable: true, seq: 0, time: 0, type })
const archived = (urls) => eventOf(ARCHIVED_RECORD, { urls })

const folded = (events) => {
  let state = mergeArchiveProjection.init()
  for (const event of events) {
    state = mergeArchiveProjection.apply(state, event)
  }
  return state
}

await test('기록이 없으면 보관 근거도 없다', () => {
  assert.deepEqual(folded([]), { archived: [] })
})

await test('보관에 쓴 URL을 모은다', () => {
  assert.deepEqual(folded([archived(['a']), archived(['b'])]), { archived: ['a', 'b'] })
})

await test('이미 모은 URL은 다시 넣지 않는다', () => {
  assert.deepEqual(folded([archived(['a']), archived(['a'])]), { archived: ['a'] })
})

await test('다른 플러그인 기록과 알아보지 못한 본문은 무시한다', () => {
  const state = folded([
    eventOf('plugin:forge-session/binding', { action: 'track', url: 'https://example.invalid/1' }),
    archived('not-a-list'),
    eventOf(ARCHIVED_RECORD, null),
    archived(['a']),
  ])
  assert.deepEqual(state, { archived: ['a'] })
})

await test('투영 정의는 기록 이름과 상태 버전을 고정한다', () => {
  assert.equal(mergeArchiveProjection.key, 'forgeMergeArchive')
  assert.equal(mergeArchiveProjection.stateVersion, 1)
})
