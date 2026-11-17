import assert from 'node:assert/strict'
import test from 'node:test'
import { countParts, countText } from '../src/count.ts'

await test('작은 수는 정확한 수를 반복하지 않는다', () => {
  assert.deepEqual(countParts(999, 'en'), { compact: '999' })
  assert.deepEqual(countParts(9900, 'ko-KR'), { compact: '9,900' })
})

await test('큰 수는 한국어 축약과 정확한 수를 함께 표시한다', () => {
  assert.deepEqual(countParts(839150, 'ko_KR'), { compact: '83.9만', exact: '839,150' })
  assert.deepEqual(countParts(839150, 'en'), { compact: '839K', exact: '839,150' })
})

await test('0은 단위나 괄호 없이 0으로 표시한다', () => {
  assert.deepEqual(countParts(0, 'ko'), { compact: '0' })
  assert.deepEqual(countParts(0, 'en'), { compact: '0' })
})

await test('누락되거나 올바르지 않은 값은 0으로 바꾸지 않고 em dash로 표시한다', () => {
  for (const value of [undefined, null, Number.NaN, Infinity, -1, 1.5, 2 ** 53])
    for (const language of ['ko', 'en']) assert.deepEqual(countParts(value, language), { compact: '—' })
})

await test('한국어는 만과 억 단위의 반올림 경계에서 다음 단위로 올린다', () => {
  assert.deepEqual(countParts(9999, 'ko'), { compact: '9,999' })
  assert.deepEqual(countParts(10000, 'ko'), { compact: '1만', exact: '10,000' })
  assert.deepEqual(countParts(99499, 'ko'), { compact: '9.9만', exact: '99,499' })
  assert.deepEqual(countParts(99500, 'ko'), { compact: '10만', exact: '99,500' })
  assert.deepEqual(countParts(999950, 'ko'), { compact: '100만', exact: '999,950' })
  assert.deepEqual(countParts(99999999, 'ko'), { compact: '1억', exact: '99,999,999' })
})

await test('한국어가 아닌 언어는 K와 M 단위를 유지하고 1000K가 되는 값은 1M으로 올린다', () => {
  assert.deepEqual(countParts(1000, 'zh'), { compact: '1K', exact: '1,000' })
  assert.deepEqual(countParts(99949, 'en'), { compact: '99.9K', exact: '99,949' })
  assert.deepEqual(countParts(99950, 'en'), { compact: '100K', exact: '99,950' })
  assert.deepEqual(countParts(999499, 'en'), { compact: '999K', exact: '999,499' })
  assert.deepEqual(countParts(999500, 'ja'), { compact: '1M', exact: '999,500' })
  assert.deepEqual(countParts(1_000_000, 'en'), { compact: '1M', exact: '1,000,000' })
})

await test('countText는 단위 단어 없이 정확한 수를 괄호에 붙이고 같으면 생략한다', () => {
  assert.equal(countText(countParts(839150, 'ko')), '83.9만 (839,150)')
  assert.equal(countText(countParts(9999, 'ko')), '9,999')
  assert.equal(countText(countParts(undefined, 'ko')), '—')
})
