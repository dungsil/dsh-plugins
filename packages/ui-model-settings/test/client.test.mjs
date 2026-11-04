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
  // Only replace the host module boundary here; real Menu keyboard, portal and
  // pointer behavior is exercised in the browser with the host implementation.
  const primitives = {
    Button: ({ variant: _variant, size: _size, ...props }) => createElement('button', props),
    IconChevronDownOutlineRegular: () => createElement('svg'),
    Menu: ({ anchor, open, items, onSelect }) =>
      createElement(
        'div',
        {},
        anchor,
        open &&
          createElement(
            'div',
            { role: 'menu' },
            items
              .filter((item) => !item.type)
              .map((item) =>
                createElement(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    role: 'menuitem',
                    'data-value': item.id,
                    disabled: item.disabled,
                    onClick: () => onSelect(item.id),
                  },
                  item.label
                )
              )
          )
      ),
  }
  window.__ModuleLoader__ = {
    load: ({ id, factory }) => {
      assert.equal(id, '@dungsil/dsh-plugin-ui-model-settings')
      client = factory((specifier) => {
        assert.ok(
          ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(specifier),
          `Unexpected host dependency: ${specifier}`
        )
        if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
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
  const modelSelector = 'button[aria-label^="세션 제목 모델:"]'
  const effortSelector = 'button[aria-label^="세션 제목 추론 수준:"]'
  const refreshSelector = 'footer button[type=button]'
  const select = async (value, selector = modelSelector) => {
    await click(selector)
    await act(async () => {
      const item = [...container.querySelectorAll('[role=menuitem]')].find((item) => item.dataset.value === value)
      assert.ok(item, `Missing option ${value}`)
      item.click()
    })
    assert.equal(container.querySelector('[role=menu]'), null, 'selection closes the picker')
  }
  await act(async () => {
    root.render(createElement(Component, registration.inject()))
  })
  await waitFor(() => container.querySelector('[role=alert]'))
  assert.equal(container.querySelector(modelSelector), null)
  offline = false
  await click(refreshSelector)
  await waitFor(() => container.querySelector(modelSelector))
  const selectElement = container.querySelector(modelSelector)
  assert.equal(
    window.document.getElementById(selectElement.getAttribute('aria-describedby')).textContent,
    '이후 생성하는 제목에 적용합니다.'
  )
  assert.equal(selectElement.textContent, '대화 모델 따르기')
  assert.equal(container.querySelector('button[type=submit]').disabled, true)
  const pair = JSON.stringify(['auxiliary', 'title-small'])
  assert.equal(container.querySelector(effortSelector).disabled, true)
  await select(pair)
  const effortElement = container.querySelector(effortSelector)
  assert.equal(effortElement.disabled, false)
  await click(effortSelector)
  assert.deepEqual(
    [...container.querySelectorAll('[role=menuitem]')].map((item) => item.dataset.value),
    ['', 'quick', 'thorough']
  )
  await click(effortSelector)
  await select('thorough', effortSelector)
  await select(pair)
  assert.equal(
    container.querySelector(effortSelector).textContent,
    'Thorough',
    'reselecting the same model must keep its effort'
  )
  await click('button[type=submit]')
  await waitFor(() => container.querySelector('[role=status]'))
  assert.deepEqual((await h.rpc('describe')).value.target.route, { provider: 'auxiliary', model: 'title-small' })
  assert.ok(container.querySelector(modelSelector).getAttribute('aria-label').includes('auxiliary / Title Small'))
  assert.equal((await h.rpc('describe')).value.target.reasoningEffort, 'thorough')
  await click(refreshSelector)
  await waitFor(() => !container.querySelector(refreshSelector).disabled)
  assert.equal(container.querySelector(effortSelector).textContent, 'Thorough')
  assert.equal(container.querySelector('button[type=submit]').disabled, true)
  await select('', effortSelector)
  assert.equal(container.querySelector('button[type=submit]').disabled, false, 'effort-only changes must be saveable')
  await click('button[type=submit]')
  await waitFor(() => container.querySelector('[role=status]'))
  assert.equal((await h.rpc('describe')).value.target.reasoningEffort, null)

  await select('thorough', effortSelector)
  await select(JSON.stringify(['auxiliary', 'chat-large']))
  assert.equal(container.querySelector(effortSelector).textContent, '자동')
  assert.equal(container.querySelector(effortSelector).disabled, true)
  assert.ok(
    container
      .querySelector(effortSelector)
      .getAttribute('aria-label')
      .includes('이 모델은 추론 수준 설정을 제공하지 않습니다.')
  )
  await select(pair)

  const target = (await h.rpc('describe')).value.target
  await h.rpc('save', { ...target, route: { provider: 'conversation', model: 'chat-large' } })
  await select('')
  await click('button[type=submit]')
  await waitFor(() => container.querySelector('[role=alert]')?.textContent.includes('다른 곳'))
  assert.deepEqual((await h.rpc('describe')).value.target.route, { provider: 'conversation', model: 'chat-large' })
  await click(refreshSelector)
  await waitFor(() =>
    container.querySelector(modelSelector).getAttribute('aria-label').includes('conversation / Chat Large')
  )
  await select('')
  await click('button[type=submit]')
  await waitFor(() => container.querySelector('[role=status]'))
  assert.equal((await h.rpc('describe')).value.target.route, null)
  await act(async () => {
    locale = { active: 'en' }
    for (const listener of listeners) listener()
  })
  assert.ok(container.querySelector('button[aria-label^="Session title Model:"]'))
  assert.equal(registration.label(), 'Models by task')
})
