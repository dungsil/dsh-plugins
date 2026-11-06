import assert from 'node:assert/strict'
import test from 'node:test'
import { isOwnedDescendant } from '../src/archive.ts'

const headers = new Map([
  ['owner', { id: 'owner' }],
  ['child', { id: 'child', parentSession: 'owner', origin: 'subagent' }],
  ['nested', { id: 'nested', parentSession: 'child', origin: 'subagent' }],
  ['fork', { id: 'fork', parentSession: 'owner' }],
  ['fork-child', { id: 'fork-child', parentSession: 'fork', origin: 'subagent' }],
  ['foreign', { id: 'foreign', parentSession: 'other', origin: 'subagent' }],
  ['missing', { id: 'missing', parentSession: 'unknown', origin: 'subagent' }],
  ['cycle', { id: 'cycle', parentSession: 'cycle', origin: 'subagent' }],
])

await test('직접 생성한 하위 에이전트와 중첩 자손만 소유 세션의 자손으로 판단한다', () => {
  assert.equal(isOwnedDescendant('child', 'owner', headers), true)
  assert.equal(isOwnedDescendant('nested', 'owner', headers), true)
})

await test('소유 세션 자체와 독립 포크 및 그 하위 에이전트는 삭제 예외로 판단하지 않는다', () => {
  for (const id of ['owner', 'fork', 'fork-child', 'foreign'])
    assert.equal(isOwnedDescendant(id, 'owner', headers), false)
})

await test('누락된 부모나 순환하는 계보는 삭제 예외로 판단하지 않는다', () => {
  for (const id of ['missing', 'unknown', 'cycle']) assert.equal(isOwnedDescendant(id, 'owner', headers), false)
})
