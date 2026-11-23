import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import test from 'node:test'

import { apply, MAX_RETRIES, RETRY_DELAY_MS } from '../dist/index.js'

const ref = {
  number: 7,
  repository: { forge: 'github', host: 'github.com', name: 'repo', owner: 'owner' },
}
const entry = (state = 'merged', origin = 'created') => ({
  origin,
  ref,
  update: { snapshot: { ref, state } },
  url: 'https://github.com/owner/repo/pull/7',
})

const settle = async () => {
  await tick()
  await tick()
}

function harness(initial = []) {
  const session = { id: 'session-one' }
  const watches = new Set()
  const handlers = new Map()
  const cleanups = []
  const archived = []
  let incoming = [...initial]
  let folded = { archived: [] }
  let registered = 0
  const agent = {
    ctx: { fiber: { uid: 1 } },
    id: 'session-one',
    session,
    status: 'idle',
    whenIdle: async () => {},
  }
  const ctx = {
    fiber: { uid: 1 },
    logger: { warn() {} },
    agents: { list: () => [agent], get: (id) => (id === agent.id ? agent : undefined) },
    forgeSession: {
      changeRequests: () => incoming,
      watch(_session, notify) {
        watches.add(notify)
        return () => watches.delete(notify)
      },
    },
    sessionProjections: {
      async register(definition) {
        assert.equal(definition.key, 'forgeMergeArchive')
        registered++
        return { stateOf: () => folded }
      },
    },
    workspaceRegistry: {
      archivedSessionIds: [],
      archiveSession(id) {
        archived.push(id)
        ctx.workspaceRegistry.archivedSessionIds.push(id)
      },
    },
    effect(register) {
      const cleanup = register()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    on(name, listener) {
      handlers.set(name, listener)
    },
  }
  return {
    ctx,
    agent,
    archived,
    get registered() {
      return registered
    },
    get active() {
      return watches.size
    },
    notify() {
      for (const listener of watches) listener()
    },
    set(entries) {
      incoming = entries
    },
    record(urls) {
      folded = { archived: [...folded.archived, ...urls] }
    },
    removeAgent() {
      handlers.get('agent/disposed')?.({ agent })
    },
    dispose() {
      for (const cleanup of cleanups.reverse()) cleanup()
    },
  }
}

await test('스위치를 켜지 않으면 감시도 보관도 하지 않는다', async () => {
  const h = harness([entry()])
  await apply(h.ctx, {})
  await apply(h.ctx, { archiveOnMerge: false })
  await settle()
  assert.equal(h.registered, 0)
  assert.equal(h.active, 0)
  assert.deepEqual(h.archived, [])
})

await test('스위치를 켜면 이미 머지된 세션을 보관한다', async () => {
  const h = harness([entry()])
  await apply(h.ctx, { archiveOnMerge: true })
  await settle()
  assert.equal(h.registered, 1)
  assert.equal(h.active, 1)
  assert.deepEqual(h.archived, ['session-one'])
})

await test('열린 변경 요청이 남아 있으면 보관하지 않는다', async () => {
  const h = harness([entry('merged'), entry('open', 'created')])
  await apply(h.ctx, { archiveOnMerge: true })
  await settle()
  assert.deepEqual(h.archived, [])
})

await test('이미 보관을 기록한 URL 집합은 다시 보관하지 않는다', async () => {
  const h = harness([entry()])
  h.record([entry().url])
  await apply(h.ctx, { archiveOnMerge: true })
  await settle()
  assert.deepEqual(h.archived, [])
})

await test('세션이 사라지면 감시를 거둔다', async () => {
  const h = harness([])
  await apply(h.ctx, { archiveOnMerge: true })
  await settle()
  assert.equal(h.active, 1)
  h.removeAgent()
  assert.equal(h.active, 0)
  h.dispose()
})

await test('재시도 상수는 한 관측의 상한을 고정한다', () => {
  assert.equal(RETRY_DELAY_MS, 5000)
  assert.equal(MAX_RETRIES, 3)
})
