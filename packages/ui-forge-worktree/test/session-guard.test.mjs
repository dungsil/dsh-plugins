import assert from 'node:assert/strict'
import test from 'node:test'
import { applySessionGuard, canEnter, sessionGuardProjection } from '../src/session-guard.ts'

const fold = (...events) => events.reduce(applySessionGuard, sessionGuardProjection.init())
const forge = (action) => ({ type: 'plugin:client-ui-forge/worktree', data: { action } })

await test('워크트리 요청은 확인된 취소 전까지 진입을 막는다', () => {
  assert.equal(canEnter(fold(forge('request'))), false)
  assert.equal(canEnter(fold(forge('request'), forge('cancel'))), true)
})

await test('시작된 턴이나 생성된 워크트리는 취소 후에도 진입을 막는다', () => {
  assert.equal(canEnter(fold({ type: 'turn/start' }, forge('cancel'))), false)
  assert.equal(canEnter(fold({ type: 'step/start' }, forge('cancel'))), false)
  assert.equal(canEnter(fold({ type: 'plugin:worktree/created' }, forge('cancel'))), false)
  assert.equal(canEnter(fold(forge('created'), forge('cancel'))), false)
})

await test('알 수 없는 Forge 워크트리 기록은 진입을 막는다', () => {
  assert.equal(canEnter(fold(forge('unknown'), forge('cancel'))), false)
  assert.equal(canEnter(fold({ type: 'plugin:client-ui-forge/worktree' }, forge('cancel'))), false)
  assert.equal(
    canEnter(
      fold(
        forge('request'),
        { type: 'plugin:client-ui-forge/worktree', data: { action: 'cancel', extra: true } },
        forge('cancel')
      )
    ),
    false
  )
})
