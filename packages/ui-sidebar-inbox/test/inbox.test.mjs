import assert from 'node:assert/strict'
import test from 'node:test'
import { placeSessions } from '../src/inbox.ts'

await test('일시정지는 보관과 고정보다 뒤이고 작업 상태보다 우선한다', () => {
  const ids = ['archived', 'pinned', 'snoozed', 'working', 'blank']
  const byId = Object.fromEntries(
    ids.map((id) => [id, { blank: id === 'blank', running: false, retainedBy: { mainView: 1 }, updatedAt: 1 }])
  )
  const list = { ids, byId, projectionsBySession: {} }
  const result = placeSessions(list, new Map(), ['pinned'], ['archived'], new Set(['working', 'snoozed']), new Set(ids))
  assert.deepEqual(Object.fromEntries([...result.placements].map(([id, value]) => [id, value.section])), {
    archived: 'Archived',
    pinned: 'Pinned',
    snoozed: 'Snoozed',
    working: 'Snoozed',
    blank: 'Inbox',
  })
})

await test('자동화 대상은 읽지 않은 완료와 작업 또는 상호작용이 없을 때만 숨긴다', () => {
  const ids = ['idle', 'unread', 'running', 'pending']
  const byId = Object.fromEntries(ids.map((id) => [id, { blank: false, running: false, retainedBy: {}, updatedAt: 1 }]))
  const statuses = new Map([
    ['idle', { completionUnread: false }],
    ['unread', { completionUnread: true }],
    ['running', { completionUnread: false, running: true }],
    ['pending', { completionUnread: false, pendingInteraction: {} }],
  ])
  const result = placeSessions(
    { ids, byId, projectionsBySession: {} },
    statuses,
    [],
    [],
    new Set(),
    new Set(),
    new Set(ids)
  )
  assert.deepEqual(
    ids.map((id) => result.placements.get(id).section),
    ['Snoozed', 'Inbox', 'Working', 'Inbox']
  )
  assert.deepEqual(result.order, ['pending', 'unread', 'running', 'idle'])
})
