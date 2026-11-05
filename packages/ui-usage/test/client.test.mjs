import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

await test('cached usage survives navigation and refresh without hiding totals or mixing periods and connections', async (t) => {
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
  let plugin, Page
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    document: window.document,
    AbortController,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id !== '@deepseek-ai/dsh-client-ui-primitives') return require(id)
            return {
              Button: ({ children, variant: _variant, icon: _icon, ...props }) =>
                React.createElement('button', props, children),
              Menu: ({ items, selectedId, onSelect }) =>
                React.createElement(
                  'select',
                  { value: selectedId, onChange: (event) => onSelect(event.target.value) },
                  items.map(({ id, label }) => React.createElement('option', { key: id, value: id }, label))
                ),
              StateDot: () => null,
              IconChevronDownOutlineRegular: () => null,
              IconGaugeOutlineRegular: () => null,
              IconRefreshOutlineRegular: () => null,
            }
          })
        },
      },
    },
  })
  const pending = []
  const makeConnection = () => ({
    rpc: {
      call: () => new Promise((resolve) => pending.push(resolve)),
    },
  })
  let connection = makeConnection()
  const snapshot = { active: 'en' }
  const ctx = {
    get: () => connection,
    locale: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    effect() {},
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, render) => {
        if (options.name === 'main') Page = render
      },
    },
  }
  plugin.apply(ctx)
  const mount = () => React.act(() => root.render(React.createElement(Page, { ctx })))
  const leave = () => React.act(() => root.render(null))
  const total = () => container.querySelector('.dsh-usage-total')?.textContent
  const loading = () => container.textContent.includes('Loading usage')
  const reply = async (value) => {
    assert.ok(pending.length, 'a background request must be pending')
    await React.act(() => pending.shift()(value))
  }
  const view = (total) => ({
    totals: { calls: 0, unreported: 0, input: total, output: 0, cacheRead: 0, cacheWrite: 0, total },
    models: [],
    days: [{ day: '2026-11-05', total }],
    sessions: 1,
    unreadable: 0,
    updatedAt: Date.parse('2026-11-05T00:00:00Z'),
    timeZone: 'UTC',
  })
  const success = (total) => ({ ok: true, value: view(total) })
  const changePeriod = (value) =>
    React.act(async () => {
      const select = container.querySelector('select')
      select.value = value
      select.dispatchEvent(new window.Event('change', { bubbles: true }))
    })

  await mount()
  assert.equal(loading(), true)
  await reply(success(123))
  assert.equal(total(), '123')
  await leave()
  await mount()
  assert.equal(loading(), false)
  assert.equal(total(), '123')
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), 'true')
  await reply(success(456))
  assert.equal(total(), '456')

  const refreshButton = container.querySelector('.dsh-usage-refresh')
  assert.equal(refreshButton.textContent, 'Refresh')
  await React.act(async () => refreshButton.click())
  assert.equal(loading(), false)
  assert.equal(total(), '456')
  assert.equal(refreshButton.textContent, 'Refreshing…')
  assert.equal(refreshButton.getAttribute('aria-busy'), 'true')
  assert.equal(refreshButton.disabled, true)
  await reply(success(789))
  assert.equal(total(), '789', 'new totals replace the existing data only after refresh completes')
  assert.equal(refreshButton.textContent, 'Refresh')
  assert.equal(refreshButton.getAttribute('aria-busy'), 'false')
  assert.equal(refreshButton.disabled, false)

  await React.act(async () => refreshButton.click())
  await reply({ ok: false })
  assert.ok(container.querySelector('[role=alert]'))
  assert.equal(total(), '789', 'a failed refresh must retain the last successful result')
  assert.equal(refreshButton.textContent, 'Refresh')
  assert.equal(refreshButton.disabled, false)

  await changePeriod('30')
  assert.equal(loading(), true)
  assert.equal(total(), undefined, 'seven-day totals must not appear under a thirty-day label')
  await reply(success(987))
  await changePeriod('7')
  assert.equal(loading(), false)
  assert.equal(total(), '789')
  await leave()
  await reply(success(999))
  await mount()
  assert.equal(total(), '789', 'an aborted response must not overwrite cached totals')
  await reply(success(654))

  await leave()
  connection = makeConnection()
  await mount()
  assert.equal(total(), undefined, 'another connection must not reuse private usage')
  assert.equal(loading(), true)
  await reply(success(0))
  await leave()
  await mount()
  assert.equal(total(), '0', 'empty usage is also a successful cached result')
  assert.equal(loading(), false)
  await reply(success(0))
})
