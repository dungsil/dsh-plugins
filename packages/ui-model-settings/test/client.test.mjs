import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Window } from 'happy-dom'
import { profileFixture } from '../../model-settings/test/profile.mjs'

await test('settings UI saves exact provider/model pairs, resets, reports conflicts and recovers from load failures', async (t) => {
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
  let client
  const require = createRequire(import.meta.url)
  window.__ModuleLoader__ = {
    load: ({ id, factory }) => {
      assert.equal(id, '@dungsil/dsh-plugin-ui-model-settings')
      client = factory((specifier) => {
        assert.ok(['react', 'react/jsx-runtime'].includes(specifier), `Unexpected host dependency: ${specifier}`)
        return require(specifier)
      })
    },
  }
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window,
    document: window.document,
    AbortController,
  })
  const h = await profileFixture()
  const ctx = new Context()
  const container = window.document.createElement('main')
  window.document.body.append(container)
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => {
      root.unmount()
      await ctx.fiber.dispose()
    })
    await h.close()
    await window.happyDOM.close()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
      else delete globalThis[key]
    }
  })
  let registration
  let Component
  ctx.provide('slots', {
    inject: (_slot, register) => register(),
    register: (options, component) => {
      registration = options
      Component = component
      return () => {}
    },
  })
  let locale = { active: 'ko' }
  const listeners = new Set()
  ctx.provide('locale', {
    getSnapshot: () => locale,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  })
  let offline = true
  ctx.provide('connection', {
    rpc: {
      call: (_channel, method, payload) => {
        if (offline) return Promise.reject(new Error('Disconnected'))
        return h.rpc(method.replace('dungsil-model-settings/', ''), payload)
      },
    },
  })
  await ctx.plugin(client)
  assert.equal(registration.name, 'settings.section')
  assert.equal(registration.label(), '상황별 모델')
  const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return
      await act(async () => {
        await delay(10)
      })
    }
    assert.fail(container.textContent)
  }
  const click = async (selector) => {
    await act(async () => {
      container.querySelector(selector).click()
    })
  }
  const select = async (value) => {
    await act(async () => {
      const element = container.querySelector('select')
      element.value = value
      element.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
  }
  await act(async () => {
    root.render(createElement(Component, registration.inject()))
  })
  await waitFor(() => container.querySelector('[role=alert]'))
  assert.equal(container.querySelector('select'), null)
  offline = false
  await click('button[type=button]')
  await waitFor(() => container.querySelector('select'))
  const selectElement = container.querySelector('select')
  assert.equal(window.document.getElementById(selectElement.getAttribute('aria-describedby')).tagName, 'SMALL')
  assert.equal(container.querySelector('label').htmlFor, selectElement.id)
  assert.equal(selectElement.value, '')
  assert.equal(container.querySelector('button[type=submit]').disabled, true)
  const pair = JSON.stringify(['auxiliary', 'title-small'])
  await select(pair)
  await click('button[type=submit]')
  await waitFor(() => container.querySelector('[role=status]'))
  assert.deepEqual((await h.rpc('describe')).value.target.route, { provider: 'auxiliary', model: 'title-small' })
  assert.equal(container.querySelector('select').value, pair)

  const target = (await h.rpc('describe')).value.target
  await h.rpc('save', { ...target, route: { provider: 'conversation', model: 'chat-large' } })
  await select('')
  await click('button[type=submit]')
  await waitFor(() => container.querySelector('[role=alert]')?.textContent.includes('다른 곳'))
  assert.deepEqual((await h.rpc('describe')).value.target.route, { provider: 'conversation', model: 'chat-large' })
  await click('button[type=button]')
  await waitFor(() => container.querySelector('select').value === JSON.stringify(['conversation', 'chat-large']))
  await select('')
  await click('button[type=submit]')
  await waitFor(() => container.querySelector('[role=status]'))
  assert.equal((await h.rpc('describe')).value.target.route, null)
  await act(async () => {
    locale = { active: 'en' }
    for (const listener of listeners) listener()
  })
  assert.equal(container.querySelector('label').textContent, 'Session title')
  assert.equal(registration.label(), 'Models by task')
})
