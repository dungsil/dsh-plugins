import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import test, { mock } from 'node:test'
import { Session, SessionId, pluginRecordOf } from '@deepseek-ai/dsh-session'

import { apply, MAX_RETRIES, RETRY_DELAY_MS } from '../dist/index.js'
import { ARCHIVED_RECORD, mergeArchiveProjection } from '../src/projection.ts'

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

const settle = async () => {
  await tick()
  await tick()
  await tick()
}

function harness(initial = [], options = {}) {
  const session = Session.create(SessionId('session-one'))
  const watches = new Set()
  const handlers = new Map()
  const cleanups = []
  const archived = []
  const archiveCalls = []
  const warnings = []
  let incoming = [...initial]
  let folded = mergeArchiveProjection.init()
  let registered = 0
  let releaseIdle
  const idle = options.gateIdle
    ? new Promise((resolve) => {
        releaseIdle = resolve
      })
    : Promise.resolve()
  const agent = {
    ctx: { fiber: { uid: 1 } },
    id: 'session-one',
    session,
    status: options.status ?? 'idle',
    whenIdle: () => idle,
  }
  const ctx = {
    fiber: { uid: 1 },
    logger: {
      warn(message) {
        warnings.push(message)
      },
    },
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
      archiveSession(sessionId, ...rest) {
        archiveCalls.push({ rest, sessionId })
        if (options.failArchive) throw new Error('active work in progress')
        archived.push(sessionId)
        ctx.workspaceRegistry.archivedSessionIds.push(sessionId)
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
    session,
    archived,
    archiveCalls,
    warnings,
    get registered() {
      return registered
    },
    get active() {
      return watches.size
    },
    set(entries) {
      incoming = entries
    },
    setStatus(status) {
      agent.status = status
    },
    releaseIdle() {
      releaseIdle?.()
    },
    /** 실제 appendPluginRecord가 남긴 이벤트를 투영에 접어 넣는다. */
    foldSessionEvents() {
      for (const event of session.snapshotEvents()) {
        folded = mergeArchiveProjection.apply(folded, event)
      }
    },
    notify() {
      for (const listener of watches) listener()
    },
    unarchive() {
      ctx.workspaceRegistry.archivedSessionIds = []
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

await test('스위치를 켜면 실제 Session에 기록을 남기고 Session을 보관한다', async () => {
  const h = harness([entry()])
  await apply(h.ctx, { archiveOnMerge: true })
  await settle()
  assert.equal(h.registered, 1)
  assert.equal(h.active, 1)
  assert.deepEqual(h.archived, ['session-one'])
  assert.deepEqual(h.warnings, [])

  const records = h.session.snapshotEvents().map(pluginRecordOf).filter(Boolean)
  assert.deepEqual(
    records.map((record) => [record.type, record.data]),
    [[ARCHIVED_RECORD, { urls: [entry().url] }]]
  )
})

await test('열린 변경 요청이 남아 있으면 보관하지 않는다', async () => {
  const h = harness([entry('merged'), entry('open', 'created', 8)])
  await apply(h.ctx, { archiveOnMerge: true })
  await settle()
  assert.deepEqual(h.archived, [])
  assert.deepEqual(h.session.snapshotEvents(), [])
})

await test('기록된 URL 집합은 보관을 풀어도 다시 보관하지 않는다', async () => {
  const h = harness([entry()])
  await apply(h.ctx, { archiveOnMerge: true })
  await settle()
  h.foldSessionEvents()
  h.unarchive()
  h.notify()
  await settle()
  assert.equal(h.archiveCalls.length, 1)
})

await test('보관을 푼 뒤 새 머지 URL이 생기면 다시 보관한다', async () => {
  const h = harness([entry('merged', 'created', 7)])
  await apply(h.ctx, { archiveOnMerge: true })
  await settle()
  h.foldSessionEvents()
  h.unarchive()
  h.set([entry('merged', 'created', 9)])
  h.notify()
  await settle()
  assert.equal(h.archiveCalls.length, 2)
})

await test('whenIdle이 끝나기 전에는 보관을 미루고 새 턴이 시작되면 재시도로 넘긴다', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness([entry()], { gateIdle: true })
    await apply(h.ctx, { archiveOnMerge: true })
    await settle()
    assert.deepEqual(h.archived, [])

    h.setStatus('running')
    h.releaseIdle()
    await settle()
    assert.deepEqual(h.archived, [])
    assert.deepEqual(h.archiveCalls, [])

    h.setStatus('idle')
    mock.timers.tick(RETRY_DELAY_MS)
    await settle()
    assert.deepEqual(h.archived, ['session-one'])
  } finally {
    mock.timers.reset()
  }
})

await test('보관 실패는 MAX_RETRIES까지만 재시도하고 stopActivity를 넘기지 않는다', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness([entry()], { failArchive: true })
    await apply(h.ctx, { archiveOnMerge: true })
    await settle()
    assert.equal(h.archiveCalls.length, 1)

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      mock.timers.tick(RETRY_DELAY_MS)
      await settle()
    }
    assert.equal(h.archiveCalls.length, 1 + MAX_RETRIES)
    mock.timers.tick(RETRY_DELAY_MS)
    await settle()
    assert.equal(h.archiveCalls.length, 1 + MAX_RETRIES)
    assert.ok(h.archiveCalls.every((call) => call.rest.length === 0))
    assert.equal(h.warnings.length, 1 + MAX_RETRIES)
  } finally {
    mock.timers.reset()
  }
})

await test('해제하면 예약된 재시도를 취소해 더 이상 보관하지 않는다', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness([entry()], { failArchive: true })
    await apply(h.ctx, { archiveOnMerge: true })
    await settle()
    assert.equal(h.archiveCalls.length, 1)
    h.dispose()
    mock.timers.tick(RETRY_DELAY_MS * 5)
    await settle()
    assert.equal(h.archiveCalls.length, 1)
  } finally {
    mock.timers.reset()
  }
})

await test('에이전트가 사라지면 감시와 예약된 재시도를 거둔다', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const h = harness([entry()], { failArchive: true })
    await apply(h.ctx, { archiveOnMerge: true })
    await settle()
    assert.equal(h.active, 1)
    h.removeAgent()
    assert.equal(h.active, 0)
    mock.timers.tick(RETRY_DELAY_MS * 5)
    await settle()
    assert.equal(h.archiveCalls.length, 1)
  } finally {
    mock.timers.reset()
  }
})

await test('재시도 상수는 한 관측의 상한을 고정한다', () => {
  assert.equal(RETRY_DELAY_MS, 5000)
  assert.equal(MAX_RETRIES, 3)
})
