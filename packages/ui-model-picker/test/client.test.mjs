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
  const change = (value, event = 'change', key = 'ArrowRight') =>
    React.act(async () => {
      const input = slider()
      // Use the native setter so React observes the input rather than its value tracker.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      input.dispatchEvent(
        event === 'keyup'
          ? new window.KeyboardEvent(event, { key, bubbles: true })
          : new window.Event(event, { bubbles: true })
      )
    })
  const commit = async (value, event = 'pointerup') => {
    await change(value, event)
  }
  const reply = (ok = true, project = true) =>
    React.act(async () => {
      const { selection, resolve } = requests.at(-1)
      update({ status: 'ready', ...(ok && project ? { current: selection } : {}) })
      resolve({ ok })
    })
  const scroll = (target) => React.act(async () => target.dispatchEvent(new window.Event('scroll')))
  return { window, document, slider, click, change, commit, reply, requests, update, scroll, snapshot: () => snapshot }
}

await test('드래그 중에는 초안만 변경하고 포인터를 놓으면 적용 버튼 없이 한 번만 확정한다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  await h.change(0)
  await h.change(1)
  await h.change(2)
  assert.equal(h.requests.length, 0)
  assert.equal(h.slider().getAttribute('aria-valuetext'), 'high')
  const modelButton = h.document.querySelector('.dsh-codex-model')
  assert.equal(modelButton.getAttribute('aria-label'), null)
  assert.match(modelButton.textContent, /high.*first/)
  await h.change(2, 'pointerup')
  await h.change(2, 'pointerup')
  assert.equal(h.requests.length, 1)
  assert.deepEqual({ ...h.requests[0].selection }, { provider: 'provider', model: 'first', reasoningEffort: 'high' })
  await h.reply()
  assert.equal(h.snapshot().current.reasoningEffort, 'high')
})

await test('방향키와 Home 및 End 키를 놓으면 적용 버튼 없이 추론 강도를 확정한다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  await h.change(2, 'keyup', 'Tab')
  assert.equal(h.requests.length, 0)
  for (const [index, key] of [
    [0, 'Home'],
    [2, 'End'],
    [1, 'ArrowLeft'],
    [2, 'ArrowRight'],
    [0, 'ArrowDown'],
    [1, 'ArrowUp'],
    [2, 'PageUp'],
    [0, 'PageDown'],
  ]) {
    await h.change(index, 'keyup', key)
    assert.equal(h.requests.at(-1).selection.reasoningEffort, ['low', 'medium', 'high'][index])
    await h.reply()
  }
  assert.equal(h.requests.length, 8)
})

await test('모델을 고른 뒤 슬라이더를 움직이지 않고 놓아도 기본 강도와 모델을 함께 적용한다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  await h.click('.dsh-codex-models button:last-child')
  assert.equal(h.requests.length, 0)
  await h.change(0, 'pointerup')
  assert.deepEqual({ ...h.requests[0].selection }, { provider: 'provider', model: 'second', reasoningEffort: 'low' })
  await h.reply()
  assert.equal(h.snapshot().current.model, 'second')
})

await test('적용 버튼도 기존처럼 추론 강도를 확정한다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  await h.change(2)
  await h.click('.dsh-codex-apply')
  assert.equal(h.requests.length, 1)
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

await test('응답으로 대화 영역이 스크롤되어도 모델 목록과 포커스를 유지하고 위치를 갱신한다', async (t) => {
  const h = await mount(t)
  const anchor = h.document.querySelector('.dsh-codex-picker')
  let top = 400
  anchor.getBoundingClientRect = () => ({ top, bottom: top + 32, right: 500 })
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  const popup = h.document.querySelector('[role=dialog]')
  const focused = h.document.activeElement
  const conversation = h.document.createElement('div')
  h.document.body.append(conversation)
  top = 300
  await h.scroll(conversation)
  assert.ok(h.document.querySelector('[role=dialog]') === popup)
  assert.ok(h.document.querySelector('.dsh-codex-models'))
  assert.ok(h.document.activeElement === focused)
  assert.equal(popup.style.top, '292px')
  await h.click('.dsh-codex-models button:last-child')
  await h.commit(2)
  await h.reply()
  assert.equal(h.snapshot().current.model, 'second')
})

await test('응답과 팝업 내부 스크롤은 준비 중인 모델과 추론 강도 초안을 초기화하지 않는다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  const models = h.document.querySelector('.dsh-codex-models')
  await h.scroll(models)
  assert.ok(h.document.querySelector('.dsh-codex-models') === models)
  await h.click('.dsh-codex-models button:last-child')
  await h.change(2)
  const input = h.slider()
  await React.act(async () => h.update({ current: { ...h.snapshot().current } }))
  await h.scroll(h.document)
  await h.scroll(h.window)
  assert.ok(h.slider() === input)
  assert.ok(h.document.activeElement === input)
  assert.equal(input.value, '2')
  assert.match(h.document.querySelector('.dsh-codex-model').textContent, /high.*second/)
  assert.equal(h.requests.length, 0)
  await h.click('.dsh-codex-apply')
  await h.reply()
  assert.equal(h.snapshot().current.model, 'second')
  assert.equal(h.snapshot().current.reasoningEffort, 'high')
  await React.act(async () =>
    input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  )
  assert.equal(h.slider(), null)
  assert.ok(h.document.activeElement === h.document.querySelector('.dsh-codex-trigger'))
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
