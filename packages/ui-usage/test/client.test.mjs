import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

await test('캐시된 사용량은 합계를 숨기거나 기간과 연결을 섞지 않고 내비게이션과 새로고침 후에도 유지된다', async (t) => {
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
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), 'false')
  assert.equal(pending.length, 0, 'navigation must not request cached usage again')

  const refreshButton = container.querySelector('.dsh-usage-refresh')
  assert.equal(refreshButton.textContent, 'Refresh')
  await React.act(async () => refreshButton.click())
  assert.equal(loading(), false)
  assert.equal(total(), '123')
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
  assert.equal(pending.length, 0, 'returning to a cached period must not request usage again')
  await React.act(async () => refreshButton.click())
  await leave()
  await reply(success(999))
  await mount()
  assert.equal(total(), '789', 'an aborted response must not overwrite cached totals')
  assert.equal(pending.length, 0)

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
  assert.equal(pending.length, 0)

  await t.test('토큰은 현재 언어의 단위로 축약하고 정확한 값과 호출 수는 유지한다', async () => {
    for (const [language, expected] of [
      ['en-US', ['0', '999', '1K', '10K', '10K', '12.3K', '1.2M', '1.2B']],
      ['ko-KR', ['0', '999', '1천', '1만', '1만', '1.2만', '123.5만', '12.3억']],
      ['zh-CN', ['0', '999', '1000', '9999', '1万', '1.2万', '123.5万', '12.3亿']],
    ]) {
      for (const [index, value] of [0, 999, 1000, 9999, 10000, 12345, 1234567, 1234567890].entries()) {
        await leave()
        Object.assign(snapshot, { active: language })
        connection = makeConnection()
        await mount()
        const result = view(value)
        Object.assign(result.totals, { calls: 12345, output: 999, cacheRead: 1000, cacheWrite: 0 })
        result.models = [{ ...result.totals, provider: 'deepseek', model: 'deepseek-chat' }]
        result.sessions = 12345
        await reply({ ok: true, value: result })

        assert.equal(total(), expected[index], `${String(language)}: ${value}`)
        assert.equal(container.querySelector('.dsh-usage-total').title, value.toLocaleString(language))
        const summary = [...container.querySelectorAll('.dsh-usage-summary dd')].map((dd) => dd.textContent)
        assert.deepEqual(summary, [expected[index], expected[index], '999', expected[2], '0'])
        assert.ok(container.querySelector('.dsh-usage-detail').textContent.endsWith(expected[index]))
        assert.ok(
          container.querySelector('.dsh-usage-bar').getAttribute('aria-label').includes(value.toLocaleString(language))
        )
        assert.equal(container.querySelector('.dsh-usage-model-heading > span:last-child').textContent, expected[index])
        const model = [...container.querySelectorAll('.dsh-usage-model dd')].map((dd) => dd.textContent)
        assert.deepEqual(model, ['12,345', expected[index], '999', expected[2], '0'])
        assert.ok(container.querySelector('.dsh-usage-meta').textContent.includes('12,345'))
      }
    }
  })
})
