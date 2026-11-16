import assert from 'node:assert/strict'
import test from 'node:test'
import { countParts } from '../src/count.ts'

await test('작은 수는 정확한 수를 반복하지 않는다', () => {
  assert.deepEqual(countParts(999, 'en'), { compact: '999' })
  assert.deepEqual(countParts(9900, 'ko-KR'), { compact: '9,900' })
})

await test('큰 수는 한국어 축약과 정확한 수를 함께 표시한다', () => {
  assert.deepEqual(countParts(839150, 'ko_KR'), { compact: '83.9만', exact: '839,150' })
  assert.deepEqual(countParts(839150, 'en'), { compact: '839K', exact: '839,150' })
})
