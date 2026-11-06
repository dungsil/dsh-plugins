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
              Input: ({ onChange, ...props }) => React.createElement('input', { ...props, onInput: onChange }),
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
  const requests = []
  const makeConnection = () => ({
    rpc: {
      call: (_channel, _method, payload) => {
        requests.push(payload)
        return new Promise((resolve) => pending.push(resolve))
      },
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
    calls: [],
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

  await t.test(
    '사용자 지정 기간은 적용할 때만 조회하며 잘못된 범위는 요청하지 않고 날짜별 캐시를 분리한다',
    async () => {
      await changePeriod('custom')
      assert.equal(pending.length, 0)
      const inputs = [...container.querySelectorAll('input[type=date]')]
      assert.equal(inputs.length, 2)
      assert.ok(inputs.every((input) => input.closest('label')))
      const enter = async (start, end) =>
        React.act(async () => {
          for (const [index, value] of [start, end].entries()) {
            inputs[index].value = value
            inputs[index].dispatchEvent(new window.Event('input', { bubbles: true }))
            inputs[index].dispatchEvent(new window.Event('change', { bubbles: true }))
          }
        })
      const submit = () =>
        React.act(async () => {
          container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        })
      await enter('2026-11-05', '2026-11-01')
      await submit()
      assert.ok(container.querySelector('form [role=alert]'))
      assert.equal(pending.length, 0)
      await enter('2026-11-01', '2026-11-05')
      assert.equal(pending.length, 0)
      await submit()
      assert.equal(requests.at(-1).startDate, '2026-11-01')
      assert.equal(requests.at(-1).endDate, '2026-11-05')
      assert.equal('days' in requests.at(-1), false)
      assert.equal(total(), undefined)
      await reply(success(456))
      await leave()
      await mount()
      assert.equal(container.querySelector('select').value, 'custom')
      assert.equal(container.querySelector('input').value, '2026-11-01')
      assert.equal(total(), '456')
      assert.equal(pending.length, 0)
      await changePeriod('7')
      assert.equal(total(), '0')
    }
  )

  await t.test('사용자 지정 입력과 적용 안내는 지원하는 모든 언어의 지역 로케일로 표시한다', async () => {
    for (const [language, labels] of [
      ['en', ['Custom range', 'Start date', 'End date', 'Apply', 'Showing']],
      ['ko', ['사용자 지정', '시작일', '종료일', '적용', '조회 중인 기간']],
      ['zh', ['自定义范围', '开始日期', '结束日期', '应用', '当前查询范围']],
      ['ja-JP', ['期間を指定', '開始日', '終了日', '適用', '表示期間']],
      ['es-MX', ['Intervalo personalizado', 'Fecha de inicio', 'Fecha de fin', 'Aplicar', 'Mostrando']],
      ['fr-CA', ['Période personnalisée', 'Date de début', 'Date de fin', 'Appliquer', 'Période affichée']],
      ['de-DE', ['Benutzerdefinierter Zeitraum', 'Startdatum', 'Enddatum', 'Anwenden', 'Angezeigter Zeitraum']],
      ['ru-RU', ['Свой период', 'Дата начала', 'Дата окончания', 'Применить', 'Показан период']],
      ['pt-BR', ['Intervalo personalizado', 'Data de início', 'Data de término', 'Aplicar', 'Exibindo']],
    ]) {
      await leave()
      snapshot.active = language
      connection = makeConnection()
      await mount()
      await reply(success(0))
      await changePeriod('custom')
      for (const label of labels) assert.ok(container.textContent.includes(label))
      assert.ok(container.querySelector('form').textContent.includes('366'))
      assert.equal(container.querySelectorAll('form input').length, 2)
      assert.equal(pending.length, 0)
    }
  })

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

  await t.test('호출 목록은 각 언어로 상태와 정확한 토큰을 표시하며 미보고 값을 0으로 표시하지 않는다', async () => {
    for (const [language, labels] of [
      ['en', ['Succeeded', 'Failed', 'Interrupted', 'Unconfirmed', 'Not reported']],
      ['ko', ['성공', '실패', '중단', '미확정', '미보고']],
      ['zh', ['成功', '失败', '已中断', '未确认', '未报告']],
    ]) {
      await leave()
      snapshot.active = language
      connection = makeConnection()
      await mount()
      const result = view(12345)
      result.totals.calls = 4
      result.calls = ['success', 'failure', 'interrupted', 'unknownStatus'].map((status, seq) => ({
        ...result.totals,
        session: 'session-a',
        seq,
        time: Date.parse('2026-11-05T01:02:03Z'),
        provider: 'provider-a',
        model: 'model-b',
        status,
        unreported: seq === 3 ? 1 : 0,
      }))
      await reply({ ok: true, value: result })
      const log = container.querySelector('.dsh-usage-calls')
      assert.equal(log.tabIndex, 0)
      assert.equal(log.children.length, 4)
      for (const [index, row] of [...log.children].entries()) {
        assert.ok(row.querySelector('.dsh-usage-call-status').textContent.includes(labels[index]))
        assert.ok(row.textContent.includes('provider-a / model-b'))
        assert.ok(row.textContent.includes('session-a'))
        assert.equal(row.querySelector('time').dateTime, '2026-11-05T01:02:03.000Z')
        assert.equal(row.querySelector('dd').textContent, index === 3 ? labels[4] : '12,345')
      }
    }
  })
})
