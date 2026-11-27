import assert from 'node:assert/strict'
import { setImmediate as nextMacrotask } from 'node:timers/promises'
import test, { mock } from 'node:test'

import { apply } from '../dist/index.js'

const ROOT_URL = 'file:///profile/'
const OTHER_URL = 'file:///profile/other/'

/** 원본 `PluginPackages`처럼 프로토타입에 `metaOf`가 있는 서비스 대역이다. */
class FakePackages {
  resolution = {}
  calls = []

  metaOf(specifier, parentURL) {
    this.calls.push(`${parentURL}|${specifier}`)
    return { title: specifier }
  }
}

const tree = (baseUrl) => ({ tree: { ctx: { baseUrl } } })

/** 행 컨텍스트 대역이다. Loader 엔트리와 프리셋 행은 인벤토리가 읽는 모양을 따른다. */
const createHost = (options = {}) => {
  const packages = new FakePackages()
  const cleanups = []
  const listeners = new Map()
  const services = {
    ...(options.packages === false ? {} : { pluginPackages: packages }),
    ...(options.loader === false
      ? {}
      : {
          loader: {
            entries: () => [
              { options: { group: true, name: 'group' }, parent: tree(ROOT_URL) },
              { options: { name: 'plain-a' }, parent: tree(ROOT_URL) },
              { options: { name: 'nested-b' }, parent: tree(OTHER_URL) },
              { options: { name: 'no-base' }, parent: { tree: { ctx: {} } } },
            ],
          },
        }),
    ...(options.presets === false
      ? {}
      : {
          agentPresets: {
            compositionInventory: async () => {
              await Promise.resolve()
              return [{ rows: [{ moduleName: 'preset-c' }, { moduleName: 'preset-d' }] }]
            },
          },
        }),
  }
  const ctx = {
    baseUrl: ROOT_URL,
    effect: (setup) => {
      const cleanup = setup()
      if (cleanup !== undefined) cleanups.push(cleanup)
    },
    get: (service) => services[service],
    on: (event, listener) => {
      listeners.set(event, listener)
      return () => {
        if (listeners.get(event) === listener) listeners.delete(event)
      }
    },
  }
  return {
    cleanups,
    ctx,
    emit: (event) => listeners.get(event)?.(),
    listeners,
    packages,
  }
}

const settle = async (milliseconds) => {
  mock.timers.tick(milliseconds)
  await nextMacrotask()
}

/** 가상 시계를 켜고 테스트를 실행한 뒤 항상 되돌린다. */
const withTimers = async (body) => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    await body()
  } finally {
    mock.timers.reset()
  }
}

await test('적용하면 metaOf를 감싸고 해제하면 원래 메서드로 되돌린다', () => {
  const host = createHost()

  apply(host.ctx)
  assert.equal(Object.hasOwn(host.packages, 'metaOf'), true)
  for (const cleanup of host.cleanups) cleanup()

  assert.equal(Object.hasOwn(host.packages, 'metaOf'), false)
  assert.equal(host.listeners.size, 0)
})

await test('pluginPackages 서비스가 없으면 아무것도 하지 않는다', () => {
  const host = createHost({ packages: false })

  apply(host.ctx)

  assert.equal(host.cleanups.length, 0)
})

await test('무효화 이벤트 네 가지를 구독한다', () => {
  const host = createHost()

  apply(host.ctx)

  assert.deepStrictEqual(
    [...host.listeners.keys()].sort((a, b) => a.localeCompare(b)),
    ['app-boot/config-reload', 'hmr/change', 'hmr/reload', 'plugin-manager/changed']
  )
})

for (const event of ['plugin-manager/changed', 'app-boot/config-reload', 'hmr/change', 'hmr/reload']) {
  await test(`${event} 이벤트가 오면 캐시를 버려 다음 읽기가 원본을 읽는다`, () => {
    const host = createHost()
    apply(host.ctx)
    host.packages.metaOf('x', ROOT_URL)
    host.packages.metaOf('x', ROOT_URL)
    assert.deepStrictEqual(host.packages.calls, [`${ROOT_URL}|x`])

    host.emit(event)
    host.packages.metaOf('x', ROOT_URL)

    assert.deepStrictEqual(host.packages.calls, [`${ROOT_URL}|x`, `${ROOT_URL}|x`])
  })
}

await test('기동 지연 뒤 인벤토리와 같은 키로 예열한다', () =>
  withTimers(async () => {
    const host = createHost()
    apply(host.ctx)

    await settle(1499)
    assert.deepStrictEqual(host.packages.calls, [])
    await settle(10)

    // 그룹 행과 베이스 URL이 없는 엔트리는 건너뛰고, 프리셋 행은 이 컨텍스트의 베이스 URL을 쓴다.
    assert.deepStrictEqual(
      host.packages.calls.sort((a, b) => a.localeCompare(b)),
      [`${ROOT_URL}|plain-a`, `${OTHER_URL}|nested-b`, `${ROOT_URL}|preset-c`, `${ROOT_URL}|preset-d`].sort((a, b) =>
        a.localeCompare(b)
      )
    )
    host.packages.calls.length = 0
    host.packages.metaOf('plain-a', ROOT_URL)
    host.packages.metaOf('nested-b', OTHER_URL)
    host.packages.metaOf('preset-d', ROOT_URL)
    assert.deepStrictEqual(host.packages.calls, [])
  }))

await test('무효화 뒤에는 짧은 대기 후 다시 예열한다', () =>
  withTimers(async () => {
    const host = createHost()
    apply(host.ctx)
    await settle(2000)
    host.packages.calls.length = 0

    host.emit('hmr/change')
    host.emit('hmr/change')
    await settle(400)
    assert.deepStrictEqual(host.packages.calls, [])
    await settle(200)

    assert.equal(host.packages.calls.length, 4)
  }))

await test('해제하면 예약된 예열이 돌지 않는다', () =>
  withTimers(async () => {
    const host = createHost()
    apply(host.ctx)

    for (const cleanup of host.cleanups) cleanup()
    await settle(5000)

    assert.deepStrictEqual(host.packages.calls, [])
  }))

await test('Loader나 프리셋 서비스가 없어도 가진 쪽만 예열한다', () =>
  withTimers(async () => {
    const host = createHost({ presets: false })
    apply(host.ctx)

    await settle(2000)

    assert.deepStrictEqual(
      host.packages.calls.sort((a, b) => a.localeCompare(b)),
      [`${ROOT_URL}|plain-a`, `${OTHER_URL}|nested-b`].sort((a, b) => a.localeCompare(b))
    )
  }))

await test('키를 모으다 실패해도 읽기는 원본으로 정상 동작한다', () =>
  withTimers(async () => {
    const host = createHost()
    const failing = {
      ...host.ctx,
      get: (service) => {
        if (service === 'loader') throw new Error('loader unavailable')
        return host.ctx.get(service)
      },
    }
    apply(failing)

    await settle(2000)

    assert.deepStrictEqual(host.packages.metaOf('x', ROOT_URL), { title: 'x' })
  }))
