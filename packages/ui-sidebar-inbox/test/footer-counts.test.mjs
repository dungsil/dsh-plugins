import assert from 'node:assert/strict'
import test from 'node:test'
import { countFooterSections } from '../src/footer-counts.ts'

await test('하단에 실제 표시된 행만 섹션별로 센다', () => {
  assert.deepEqual(countFooterSections(['Working', 'Archived', 'Working']), { Working: 2, Archived: 1 })
})

await test('빈 하단 목록은 각 섹션을 0으로 센다', () => {
  assert.deepEqual(countFooterSections([]), { Working: 0, Archived: 0 })
})
