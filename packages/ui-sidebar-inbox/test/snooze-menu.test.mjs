import assert from 'node:assert/strict'
import test from 'node:test'
import { installSnoozeMenu } from '../src/snooze-menu.ts'

await test('기본 행에만 일시정지 메뉴를 등록하고 선택과 해제를 전달한다', () => {
  let source, selection
  const values = new Map()
  const ids = ['normal', 'blank', 'pinned', 'archived', 'child']
  const byId = Object.fromEntries(
    ids.map((id) => [id, { blank: id === 'blank', origin: id === 'child' ? 'subagent' : undefined }])
  )
  const observable = { getSnapshot: () => null, subscribe: () => () => {} }
  const state = {
    getSnapshot: () => values,
    subscribe: observable.subscribe,
    snooze: (id, choice) => {
      selection = [id, choice]
    },
    wake: (id) => {
      selection = [id, 'wake']
    },
  }
  let active = true,
    flat = true,
    available = false
  const stop = installSnoozeMenu({
    contextMenus: {
      register(value) {
        source = value
        return () => {
          source = undefined
        }
      },
    },
    sessions: { list: { getSnapshot: () => ({ ids, byId }) } },
    workspaces: { list: { getSnapshot: () => ({ pinnedSessionIds: ['pinned'], archivedSessionIds: ['archived'] }) } },
    state,
    locale: observable,
    agent: {
      available: () => available,
      subscribe: observable.subscribe,
      choose: (id) => {
        selection = [id, 'agent']
      },
    },
    isActive: () => active,
    isFlat: () => flat,
    translate: (key) => key,
  })
  assert.equal(source.target, 'session')
  assert.equal(source.observe().length, 5)
  for (const id of ['blank', 'pinned', 'archived', 'child', 'missing'])
    assert.deepEqual(source.resolve({ sessionId: id }), [])
  let children = source.resolve({ sessionId: 'normal' })[0].children
  assert.deepEqual(
    children.map((item) => item.id),
    ['30m', '1h', '3h', 'tomorrow']
  )
  children[0].run()
  assert.deepEqual(selection, ['normal', '30m'])
  available = true
  children = source.resolve({ sessionId: 'normal' })[0].children
  children.at(-1).run()
  assert.deepEqual(selection, ['normal', 'agent'])
  values.set('normal', 123)
  source.resolve({ sessionId: 'normal' })[0].run()
  assert.deepEqual(selection, ['normal', 'wake'])
  active = false
  assert.deepEqual(source.resolve({ sessionId: 'normal' }), [])
  active = true
  flat = false
  assert.deepEqual(source.resolve({ sessionId: 'normal' }), [])
  stop()
  assert.equal(source, undefined)
})
