import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

await test('CPA는 시간이 지나도 재진입 시 요청과 로딩 없이 캐시를 표시하고 새로고침과 연결 변경 때 다시 조회한다', async (t) => {
  const window = new Window()
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = window.document.createElement('div')
  window.document.body.append(container)
  const root = createRoot(container)
  t.after(async () => {
    await React.act(() => root.unmount())
    await window.happyDOM.close()
    globals.forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index])
      else delete globalThis[key]
    })
  })
  const require = createRequire(import.meta.url)
  let plugin, Page, props
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    document: window.document,
    MutationObserver: window.MutationObserver,
    AbortController,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id !== '@deepseek-ai/dsh-client-ui-primitives') return require(id)
            return {
              Button: ({ children, variant: _variant, icon: _icon, ...rest }) =>
                React.createElement('button', rest, children),
              Input: (rest) => React.createElement('input', rest),
              SegmentedControl: () => null,
              Tag: ({ children }) => React.createElement('span', {}, children),
              IconChevronDownOutlineRegular: () => null,
              IconRefreshOutlineRegular: () => null,
              IconSearchOutlineRegular: () => null,
            }
          })
        },
      },
    },
  })
  const listeners = new Set()
  const events = new Map()
  const requests = []
  const pending = []
  const connection = {
    generation: {
      getSnapshot: () => ({ id: 1 }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    rpc: {
      call: (_channel, method) => {
        requests.push(method.split('/').at(-1))
        return new Promise((resolve) => pending.push(resolve))
      },
    },
  }
  const snapshot = { active: 'ko' }
  const ctx = {
    get: () => connection,
    locale: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    effect: (setup) => setup(),
    on: (event, listener) => {
      const set = events.get(event) ?? new Set()
      events.set(event, set)
      set.add(listener)
      return () => set.delete(listener)
    },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, render) => {
        if (options.name === 'main') {
          Page = render
          props = options.inject()
        }
      },
    },
  }
  plugin.apply(ctx)
  const mount = () => React.act(() => root.render(React.createElement(Page, props)))
  const leave = () => React.act(() => root.render(null))
  const reply = (value) => React.act(async () => pending.shift()({ ok: true, value }))
  const view = { baseURL: 'http://localhost:8317', revision: '1', apiKeySaved: true, managementKeySaved: true }
  const account = {
    name: 'cached-account',
    provider: 'codex',
    status: 'ready',
    disabled: false,
    authIndex: 'auth-1',
    editable: true,
    supported: true,
  }
  const quota = (usedPercent) => ({
    windows: [{ id: 'primary_window', usedPercent }],
    observedAt: '2026-11-05T00:00:00Z',
  })
  await mount()
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), 'true')
  await reply(view)
  await reply([account])
  await reply(quota(27))
  assert.ok(container.textContent.includes('27%'))
  const initialRequests = [...requests]
  assert.equal(initialRequests.length, 3)
  await leave()
  t.mock.method(Date, 'now', () => Date.parse('2027-01-01T00:00:00Z'))
  await mount()
  assert.deepEqual(requests, initialRequests)
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), 'false')
  assert.ok(container.textContent.includes('cached-account'))
  assert.ok(container.textContent.includes('27%'))
  const refresh = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('새로고침'))
  assert.ok(refresh)
  await React.act(async () => refresh.click())
  assert.equal(requests.length, 4)
  await reply([account])
  await reply(quota(63))
  assert.ok(container.textContent.includes('63%'))
  await leave()
  await mount()
  assert.equal(requests.length, 5)
  assert.ok(container.textContent.includes('63%'))
  await leave()
  await React.act(async () => listeners.forEach((listener) => listener()))
  await mount()
  assert.equal(requests.length, 6)
  assert.equal(container.textContent.includes('cached-account'), false)
  await reply({ ...view, revision: '2' })
  await reply([])
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), 'false')
  await leave()
  await mount()
  assert.equal(requests.length, 7, 'empty account lists are cached too')
})
