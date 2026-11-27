import assert from 'node:assert/strict'
import { setImmediate as nextMacrotask } from 'node:timers/promises'
import test from 'node:test'

import { installMetaCache } from '../src/cache.ts'

const PARENT = 'file:///profile/'

/** 마이크로태스크와 한 번의 매크로태스크를 흘려 보내 예약된 재읽기를 끝낸다. */
const drainLoop = async () => {
  await nextMacrotask()
}

/** 다른 플러그인이 인스턴스에 덮어쓰는 `metaOf` 대역이다. */
const foreign = () => 'foreign'

/** 이미 인스턴스에 덮어써져 있던 원본 대역이다. */
const inner = () => ({ title: 'inner' })

/** 원본 `PluginPackages`처럼 프로토타입에 `metaOf`가 있는 서비스 대역이다. */
class FakeService {
  resolution = {}
  calls = []
  values = new Map()
  cost = 0
  failWith = null
  clock = { now: 0 }

  metaOf(specifier) {
    this.calls.push(specifier)
    this.clock.now += this.cost
    if (this.failWith !== null) throw this.failWith
    return this.values.get(specifier)
  }
}

/** 테스트가 시계와 루프 양보를 직접 쥐는 설정이다. */
const harness = (overrides = {}) => {
  const service = new FakeService()
  const yields = { count: 0 }
  const options = {
    now: () => service.clock.now,
    yieldToLoop: async () => {
      yields.count += 1
      await Promise.resolve()
    },
    ...overrides,
  }
  const cache = installMetaCache(service, options)
  return { cache, flush: drainLoop, service, yields }
}

await test('미스는 원본을 한 번 부르고 적중은 원본을 부르지 않고 즉시 돌려준다', () => {
  const { service } = harness()
  service.values.set('a', { title: 'A' })

  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'A' })
  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'A' })
  assert.deepStrictEqual(service.calls, ['a'])
})

await test('호출자가 돌려받은 값을 고쳐도 캐시에 번지지 않는다', () => {
  const { service } = harness()
  service.values.set('a', { title: 'A' })
  service.metaOf('a', PARENT)

  const hit = service.metaOf('a', PARENT)
  Reflect.set(hit, 'title', 'mutated')

  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'A' })
})

await test('undefined 결과와 오류 결과도 캐시한다', () => {
  const { service } = harness()
  service.values.set('broken', { error: 'Plugin metadata for broken: x' })

  assert.equal(service.metaOf('absent', PARENT), undefined)
  assert.equal(service.metaOf('absent', PARENT), undefined)
  assert.deepStrictEqual(service.metaOf('broken', PARENT), { error: 'Plugin metadata for broken: x' })
  assert.deepStrictEqual(service.metaOf('broken', PARENT), { error: 'Plugin metadata for broken: x' })
  assert.deepStrictEqual(service.calls, ['absent', 'broken'])
})

await test('같은 specifier라도 parentURL이 다르면 따로 보관한다', () => {
  const { service } = harness()
  service.values.set('a', { title: 'A' })

  service.metaOf('a', PARENT)
  service.metaOf('a', 'file:///other/')

  assert.deepStrictEqual(service.calls, ['a', 'a'])
})

await test('용량을 넘으면 가장 오래 쓰지 않은 항목부터 버린다', () => {
  const { cache, service } = harness({ capacity: 2 })
  service.metaOf('a', PARENT)
  service.metaOf('b', PARENT)
  service.metaOf('a', PARENT)
  service.metaOf('c', PARENT)

  assert.equal(cache.size(), 2)
  service.calls.length = 0
  service.metaOf('a', PARENT)
  service.metaOf('b', PARENT)
  assert.deepStrictEqual(service.calls, ['b'])
})

await test('적중한 값은 한 번 뒤처지고 뒤에서 다시 읽어 다음 읽기에 새 값을 준다', async () => {
  const { flush, service } = harness({ revalidateIntervalMs: 0 })
  service.values.set('a', { title: 'old' })
  service.metaOf('a', PARENT)
  service.values.set('a', { title: 'new' })

  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'old' })
  await flush()
  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'new' })
})

await test('재읽기는 호출 안에서 돌지 않고 같은 키의 중복 요청은 한 번만 읽는다', async () => {
  const { flush, service } = harness({ revalidateIntervalMs: 0 })
  service.values.set('a', { title: 'A' })
  service.metaOf('a', PARENT)
  service.calls.length = 0

  service.metaOf('a', PARENT)
  service.metaOf('a', PARENT)
  service.metaOf('a', PARENT)
  assert.deepStrictEqual(service.calls, [])
  await flush()
  assert.deepStrictEqual(service.calls, ['a'])
})

await test('최소 간격 안의 반복 읽기는 재읽기를 만들지 않는다', async () => {
  const { flush, service } = harness({ revalidateIntervalMs: 1000 })
  service.metaOf('a', PARENT)
  service.calls.length = 0

  service.metaOf('a', PARENT)
  await flush()
  assert.deepStrictEqual(service.calls, [])

  service.clock.now += 1000
  service.metaOf('a', PARENT)
  await flush()
  assert.deepStrictEqual(service.calls, ['a'])
})

await test('재읽기는 조각 시간을 넘기기 전에 루프에 양보한다', async () => {
  const { flush, service, yields } = harness({ revalidateIntervalMs: 0, sliceMs: 8 })
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) service.metaOf(key, PARENT)
  service.cost = 5
  service.calls.length = 0
  const before = yields.count
  for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) service.metaOf(key, PARENT)
  await flush()

  assert.equal(service.calls.length, 6)
  assert.equal(yields.count - before, 3)
})

await test('재읽기가 던지면 이전 값을 그대로 둔다', async () => {
  const { flush, service } = harness({ revalidateIntervalMs: 0 })
  service.values.set('a', { title: 'A' })
  service.metaOf('a', PARENT)
  service.failWith = new Error('disk')

  service.metaOf('a', PARENT)
  await flush()
  service.failWith = null

  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'A' })
})

await test('해석 객체 정체성이 바뀌면 모든 항목을 버린다', () => {
  const { service } = harness()
  service.values.set('a', { title: 'A' })
  service.metaOf('a', PARENT)
  service.resolution = {}
  service.calls.length = 0

  service.metaOf('a', PARENT)

  assert.deepStrictEqual(service.calls, ['a'])
})

await test('drop은 항목과 대기 중인 재읽기를 비운다', async () => {
  const { cache, flush, service } = harness({ revalidateIntervalMs: 0 })
  service.metaOf('a', PARENT)
  service.metaOf('a', PARENT)
  service.calls.length = 0

  cache.drop()
  await flush()

  assert.deepStrictEqual(service.calls, [])
  assert.equal(cache.size(), 0)
})

const keys = ['a', 'b', 'c', 'd', 'e'].map((specifier) => ({ parentURL: PARENT, specifier }))

await test('없는 키만 채우고 조각 사이에 양보한다', async () => {
  const { cache, service, yields } = harness({ sliceMs: 8 })
  service.metaOf('a', PARENT)
  service.cost = 5
  service.calls.length = 0

  await cache.prewarm(keys)

  assert.deepStrictEqual(service.calls, ['b', 'c', 'd', 'e'])
  assert.ok(yields.count >= 1)
  service.calls.length = 0
  service.metaOf('e', PARENT)
  assert.deepStrictEqual(service.calls, [])
})

await test('조각 사이에 drop이 오면 남은 키를 더 읽지 않는다', async () => {
  const { cache, service } = harness({ sliceMs: 8 })
  service.cost = 5

  const running = cache.prewarm(keys)
  cache.drop()
  await running

  assert.ok(service.calls.length < keys.length)
  assert.equal(cache.size(), 0)
})

await test('dispose되면 멈추고 새 항목을 채우지 않는다', async () => {
  const { cache, service } = harness({ sliceMs: 8 })
  service.cost = 5

  const running = cache.prewarm(keys)
  cache.dispose()
  await running

  assert.equal(cache.size(), 0)
  assert.ok(service.calls.length < keys.length)
})

await test('한 항목이 던져도 나머지는 계속 채운다', async () => {
  const { cache, service } = harness()
  service.failWith = new Error('disk')
  await cache.prewarm(keys.slice(0, 1))
  service.failWith = null

  await cache.prewarm(keys)

  assert.equal(cache.size(), keys.length)
})

await test('설치하면 인스턴스에 덮어쓰고 dispose가 원래 프로토타입 메서드로 되돌린다', () => {
  const { cache, service } = harness()
  assert.equal(Object.hasOwn(service, 'metaOf'), true)

  cache.dispose()

  assert.equal(Object.hasOwn(service, 'metaOf'), false)
  service.values.set('a', { title: 'A' })
  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'A' })
  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'A' })
  assert.deepStrictEqual(service.calls, ['a', 'a'])
})

await test('해제 뒤에는 캐시를 쓰지 않고 다른 플러그인이 덮어쓴 속성은 건드리지 않는다', () => {
  const { cache, service } = harness()
  Object.defineProperty(service, 'metaOf', { configurable: true, value: foreign, writable: true })

  cache.dispose()

  assert.equal(service.metaOf('a', PARENT), 'foreign')
})

await test('이미 인스턴스에 덮어쓴 메서드가 있으면 그것을 원본으로 삼고 해제 때 되돌린다', () => {
  const service = new FakeService()
  Object.defineProperty(service, 'metaOf', { configurable: true, value: inner, writable: true })

  const cache = installMetaCache(service)
  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'inner' })
  cache.dispose()

  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'inner' })
  assert.equal(Object.getOwnPropertyDescriptor(service, 'metaOf')?.value, inner)
})

await test('metaOf가 없는 서비스는 감싸지 않는다', async () => {
  const cache = installMetaCache({})

  await cache.prewarm([{ parentURL: PARENT, specifier: 'a' }])
  cache.drop()
  cache.dispose()

  assert.equal(cache.size(), 0)
})

await test('직렬화할 수 없는 값은 캐시하지 않고 원본 값을 그대로 돌려준다', () => {
  const { cache, service } = harness()
  const cyclic = {}
  cyclic.self = cyclic
  service.values.set('a', cyclic)

  assert.equal(service.metaOf('a', PARENT), cyclic)
  assert.equal(service.metaOf('a', PARENT), cyclic)
  assert.deepStrictEqual(service.calls, ['a', 'a'])
  assert.equal(cache.size(), 0)
})

await test('미스에서 원본이 던지면 그 오류가 그대로 전해지고 캐시되지 않는다', () => {
  const { cache, service } = harness()
  service.failWith = new Error('resolver unavailable')

  assert.throws(() => service.metaOf('a', PARENT), /resolver unavailable/)
  assert.equal(cache.size(), 0)
})

await test('해석 객체를 읽다 던지면 원본으로 답한다', () => {
  const { service } = harness()
  service.values.set('a', { title: 'A' })
  Object.defineProperty(service, 'resolution', {
    configurable: true,
    get: () => {
      throw new Error('revoked')
    },
  })

  assert.deepStrictEqual(service.metaOf('a', PARENT), { title: 'A' })
})
