import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Window } from 'happy-dom'

await test('commit action submits to its own session without touching the draft', async (t) => {
  const window = new Window()
  const previous = Object.getOwnPropertyDescriptors(globalThis)
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const require = createRequire(import.meta.url)
  let plugin
  window.__ModuleLoader__ = { load: ({ factory }) => (plugin = factory(require)) }
  runInThisContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'))
  const ctx = new Context()
  let Component
  ctx.provide('slots', {
    inject: (_name, register) => register(),
    register: (_options, component) => {
      Component = component
      return () => {}
    },
  })
  const locale = createSnapshotStore({ active: 'ko' })
  ctx.provide('locale', locale)
  const requests = []
  let finish
  ctx.provide('sessions', {
    scope: (sessionId) => ({
      get: () => ({
        send: (text) => {
          requests.push({ sessionId, text })
          return new Promise((resolve, reject) => {
            finish = { resolve, reject }
          })
        },
      }),
    }),
  })
  ctx.provide('conversation', {})
  await ctx.plugin(plugin)
  const container = window.document.createElement('main')
  window.document.body.append(container)
  const root = createRoot(container)
  const render = (overrides = {}) =>
    act(async () =>
      root.render(
        createElement(Component, {
          sessionId: 'session-a',
          useSession: (selector) =>
            selector({ running: false, removed: false, openState: 'open', pendingSubmissions: [], ...overrides }),
          useAccess: () => true,
          ...overrides,
        })
      )
    )
  const button = () => container.querySelector('button')
  t.after(async () => {
    await act(async () => root.unmount())
    await ctx.fiber.dispose()
    await window.happyDOM.close()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
      else delete globalThis[key]
    }
  })

  await t.test('one request preserves an unrelated composer draft and blocks double clicks', async () => {
    const draft = window.document.createElement('textarea')
    draft.value = 'Unsent task with @file references'
    window.document.body.append(draft)
    await render()
    await act(async () => {
      button().click()
      button().click()
    })
    assert.equal(requests.length, 1)
    assert.equal(requests[0].sessionId, 'session-a')
    assert.match(requests[0].text, /Write the commit message, PR title, and PR body yourself/)
    assert.match(requests[0].text, /preserve unrelated edits and staged changes/)
    assert.match(requests[0].text, /otherwise read its current title and body/)
    assert.match(requests[0].text, /Do not force-push/)
    assert.equal(button().disabled, true)
    assert.equal(button().getAttribute('aria-busy'), 'true')
    await act(async () => finish.resolve())
    assert.match(container.querySelector('[role=status]').textContent, /요청했습니다/)
    assert.equal(draft.value, 'Unsent task with @file references')
  })

  await t.test('running, loading, removed, pending and read-only sessions cannot submit', async () => {
    for (const overrides of [
      { running: true },
      { openState: 'opening' },
      { removed: true },
      { pendingSubmissions: [{}] },
      { useAccess: () => false },
    ]) {
      await render(overrides)
      assert.equal(button().disabled, true)
      await act(async () => button().click())
    }
    assert.equal(requests.length, 1)
  })

  await t.test('navigation isolates pending results and errors never automatically retry', async () => {
    await render()
    await act(async () => button().click())
    const old = finish
    await render({ sessionId: 'session-b' })
    assert.equal(button().disabled, false)
    await act(async () => old.reject(new Error('Disconnected after admission')))
    assert.equal(container.querySelector('[role=alert]'), null)
    await act(async () => button().click())
    assert.equal(requests.at(-1).sessionId, 'session-b')
    await act(async () => finish.reject(new Error('Disconnected')))
    assert.match(container.querySelector('[role=alert]').textContent, /대화를 확인/)
    await act(async () => locale.set({ active: 'en' }))
    assert.match(container.querySelector('[role=alert]').textContent, /Check the conversation/)
    await act(async () => locale.set({ active: 'zh-CN' }))
    assert.equal(button().textContent, '提交、推送与 PR')
    assert.match(container.querySelector('[role=alert]').textContent, /请先检查对话/)
    assert.equal(requests.length, 3)
  })
})
