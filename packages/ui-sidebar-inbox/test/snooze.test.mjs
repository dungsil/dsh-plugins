import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSnooze, pruneSnooze, serializeSnooze, SNOOZE_KEY, snoozeDeadline, snoozeDelay } from '../src/snooze.ts'

const NOW = new Date(2026, 0, 15, 23, 30).getTime()
const MINUTE = 60_000

await test('저장 키는 dungsil 네임스페이스를 쓴다', () => {
  assert.equal(SNOOZE_KEY, 'dungsil.sidebar-inbox.snooze.v1')
})

await test('저장된 객체에서 아직 지나지 않은 만료 시각만 남긴다', () => {
  const raw = JSON.stringify({ expired: NOW - 1, live: NOW + MINUTE, nan: Number.NaN, wrong: 'soon' })
  assert.deepEqual([...parseSnooze(raw, NOW)], [['live', NOW + MINUTE]])
})

await test('에이전트 항목은 나이와 무관하게 남기고 저장 형식으로 되돌린다', () => {
  const raw = JSON.stringify({ agent: { agent: NOW - 60 * MINUTE }, broken: { agent: 'soon' }, fixed: NOW + MINUTE })
  const entries = parseSnooze(raw, NOW)
  assert.deepEqual(
    [...entries],
    [
      ['agent', { agent: NOW - 60 * MINUTE }],
      ['fixed', NOW + MINUTE],
    ]
  )
  assert.deepEqual(JSON.parse(serializeSnooze(entries)), { agent: { agent: NOW - 60 * MINUTE }, fixed: NOW + MINUTE })
})

await test('판정 함수가 없으면 에이전트 항목을 그대로 두고 있으면 판정을 따른다', () => {
  const entries = new Map([['agent', { agent: NOW }]])
  assert.equal(pruneSnooze(entries, NOW), entries)
  assert.equal(snoozeDelay(entries, NOW), undefined)
  assert.equal(
    snoozeDelay(entries, NOW, () => ({ recheckAt: NOW + MINUTE, wake: false })),
    MINUTE + 50
  )
  assert.equal(pruneSnooze(entries, NOW, () => ({ wake: true })).size, 0)
})

await test('깨진 값과 객체가 아닌 페이로드는 빈 맵으로 읽는다', () => {
  for (const raw of [null, '', '{', '[]', 'null', JSON.stringify(['s1'])]) {
    assert.equal(parseSnooze(raw, NOW).size, 0)
  }
})

await test('저장 형식을 거쳐도 항목이 그대로 복원된다', () => {
  const entries = new Map([
    ['a', NOW + MINUTE],
    ['b', NOW + 2 * MINUTE],
  ])
  assert.deepEqual([...parseSnooze(serializeSnooze(entries), NOW)], [...entries])
})

await test('만료된 항목은 첫 정리에서 버리고 바뀐 것이 없으면 같은 맵을 돌려준다', () => {
  const entries = new Map([
    ['live', NOW + MINUTE],
    ['gone', NOW],
  ])
  const pruned = pruneSnooze(entries, NOW)
  assert.deepEqual([...pruned], [['live', NOW + MINUTE]])
  assert.equal(entries.has('gone'), true)
  assert.equal(pruneSnooze(pruned, NOW), pruned)
})

await test('고정 기한은 선택한 시간만큼 뒤로 계산한다', () => {
  assert.equal(snoozeDeadline('30m', NOW), NOW + 30 * MINUTE)
  assert.equal(snoozeDeadline('1h', NOW), NOW + 60 * MINUTE)
  assert.equal(snoozeDeadline('3h', NOW), NOW + 180 * MINUTE)
})

await test('내일은 다음 날 로컬 09:00으로 계산한다', () => {
  assert.equal(snoozeDeadline('tomorrow', NOW), new Date(2026, 0, 16, 9, 0).getTime())
  assert.equal(snoozeDeadline('tomorrow', new Date(2026, 0, 16, 8, 0).getTime()), new Date(2026, 0, 17, 9, 0).getTime())
})

await test('가장 이른 기한을 기다리고 일시정지가 없으면 타이머를 걸지 않는다', () => {
  assert.equal(snoozeDelay(new Map(), NOW), undefined)
  const delay = snoozeDelay(
    new Map([
      ['late', NOW + 10 * MINUTE],
      ['early', NOW + MINUTE],
    ]),
    NOW
  )
  assert.ok(delay > MINUTE)
  assert.ok(delay < MINUTE + 1000)
})

await test('먼 기한은 타이머 최대 지연으로 제한한다', () => {
  assert.equal(snoozeDelay(new Map([['far', NOW + 30 * 24 * 60 * MINUTE]]), NOW), 2_147_483_647)
})
