import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultCheckout } from '../src/default-checkout.ts'

const panel = (extra = {}) => ({
  checkout: { state: 'ready' },
  worktree: {
    editable: true,
    blocker: null,
    request: null,
    created: null,
    creation: null,
    restoration: null,
    ...extra,
  },
})
await test('새 빈 세션에 새 워크트리 기본값을 한 번만 요청한다', () => {
  const policy = createDefaultCheckout()
  let count = 0
  const apply = () => policy.apply('id', 'worktree', panel(), true, true, () => count++)
  apply()
  apply()
  assert.equal(count, 1)
})
await test('설정과 패널이 준비되지 않았거나 조작할 수 없을 때 기다린다', () => {
  const policy = createDefaultCheckout()
  let count = 0
  const request = () => count++
  policy.apply('id', null, panel(), true, true, request)
  policy.apply('id', 'worktree', undefined, true, true, request)
  policy.apply('id', 'worktree', panel(), false, true, request)
  policy.apply('id', 'worktree', panel(), true, true, request)
  assert.equal(count, 1)
})
await test('기존 요청이나 사용자 선택 및 시작된 세션을 덮어쓰지 않는다', () => {
  const policy = createDefaultCheckout()
  let count = 0
  const request = () => count++
  policy.apply('requested', 'current', panel({ request: { from: null } }), true, true, request)
  policy.apply('requested', 'worktree', panel(), true, true, request)
  policy.mark('manual')
  policy.apply('manual', 'worktree', panel(), true, true, request)
  policy.apply('started', 'worktree', panel(), true, false, request)
  assert.equal(count, 0)
})
await test('차단된 상태와 이미 요청되거나 생성된 워크트리를 다시 요청하지 않는다', () => {
  for (const [index, extra] of [
    { blocker: 'blocked' },
    { request: { from: null } },
    { created: { branch: 'x' } },
    { creation: {} },
    { restoration: {} },
    { editable: false },
  ].entries()) {
    let count = 0
    createDefaultCheckout().apply(String(index), 'worktree', panel(extra), true, true, () => count++)
    assert.equal(count, 0)
  }
})
