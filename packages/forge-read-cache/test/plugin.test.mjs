import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { apply, inject, name } from '../dist/index.js'

const READY = { message: null, signIn: null, state: 'ready' }
const repositoryOf = (overrides = {}) => ({
  forge: 'github',
  host: 'github.com',
  name: 'repo',
  owner: 'owner',
  ...overrides,
})
const refs = [{ number: 7, repository: repositoryOf() }]

/** `ctx.forge`의 실제 인스턴스와 cordis가 제공하는 최소 경계를 갖춘 시험대. */
const harnessOf = () => {
  const handlers = new Map()
  let cleanup
  let readinessCalls = 0
  let findCalls = 0
  const forge = {
    readiness: async (_repository, _signal) => {
      readinessCalls += 1
      await Promise.resolve()
      return READY
    },
    findByHead: async (_repository, _branch, _signal) => {
      findCalls += 1
      await Promise.resolve()
      return refs
    },
    other: () => 'other',
    calls: () => ({ readiness: readinessCalls, find: findCalls }),
  }
  const originalReadiness = forge.readiness
  const originalFindByHead = forge.findByHead
  const ctx = {
    fiber: { uid: 1 },
    forge,
    reflect: {
      get(key, strict) {
        assert.equal(key, 'forge')
        assert.equal(strict, false)
        return forge
      },
    },
    on(event, handler) {
      handlers.set(event, handler)
    },
    effect(register) {
      cleanup = register()
    },
  }
  return {
    ctx,
    forge,
    changed: () => handlers.get('forge/providers-changed')?.(),
    dispose: () => cleanup?.(),
    originalReadiness,
    originalFindByHead,
  }
}

await describe('저장소 단위 forge 읽기 공유 플러그인', async () => {
  await it('forge 서비스만 주입하고 플러그인 이름을 유지한다', () => {
    assert.equal(name, 'dungsil-forge-read-cache')
    assert.deepEqual([...inject], ['forge'])
  })

  await it('같은 호스트의 로그인 확인을 한 번만 실행한다', async () => {
    const { ctx, forge } = harnessOf()
    apply(ctx)
    const first = await ctx.forge.readiness(repositoryOf(), new AbortController().signal)
    const second = await ctx.forge.readiness(repositoryOf({ host: 'GITHUB.COM' }), new AbortController().signal)
    assert.deepEqual(first, READY)
    assert.deepEqual(second, READY)
    assert.equal(forge.calls().readiness, 1)
  })

  await it('저장소와 브랜치가 같을 때만 브랜치 조회를 공유한다', async () => {
    const { ctx, forge } = harnessOf()
    apply(ctx)
    const signal = new AbortController().signal
    await ctx.forge.findByHead(repositoryOf(), 'feat/one', signal)
    await ctx.forge.findByHead(repositoryOf(), 'feat/one', signal)
    assert.equal(forge.calls().find, 1)
    await ctx.forge.findByHead(repositoryOf(), 'feat/two', signal)
    assert.equal(forge.calls().find, 2)
  })

  await it('공급자가 바뀌면 캐시한 답을 버린다', async () => {
    const { ctx, forge, changed } = harnessOf()
    apply(ctx)
    const signal = new AbortController().signal
    await ctx.forge.readiness(repositoryOf(), signal)
    changed()
    await ctx.forge.readiness(repositoryOf(), signal)
    assert.equal(forge.calls().readiness, 2)
  })

  await it('감싼 두 메서드만 바꾸고 다른 서비스 API는 그대로 둔다', () => {
    const { ctx, forge, originalReadiness, originalFindByHead } = harnessOf()
    apply(ctx)
    assert.equal(forge.other(), 'other')
    assert.notEqual(forge.readiness, originalReadiness)
    assert.notEqual(forge.findByHead, originalFindByHead)
  })

  await it('해제하면 원래 메서드를 복원한다', () => {
    const { ctx, forge, dispose, originalReadiness, originalFindByHead } = harnessOf()
    apply(ctx)
    assert.notEqual(forge.readiness, originalReadiness)
    dispose()
    assert.equal(forge.readiness, originalReadiness)
    assert.equal(forge.findByHead, originalFindByHead)
  })

  await it('해제 뒤에는 캐시가 비워져 새로 읽는다', async () => {
    const { ctx, forge, dispose } = harnessOf()
    apply(ctx)
    const signal = new AbortController().signal
    await ctx.forge.readiness(repositoryOf(), signal)
    dispose()
    await ctx.forge.readiness(repositoryOf(), signal)
    assert.equal(forge.calls().readiness, 2)
  })
})
