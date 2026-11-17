import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { Window } from 'happy-dom'
import * as React from 'react'

const window = new Window()
const dom = {
  window,
  document: window.document,
  MutationObserver: window.MutationObserver,
  NodeFilter: window.NodeFilter,
  HTMLElement: window.HTMLElement,
}
Object.assign(globalThis, dom, { IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { act } = React

const dictionaries = {
  ko: { 'message.turnUsage.count': '{count}토큰', 'message.turnUsage.consumed': '사용량 {total}' },
  en: { 'message.turnUsage.count': '{count} tok', 'message.turnUsage.consumed': 'Usage {total}' },
}
const translate =
  (language) =>
  (key, params = {}) => {
    const template =
      { 'number.thousand': '{value}K', 'number.million': '{value}M', 'number.groupSeparator': ',' }[key] ??
      dictionaries[language][key]
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name]))
  }

// Copies of DSH 0.2.2-rc.3 token-format.ts: compact counts lose the exact value before `t` sees them.
function formatTokens(value, t) {
  const scaled = (candidate) =>
    candidate >= 100 ? String(Math.round(candidate)) : String(Math.round(candidate * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return t('number.thousand', { value: scaled(value / 1_000) })
  return t('number.million', { value: scaled(value / 1_000_000) })
}
function formatExactTokens(value, t) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, t('number.groupSeparator'))
}

function NativeUsagePill({ t, useProjection }) {
  const usage = useProjection('tokenUsage')
  const total = usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens
  return React.createElement(
    'span',
    { 'data-composer-stat': 'usage' },
    React.createElement('b', null, t('message.turnUsage.count', { count: formatTokens(total, t) })),
    React.createElement('i', null, t('message.turnUsage.count', { count: formatExactTokens(usage.cacheReadTokens, t) }))
  )
}
function NativeTurnTail({ t, node }) {
  const total = t('message.turnUsage.count', { count: formatTokens(node.data.tokenUsage.totalTokens, t) })
  return React.createElement('button', null, t('message.turnUsage.consumed', { total }))
}

async function loadPlugin() {
  let plugin
  const require = createRequire(import.meta.url)
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    ...dom,
    window: { ...dom, __ModuleLoader__: { load: ({ factory }) => (plugin = factory(require)) } },
  })
  return plugin
}

function setup() {
  const core = new SlotCore()
  const disposeRoot = core.register(
    {
      name: 'root',
      children: {
        'conversation.composer.dock': { kind: 'list', scope: 'session' },
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      },
    },
    () => null
  )
  core.register({ name: 'conversation.composer.dock', id: 'activity' }, () => null)
  core.register({ name: 'conversation.composer.dock', id: 'usage', order: 1 }, NativeUsagePill)
  core.register({ name: 'conversation.chat.node', key: 'turn-tail' }, NativeTurnTail)
  let snapshot = { active: 'ko', revision: 0 }
  const listeners = new Set()
  const disposers = []
  const effects = []
  const ctx = {
    slots: {
      inject: (_slot, setup) => disposers.push(setup()),
      entries: (slot) => core.entries(slot),
      subscribe: (slot, fn) => core.subscribe(slot, fn),
      register: (options, component) => core.register(options, component),
    },
    locale: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    },
    effect: (fn) => effects.push(fn),
  }
  const component = (slot, cell) =>
    core.entriesOfSlot(slot).find((entry) => entry.options.id === cell || entry.options.key === cell).component
  return {
    core,
    ctx,
    effects,
    component,
    setLanguage(active) {
      snapshot = { active, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener()
    },
    disablePlugin() {
      for (const dispose of disposers.reverse()) dispose()
    },
    disposeRoot,
  }
}

const usage = { uncachedInputTokens: 125872, cacheReadTokens: 713128, cacheWriteTokens: 0, outputTokens: 150 }
const turn = { data: { tokenUsage: { totalTokens: 999950 } } }

await test('native 사용량 항목을 감싸 축약값과 정확한 값을 단위 단어 없이 표시하고 해제하면 원래대로 되돌린다', async () => {
  const slots = setup()
  const container = document.createElement('div')
  const root = createRoot(container)
  const render = async (language) => {
    await act(() =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(slots.component('conversation.composer.dock', 'usage'), {
            t: translate(language),
            useProjection: () => usage,
          }),
          React.createElement(slots.component('conversation.chat.node', 'turn-tail'), {
            t: translate(language),
            node: turn,
          })
        )
      )
    )
    return container.innerHTML
  }
  const native = await render('ko')
  assert.match(native, /839K토큰/)
  ;(await loadPlugin()).apply(slots.ctx)

  assert.match(
    await render('ko'),
    /<b>83\.9만 \(839,150\)<\/b><i>71\.3만 \(713,128\)<\/i>.*<button>사용량 100만 \(999,950\)<\/button>/
  )
  await act(async () => slots.setLanguage('en'))
  assert.match(
    await render('en'),
    /<b>839K \(839,150\)<\/b><i>713K \(713,128\)<\/i>.*<button>Usage 1M \(999,950\)<\/button>/
  )

  assert.equal(slots.core.entriesOfSlot('conversation.composer.dock').length, 3)
  slots.disablePlugin()
  assert.equal(await render('ko'), native)
  await act(() => root.unmount())
  assert.equal(slots.component('conversation.composer.dock', 'usage'), NativeUsagePill)
  assert.equal(slots.component('conversation.chat.node', 'turn-tail'), NativeTurnTail)
  slots.disposeRoot()
})

await test('컨텍스트 패널 수치를 정확한 값과 함께 다시 쓰고 언어 전환과 비활성화를 따른다', async () => {
  const slots = setup()
  ;(await loadPlugin()).apply(slots.ctx)
  // DSH 0.2.2-rc.3 ContextMeter: a dock child names the anchor its portaled panel uses.
  document.body.innerHTML = `
    <div data-composer-dock><div id="entries"></div><span style="anchor-name: --dsh-context-r1"></span></div>
    <div role="dialog" style="position-anchor: --dsh-context-r1">
      <div><span></span><span>80%</span><span>사용</span><span>~839K / 1M</span></div>
      <div></div>
      <dl><div><dt>시스템</dt><dd>~1.5K</dd></div><div><dt>도구</dt><dd>~8K</dd></div><div><dt>메시지</dt><dd>0</dd></div></dl>
    </div>`
  const panel = document.querySelector('[role="dialog"]')
  const figures = panel.firstElementChild.lastElementChild
  const rows = () => [...panel.querySelectorAll('dd')].map((row) => row.textContent)
  const disposeEffect = slots.effects[0]()
  const projections = {
    contextPressure: { pressureTokens: 830000, projectedTokens: 839013, contextWindow: 1048576 },
    contextBreakdown: { systemTokens: 1541, toolsTokens: 7951, messageTokens: 0 },
  }
  const root = createRoot(document.getElementById('entries'))
  await act(() =>
    root.render(
      React.createElement(slots.component('conversation.composer.dock', 'dungsil-ui-token-usage'), {
        t: translate('ko'),
        useProjection: (key) => projections[key],
      })
    )
  )

  assert.equal(figures.textContent, '~83.9만 (839,013) / 104.9만 (1,048,576)')
  assert.deepEqual(
    [...figures.querySelectorAll('[data-dsh-count-exact]')].map((span) => span.textContent),
    ['(839,013)', '(1,048,576)']
  )
  assert.deepEqual(rows(), ['~1,541', '~7,951', '~0'])
  await act(async () => slots.setLanguage('en'))
  assert.equal(figures.textContent, '~839K (839,013) / 1M (1,048,576)')
  assert.deepEqual(rows(), ['~1.5K (1,541)', '~8K (7,951)', '~0'])

  // A native rerender replaces the text; the observer rewrites it before paint.
  figures.textContent = '~840K / 1M'
  await act(async () => {})
  assert.equal(figures.textContent, '~839K (839,013) / 1M (1,048,576)')

  disposeEffect()
  assert.equal(figures.textContent, '~840K / 1M')
  assert.deepEqual(rows(), ['~1.5K', '~8K', '0'])
  assert.equal(document.querySelectorAll('[data-dsh-count-exact], [data-dsh-token-usage-figures]').length, 0)
  await act(() => root.unmount())
  slots.disablePlugin()
  slots.disposeRoot()
})
