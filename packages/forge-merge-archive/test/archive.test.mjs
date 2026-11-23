import assert from 'node:assert/strict'
import test from 'node:test'

import { archiveReady, countsTowardArchive, mergedUrls } from '../src/archive.ts'

const ref = {
  number: 7,
  repository: { forge: 'github', host: 'github.com', name: 'repo', owner: 'owner' },
}

const entry = (state = 'merged', origin = 'created', number = 7) => ({
  origin,
  ref,
  update: { snapshot: { ref, state } },
  url: `https://github.com/owner/repo/pull/${number}`,
})

const unpolled = () => ({ ...entry(), update: null })
const failedRead = () => ({ ...entry(), update: { error: new Error('offline') } })
const unknown = () => ({ ...entry(), ref: null })

await test('바인딩이 없으면 보관하지 않는다', () => {
  assert.equal(archiveReady([]), false)
})

await test('머지된 변경 요청만 붙어 있으면 보관한다', () => {
  assert.equal(archiveReady([entry()]), true)
})

await test('이 세션이 푸시한 분기의 머지 요청도 보관 근거다', () => {
  assert.equal(archiveReady([entry('merged', 'discovered')]), true)
})

await test('머지와 닫힘이 섞여 있으면 보관한다', () => {
  assert.equal(archiveReady([entry('merged', 'created', 1), entry('closed', 'created', 2)]), true)
})

await test('열린 변경 요청이 하나라도 있으면 보관하지 않는다', () => {
  assert.equal(archiveReady([entry('merged', 'created', 1), entry('open', 'created', 2)]), false)
})

await test('모두 닫혔기만 하면 보관하지 않는다', () => {
  assert.equal(archiveReady([entry('closed', 'created', 1), entry('closed', 'created', 2)]), false)
})

await test('첫 폴링 전이거나 읽기에 실패한 바인딩이 있으면 보관하지 않는다', () => {
  assert.equal(archiveReady([entry(), unpolled()]), false)
  assert.equal(archiveReady([entry(), failedRead()]), false)
})

await test('공급자가 알아보지 못한 URL은 판정에서 제외한다', () => {
  assert.equal(archiveReady([entry(), unknown()]), true)
  assert.equal(archiveReady([unknown()]), false)
})

await test('조회 명령이나 수동 연결로 붙은 머지 요청은 보관 근거가 아니다', () => {
  assert.equal(countsTowardArchive(entry('merged', 'referenced')), false)
  assert.equal(archiveReady([entry('merged', 'referenced')]), false)
  assert.equal(archiveReady([entry('merged', 'tracked')]), false)
  assert.deepEqual(mergedUrls([entry('merged', 'referenced')]), [])
})

await test('보관 근거로는 이 세션이 만든 머지 요청의 URL만 돌려준다', () => {
  const merged = entry('merged', 'created', 1)
  assert.deepEqual(mergedUrls([merged, entry('closed', 'created', 2), entry('merged', 'referenced', 3), unpolled()]), [
    merged.url,
  ])
})
