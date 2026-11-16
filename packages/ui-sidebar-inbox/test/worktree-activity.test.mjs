import assert from 'node:assert/strict'
import test from 'node:test'
import { createWorktreeActivity, hasPendingHumanInput } from '../src/worktree-activity.ts'

const human = { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] }

await test('직접 제출한 내용과 첨부만 대기 입력으로 판정한다', () => {
  assert.equal(hasPendingHumanInput({ 'next-turn': [human] }), true)
  assert.equal(hasPendingHumanInput({ 'next-step': [{ ...human, content: [{ type: 'file' }] }] }), true)
  assert.equal(hasPendingHumanInput({ 'next-turn': [{ ...human, source: { kind: 'schedule' } }] }), false)
  assert.equal(
    hasPendingHumanInput({ 'next-turn': [{ ...human, content: [{ type: 'text', text: ' \u200b' }] }] }),
    false
  )
})

await test('네이티브 빈 행은 구독하지 않고 수락된 첫 입력의 생성만 작업 중으로 추적한다', async () => {
  let emit
  let disposed = 0
  const followed = []
  const activity = createWorktreeActivity(() => {})
  activity.attach({
    remote: {
      forgePanel: {
        follow(id) {
          followed.push(id)
          return {
            dispose() {
              disposed++
            },
            async *[Symbol.asyncIterator]() {
              yield await new Promise((resolve) => {
                emit = resolve
              })
              await new Promise(() => {})
            },
          }
        },
      },
    },
    on: () => () => {},
  })
  const list = {
    ids: ['blank', 'accepted'],
    byId: { blank: { blank: true }, accepted: { blank: false } },
    projectionsBySession: {
      blank: { values: { sessionListMetadata: { blank: true }, inbox: { 'next-turn': [human] } } },
      accepted: { values: { sessionListMetadata: { blank: true }, inbox: { 'next-turn': [human] } } },
    },
  }
  activity.reconcile(list, new Map())
  assert.deepEqual(followed, ['accepted'])
  emit({ worktree: { creation: { phase: 'checkout' } } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(activity.active.has('accepted'), true)
  activity.dispose()
  assert.equal(activity.active.size, 0)
  assert.equal(disposed, 1)
})
