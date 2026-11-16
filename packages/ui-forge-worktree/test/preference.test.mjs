import assert from 'node:assert/strict'
import test from 'node:test'
import * as plugin from '../dist/index.js'

async function fixture({ updateConfig = true } = {}) {
  const handlers = new Map()
  let value = 'current'
  let stored = { other: 42 }
  let fail = false
  const ctx = {
    fiber: { entry: {} },
    inject(_names, callback) {
      callback({ effect: (fn) => fn(), settings: { configure: () => () => {} } })
    },
    sessionProjections: { register: async () => ({}) },
    configEditor: {
      async edit(_entry, callback) {
        if (fail) throw Error('unavailable')
        stored = callback(stored, { inherited: true })
        if (updateConfig) value = stored.defaultCheckout
      },
    },
    connection: {
      fetch: {
        register(route) {
          handlers.set(route.path, route.fetch)
          return () => {}
        },
      },
    },
    effect(fn) {
      fn()
    },
  }
  await plugin.apply(ctx, { defaultCheckout: { get: () => value } })
  return {
    async rpc(method, payload) {
      const response = await handlers.get(`/api/${method}`)(
        new Request(`http://localhost/api/${method}`, {
          method: 'POST',
          body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
        })
      )
      return (await response.json()).result
    },
    stored: () => stored,
    fail: () => {
      fail = true
    },
  }
}
await test('선택적 settings 정책은 자동 폼을 숨기고 해제 함수를 반환한다', async () => {
  const fiber = { entry: {} }
  const dispose = () => {}
  let cleanup
  let configured
  await plugin.apply(
    {
      fiber,
      inject(names, callback) {
        assert.deepEqual(names, ['settings'])
        callback({
          effect(fn) {
            cleanup = fn()
          },
          settings: {
            configure(options, owner) {
              configured = { options, owner }
              return dispose
            },
          },
        })
      },
      sessionProjections: { register: async () => ({}) },
      effect() {},
    },
    { defaultCheckout: { get: () => 'current' } }
  )
  assert.deepEqual(configured, { options: { auto: false }, owner: fiber })
  assert.equal(cleanup, dispose)
})
await test('기존 Forge 요청과 취소 기록 및 턴 시작은 다시 기본값을 적용하지 않도록 표시한다', () => {
  const projection = plugin.eligibilityProjection
  const record = (type, data) => ({ type, data, ignorable: true, seq: 0, time: 0 })
  let state = projection.init()
  assert.equal(state, false)
  state = projection.apply(state, record('plugin:client-ui-forge/worktree', { action: 'request', from: null }))
  state = projection.apply(state, record('plugin:client-ui-forge/worktree', { action: 'cancel' }))
  assert.equal(state, true)
  assert.equal(projection.apply(false, { type: 'turn/start' }), true)
  assert.equal(projection.apply(false, record('plugin:worktree/created', {})), true)
  assert.equal(projection.apply(false, record('plugin:other/value', {})), false)
})
await test('기본값을 읽고 다른 설정을 보존하며 새 선택을 저장한다', async () => {
  const h = await fixture()
  assert.equal((await h.rpc('dungsil-worktree-preference/read', {})).value.defaultCheckout, 'current')
  assert.equal(
    (await h.rpc('dungsil-worktree-preference/save', { defaultCheckout: 'worktree' })).value.defaultCheckout,
    'worktree'
  )
  assert.deepEqual(h.stored(), { inherited: true, other: 42, defaultCheckout: 'worktree' })
})
await test('설정 반영이 지연되어도 저장한 값을 응답한다', async () => {
  const h = await fixture({ updateConfig: false })
  assert.equal(
    (await h.rpc('dungsil-worktree-preference/save', { defaultCheckout: 'worktree' })).value.defaultCheckout,
    'worktree'
  )
  assert.equal((await h.rpc('dungsil-worktree-preference/read', {})).value.defaultCheckout, 'current')
})
await test('잘못된 값과 저장 실패를 성공으로 보고하지 않는다', async () => {
  const h = await fixture()
  for (const payload of [{ defaultCheckout: 'other' }, { defaultCheckout: 'current', extra: true }, null])
    assert.equal((await h.rpc('dungsil-worktree-preference/save', payload)).ok, false)
  h.fail()
  assert.equal((await h.rpc('dungsil-worktree-preference/save', { defaultCheckout: 'worktree' })).ok, false)
  assert.deepEqual(h.stored(), { other: 42 })
})
