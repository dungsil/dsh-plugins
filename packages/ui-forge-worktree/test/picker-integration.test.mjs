import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((done) => (resolve = done))
  return { promise, resolve }
}
const panel = (request = null) => ({
  directory: '/repo',
  checkout: { state: 'ready', checkout: { branch: 'main', commit: 'abc' } },
  worktree: {
    editable: true,
    blocker: null,
    request,
    created: null,
    creation: null,
    restoration: null,
    waiting: null,
    failure: null,
    missing: null,
  },
})
async function mount(t, { snapshot = {}, touched = false } = {}) {
  const window = new Window()
  const previous = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(window.document.body.appendChild(window.document.createElement('div')))
  const preference = deferred(),
    streams = [],
    calls = [],
    cleanups = [],
    registrations = []
  const remote = {
    follow() {
      const queue = [],
        pending = []
      let done = false
      const stream = {
        push(value) {
          if (pending.length) pending.shift()({ value, done: false })
          else queue.push(value)
        },
        dispose() {
          done = true
          for (const resolve of pending.splice(0)) resolve({ done: true })
        },
        next() {
          if (queue.length) return Promise.resolve({ value: queue.shift(), done: false })
          if (done) return Promise.resolve({ done: true })
          return new Promise((resolve) => pending.push(resolve))
        },
        [Symbol.asyncIterator]() {
          return this
        },
      }
      streams.push(stream)
      return stream
    },
    requestWorktree: async (...args) => {
      calls.push(['new', ...args])
      return { ok: true }
    },
    cancelWorktree: async (...args) => {
      calls.push(['current', ...args])
      return { ok: true }
    },
  }
  const require = createRequire(import.meta.url)
  let plugin
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    AbortController,
    setTimeout,
    clearTimeout,
    document: window.document,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) =>
            id === '@deepseek-ai/dsh-client-ui-primitives'
              ? {
                  IconChevronDownOutlineRegular: () => React.createElement('svg'),
                  IconBranchOutlineRegular: () => React.createElement('svg'),
                  IconPlusOutlineRegular: () => React.createElement('svg'),
                  IconCheckOutlineRegular: () => React.createElement('svg'),
                  Menu: ({ anchor, open, children }) => React.createElement('div', null, anchor, open && children),
                  MenuItemButton: ({ children, onClick }) => React.createElement('button', { onClick }, children),
                }
              : require(id)
          )
        },
      },
    },
  })
  const ctx = {
    remote: { forgePanel: remote },
    get: () => ({ rpc: { call: () => preference.promise } }),
    locale: { getSnapshot: () => locale, subscribe: () => () => {} },
    on: () => () => {},
    slots: {
      inject: (_key, fn) => fn(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    effect: (fn) => {
      const dispose = fn()
      if (dispose) cleanups.push(dispose)
      return () => {}
    },
  }
  const locale = { active: 'en' }
  plugin.apply(ctx)
  const Picker = registrations[1].component
  const state = {
    blank: true,
    promptAttempted: false,
    running: false,
    removed: false,
    openState: 'open',
    pendingSubmissions: [],
    ...snapshot,
  }
  await React.act(async () => {
    root.render(
      React.createElement(Picker, {
        sessionId: 'session',
        useSession: (fn) => fn(state),
        useInput: (fn) => fn({ phase: 'plain' }),
        useProjection: () => touched,
      })
    )
    await tick()
  })
  await React.act(async () => {
    streams[0].push(panel())
    await tick()
  })
  t.after(async () => {
    await React.act(async () => root.unmount())
    cleanups.reverse().forEach((dispose) => dispose())
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  return { window, preference, streams, calls }
}
await test('지연된 기본값은 준비된 빈 입력창에서 한 번만 요청한다', async (t) => {
  const h = await mount(t)
  assert.equal(h.calls.length, 0)
  await React.act(async () => {
    h.preference.resolve({ ok: true, value: { defaultCheckout: 'worktree' } })
    await tick()
  })
  assert.deepEqual(
    h.calls.map((call) => call[0]),
    ['new']
  )
  await React.act(async () => {
    h.streams[1].push(panel({ from: null }))
    await tick()
  })
  assert.equal(h.calls.length, 1)
})
await test('설정이 도착하기 전에 사용자가 메뉴를 열면 자동 요청하지 않는다', async (t) => {
  const h = await mount(t)
  await React.act(async () => {
    h.window.document.querySelector('button').click()
    await tick()
  })
  await React.act(async () => {
    h.preference.resolve({ ok: true, value: { defaultCheckout: 'worktree' } })
    await tick()
  })
  assert.equal(h.calls.length, 0)
})
await test('첫 프롬프트가 수락되어 턴이 시작되기 전에는 자동 요청하지 않는다', async (t) => {
  const h = await mount(t, { snapshot: { blank: false, promptAttempted: true, awaitingFirstTurn: true } })
  await React.act(async () => {
    h.preference.resolve({ ok: true, value: { defaultCheckout: 'worktree' } })
    await tick()
  })
  assert.equal(h.calls.length, 0)
})
await test('이전 Forge 선택 기록이 있는 빈 세션은 새 클라이언트에서도 자동 요청하지 않는다', async (t) => {
  const h = await mount(t, { touched: true })
  await React.act(async () => {
    h.preference.resolve({ ok: true, value: { defaultCheckout: 'worktree' } })
    await tick()
  })
  assert.equal(h.calls.length, 0)
})
