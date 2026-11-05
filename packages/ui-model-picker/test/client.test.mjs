import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

async function mount(t) {
  const window = new Window()
  const { document } = window
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(container)
  t.after(async () => {
    await React.act(async () => root.unmount())
    await window.happyDOM.close()
    keys.forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index])
      else delete globalThis[key]
    })
  })
  const require = createRequire(import.meta.url)
  let plugin, Picker
  const primitives = {
    MenuSurface: React.forwardRef((props, ref) => React.createElement('div', { ...props, ref })),
    focusWithoutRing: (element) => element.focus(),
    useDismissOnOutsidePointer() {},
    IconChevronDownOutlineRegular: () => null,
    IconChevronLeftOutlineRegular: () => null,
    IconChevronRightOutlineRegular: () => null,
    IconCheckOutlineRegular: () => null,
    IconDataOutlineRegular: () => null,
  }
  window.__ModuleLoader__ = {
    load({ factory }) {
      plugin = factory((id) => (id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(id)))
    },
  }
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window,
    document,
    ResizeObserver: window.ResizeObserver,
    HTMLInputElement: window.HTMLInputElement,
  })
  const efforts = ['low', 'medium', 'high'].map((id) => ({ id, name: id }))
  let snapshot = {
    current: { provider: 'provider', model: 'first', reasoningEffort: 'medium' },
    groups: [
      {
        id: 'provider',
        name: 'Provider',
        models: ['first', 'second'].map((id) => ({
          id,
          name: id,
          reasoning: { efforts, defaultEffort: 'low' },
        })),
      },
    ],
    status: 'ready',
    failures: [],
  }
  const listeners = new Set()
  const update = (patch) => {
    snapshot = { ...snapshot, ...patch }
    listeners.forEach((listener) => listener())
  }
  const requests = []
  const directory = {
    store: {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    load: async () => {},
    select: (selection) => {
      update({ status: 'selecting' })
      return new Promise((resolve) => requests.push({ selection, resolve }))
    },
  }
  const locale = { active: 'ko' }
  plugin.apply({
    locale: { getSnapshot: () => locale, subscribe: () => () => {} },
    modelDirectories: { directoryFor: () => directory },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (_options, render) => {
        Picker = render
      },
    },
    effect() {},
  })
  await React.act(async () =>
    root.render(React.createElement(Picker, { sessionId: 'test', useSession: (read) => read({}), locked: false }))
  )
  const click = (selector) => React.act(async () => document.querySelector(selector).click())
  const slider = () => document.querySelector('input[type=range]')
  const change = (value, event = 'change') =>
    React.act(async () => {
      const input = slider()
      // Use the native setter so React observes the input rather than its value tracker.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      input.dispatchEvent(
        event === 'keyup'
          ? new window.KeyboardEvent(event, { key: 'ArrowRight', bubbles: true })
          : new window.Event(event, { bubbles: true })
      )
    })
  const commit = async (value, event) => {
    await change(value, event)
    await click('.dsh-codex-apply')
  }
  const reply = (ok = true, project = true) =>
    React.act(async () => {
      const { selection, resolve } = requests.at(-1)
      update({ status: 'ready', ...(ok && project ? { current: selection } : {}) })
      resolve({ ok })
    })
  return { document, slider, click, change, commit, reply, requests, update, snapshot: () => snapshot }
}

await test('입력과 드래그 및 방향키는 초안만 변경하고 적용 버튼은 변경을 한 번만 확정한다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  await h.change(0)
  await h.change(1, 'pointerup')
  await h.change(2, 'keyup')
  assert.equal(h.requests.length, 0)
  assert.equal(h.slider().getAttribute('aria-valuetext'), 'high')
  const modelButton = h.document.querySelector('.dsh-codex-model')
  assert.equal(modelButton.getAttribute('aria-label'), null)
  assert.match(modelButton.textContent, /high.*first/)
  await h.click('.dsh-codex-apply')
  await h.click('.dsh-codex-apply')
  assert.equal(h.requests.length, 1)
  assert.deepEqual({ ...h.requests[0].selection }, { provider: 'provider', model: 'first', reasoningEffort: 'high' })
  await h.reply()
  assert.equal(h.snapshot().current.reasoningEffort, 'high')
})

await test('추론 강도를 저장해도 슬라이더 포커스와 버튼의 활성 표시를 유지한다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  const input = h.slider()
  assert.ok(h.document.activeElement === input)
  await h.commit(2)
  assert.equal(input.disabled, false)
  assert.ok(h.document.activeElement === input)
  for (const selector of ['.dsh-codex-trigger', '.dsh-codex-model', '.dsh-codex-reset']) {
    const control = h.document.querySelector(selector)
    assert.equal(control.disabled, false)
    assert.equal(control.getAttribute('aria-disabled'), 'true')
    await h.click(selector)
    assert.ok(h.slider() === input)
    assert.equal(h.requests.length, 1)
  }
  await h.commit(0)
  assert.equal(h.requests.length, 1)
  assert.equal(input.value, '2')
  await React.act(async () => h.update({ current: h.requests.at(-1).selection }))
  assert.ok(h.slider() === input)
  assert.ok(h.document.activeElement === input)
  await h.reply()
  assert.ok(h.slider() === input)
  assert.ok(h.document.activeElement === input)
  assert.equal(input.value, '2')
  await h.commit(0, 'keyup')
  await h.reply()
  assert.ok(h.document.activeElement === input)
  assert.equal(input.value, '0')
  assert.equal(h.snapshot().current.reasoningEffort, 'low')
})

await test('다른 모델의 추론 강도를 적용하고 늦게 선택 상태가 갱신되어도 슬라이더를 유지한다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  assert.equal(h.document.querySelector('[role=radio]'), null)
  assert.equal(h.document.querySelector('[aria-current=true]').textContent, 'first')
  await h.click('.dsh-codex-models button:last-child')
  const input = h.slider()
  await h.commit(2)
  await h.reply(true, false)
  await React.act(async () => h.update({ current: h.requests.at(-1).selection }))
  assert.ok(h.slider() === input)
  assert.ok(h.document.activeElement === input)
  assert.equal(h.snapshot().current.model, 'second')
  await h.commit(1)
  await h.reply(false)
  assert.ok(h.document.querySelector('[role=alert]'))
  assert.ok(h.document.activeElement === input)
  await h.commit(1)
  await h.reply()
  assert.equal(h.snapshot().current.reasoningEffort, 'medium')
  await React.act(async () => h.update({ current: { provider: 'provider', model: 'first', reasoningEffort: 'low' } }))
  assert.equal(h.slider(), null)
  assert.ok(h.document.activeElement === h.document.querySelector('.dsh-codex-trigger'))
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-reset')
  await h.reply()
  assert.equal(h.slider(), null)
})

await test('외부 변경으로 팝업을 닫아도 팝업 밖 컨트롤의 포커스를 빼앗지 않는다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  const outside = h.document.createElement('button')
  h.document.body.append(outside)
  outside.focus()
  await React.act(async () => h.update({ current: { provider: 'provider', model: 'second', reasoningEffort: 'low' } }))
  assert.equal(h.slider(), null)
  assert.ok(h.document.activeElement === outside)
})
