import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

const favorite = (model, reasoningEffort) => ({ provider: 'provider', model, reasoningEffort })

// Mounts the plugin's slot contributions inside a stand-in for the official
// model menu: the model row, the reasoning row, and the options outlet.
async function mount(
  t,
  { language = 'ko', favorites, defaultEffort = 'low', noDefault = false, runtime = 'desktop' } = {}
) {
  const window = new Window()
  const { document } = window
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.assign(globalThis, { window, document, IS_REACT_ACT_ENVIRONMENT: true })
  if (favorites) window.localStorage.setItem('dungsil.model-picker.favorites', JSON.stringify(favorites))
  const require = createRequire(import.meta.url)
  const icon = () => null
  const primitives = {
    IconCheckOutlineRegular: icon,
    IconChevronRightOutlineRegular: icon,
    IconChevronLeftOutlineRegular: icon,
    IconChevronDownOutlineRegular: icon,
  }
  let plugin
  window.__ModuleLoader__ = {
    load({ factory }) {
      plugin = factory((id) =>
        id === '@deepseek-ai/dsh-client-ui-primitives'
          ? new Proxy(primitives, { get: (o, k) => o[k] ?? icon })
          : require(id)
      )
    },
  }
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window,
    document,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLElement: window.HTMLElement,
    setTimeout,
  })

  const efforts = ['low', 'medium', 'high'].map((id) => ({ id, name: id }))
  const groups = [
    {
      id: 'provider',
      name: 'Provider',
      models: ['first', 'second'].map((id) => ({
        id,
        name: id.toUpperCase(),
        reasoning: { efforts, ...(noDefault ? {} : { defaultEffort }) },
      })),
    },
  ]
  let state = {
    current: { provider: 'provider', model: 'first', reasoningEffort: 'medium' },
    groups,
    status: 'ready',
    pending: null,
    failures: [],
  }
  const listeners = new Set()
  const requests = []
  const update = (patch) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }
  const directory = {
    store: {
      getSnapshot: () => state,
      subscribe: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    },
    load: async () => {},
    select: (selection) => {
      update({ status: 'selecting', pending: selection })
      return new Promise((resolve) => requests.push({ selection, resolve }))
    },
  }
  const reply = (ok = true) =>
    React.act(async () => {
      const { selection, resolve } = requests.at(-1)
      update({ status: 'ready', pending: null, ...(ok ? { current: selection } : {}) })
      resolve({ ok })
    })

  const localeSnapshot = { active: language }
  const registered = new Map()
  const commands = new Map()
  const disposers = []
  plugin.apply({
    shortcuts: {
      runtime,
      register: (value) => (commands.set(value.id, value), () => commands.delete(value.id)),
      registerFixed: (value) => (commands.set(value.id, value), () => commands.delete(value.id)),
      observeFixedInput: () => () => {},
    },
    locale: { getSnapshot: () => localeSnapshot, subscribe: () => () => {} },
    sessions: { subagentAddress: () => undefined },
    modelDirectories: { directoryFor: () => directory },
    slots: {
      inject: (_slot, setup) => disposers.push(setup()),
      register: (options, render) => {
        const id = `${options.name}:${options.id ?? options.key}`
        registered.set(id, render)
        return () => registered.delete(id)
      },
    },
    effect(setup) {
      disposers.push(setup())
    },
  })

  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  card.innerHTML =
    '<div data-slot="conversation.input.model"><button aria-haspopup="menu" aria-controls="menu">trigger</button></div><div id="target"></div>'
  card.getClientRects = () => [{}]
  const menu = document.createElement('div')
  menu.id = 'menu'
  menu.setAttribute('data-model-menu', '')
  menu.setAttribute('role', 'menu')
  menu.innerHTML =
    '<button role="menuitem" id="model-row">Model</button><button role="menuitem" id="effort-row">Effort</button><div data-slot="conversation.input.model.options" id="options"></div>'
  const pane = document.createElement('div')
  document.body.append(card, menu, pane)

  const { createRoot } = await import('react-dom/client')
  const roots = []
  const render = async (container, element) => {
    const root = createRoot(container)
    roots.push(root)
    await React.act(async () => root.render(element))
    return root
  }
  const failures = []
  let dismissed = 0
  const controls = {
    sessionId: 'test',
    locked: false,
    dismiss: () => dismissed++,
    reportFailure: (message) => failures.push(message),
    openPane: (value) => (controls.opened = value),
  }
  await render(
    card.querySelector('#target'),
    React.createElement(registered.get('conversation.input.overlay:dungsil-model-picker-target'), controls)
  )
  const optionsRoot = await render(
    menu.querySelector('#options'),
    React.createElement(
      React.Fragment,
      null,
      React.createElement(registered.get('conversation.input.model.options:dungsil-effort-slider'), controls),
      React.createElement(registered.get('conversation.input.model.options:dungsil-model-favorites'), controls)
    )
  )
  t.after(async () => {
    for (const root of roots) await React.act(async () => root.unmount())
    disposers.forEach((dispose) => dispose?.())
    await window.happyDOM.close()
    keys.forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index])
      else delete globalThis[key]
    })
  })

  const slider = () => document.querySelector('input.dsh-effort-input')
  const set = (value) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(slider(), String(value))
    slider().dispatchEvent(new window.Event('input', { bubbles: true }))
  }
  const fire = (event) => React.act(async () => slider().dispatchEvent(event))
  const drag = async (...values) => {
    await fire(new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
    for (const value of values) await React.act(async () => set(value))
    await fire(new window.PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
  }
  return {
    window,
    document,
    menu,
    card,
    pane,
    slider,
    drag,
    fire,
    set,
    reply,
    requests,
    update,
    failures,
    controls,
    commands,
    dismissed: () => dismissed,
    optionsRoot,
    renderPane: () =>
      render(
        pane,
        React.createElement(registered.get('conversation.input.model.pane:dungsil-model-favorites'), controls)
      ),
    registered,
    favorites: () => JSON.parse(window.localStorage.getItem('dungsil.model-picker.favorites') ?? '[]'),
  }
}

await test('슬라이더가 공식 추론 수준 행을 숨기고 제거되면 되돌린다', async (t) => {
  const h = await mount(t)
  const row = h.document.getElementById('effort-row')
  assert.equal(row.style.display, 'none')
  assert.equal(row.disabled, true)
  assert.equal(h.document.getElementById('model-row').hidden, false)
  assert.equal(h.slider().getAttribute('aria-valuetext'), 'medium')
  await React.act(async () => h.optionsRoot.unmount())
  assert.equal(row.style.display, '')
  assert.equal(row.disabled, false)
})

await test('드래그 중에는 선택하지 않고 포인터를 놓을 때 한 번만 확정한다', async (t) => {
  const h = await mount(t)
  await h.fire(new h.window.PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
  await React.act(async () => h.set(0))
  await React.act(async () => h.set(2))
  assert.equal(h.requests.length, 0)
  assert.equal(h.slider().getAttribute('aria-valuetext'), 'high')
  await h.fire(new h.window.PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
  await h.fire(new h.window.PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
  assert.equal(h.requests.length, 1)
  assert.deepEqual({ ...h.requests[0].selection }, favorite('first', 'high'))
  await h.reply()
  assert.equal(h.slider().getAttribute('aria-valuetext'), 'high')
})

await test('방향키를 놓으면 추론 강도를 확정하고 취소한 드래그는 확정하지 않는다', async (t) => {
  const h = await mount(t)
  await h.fire(new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  await React.act(async () => h.set(2))
  assert.equal(h.requests.length, 0)
  await h.fire(new h.window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
  assert.equal(h.requests.at(-1).selection.reasoningEffort, 'high')
  await h.reply()
  await h.fire(new h.window.PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
  await React.act(async () => h.set(0))
  await h.fire(new h.window.Event('pointercancel', { bubbles: true }))
  assert.equal(h.requests.length, 1)
  assert.equal(h.slider().getAttribute('aria-valuetext'), 'high')
})

await test('기본 추론 수준이 없는 모델은 기본값 단계를 제공하고 선택하면 강도를 지정하지 않는다', async (t) => {
  const h = await mount(t, { noDefault: true })
  assert.equal(h.slider().max, '3')
  await h.drag(0)
  assert.deepEqual({ ...h.requests[0].selection }, { provider: 'provider', model: 'first' })
  assert.equal(h.slider().getAttribute('aria-valuetext'), '기본값')
})

await test('선택에 실패하면 초안을 되돌리고 메뉴의 실패 알림을 사용한다', async (t) => {
  const h = await mount(t)
  await h.drag(2)
  await h.reply(false)
  assert.equal(h.slider().getAttribute('aria-valuetext'), 'medium')
  assert.equal(h.failures.length, 1)
})

await test('선택이 진행 중이면 슬라이더 포커스를 유지하되 새 조작을 확정하지 않는다', async (t) => {
  const h = await mount(t)
  await h.drag(2)
  assert.equal(h.slider().disabled, false)
  assert.equal(h.slider().getAttribute('aria-disabled'), 'true')
  await h.drag(0)
  assert.equal(h.requests.length, 1)
})

await test('위아래 방향키가 숨긴 공식 행을 건너뛰고 슬라이더를 포함한 메뉴 행을 순서대로 이동한다', async (t) => {
  const h = await mount(t)
  const model = h.document.getElementById('model-row')
  model.focus()
  const press = (key) =>
    React.act(async () =>
      h.document.activeElement.dispatchEvent(new h.window.KeyboardEvent('keydown', { key, bubbles: true }))
    )
  const order = []
  for (let step = 0; step < 4; step++) {
    await press('ArrowDown')
    order.push(h.document.activeElement.className || h.document.activeElement.id)
  }
  assert.deepEqual(order, ['dsh-picker-star', 'dsh-effort-input', 'dsh-picker-cell', 'model-row'])
  await press('ArrowUp')
  assert.equal(h.document.activeElement.className, 'dsh-picker-cell')
})

await test('별 버튼은 슬라이더 초안의 모델과 추론 강도 조합을 즐겨찾기에 추가하고 제거한다', async (t) => {
  const h = await mount(t)
  const star = () => h.menu.querySelector('.dsh-picker-star')
  assert.equal(star().getAttribute('aria-checked'), 'false')
  await React.act(async () => star().click())
  assert.deepEqual(h.favorites(), [favorite('first', 'medium')])
  assert.equal(star().getAttribute('aria-checked'), 'true')
  await React.act(async () => star().click())
  assert.deepEqual(h.favorites(), [])
})

await test('즐겨찾기 행은 개수를 표시하고 즐겨찾기 상세 창을 연다', async (t) => {
  const h = await mount(t, { favorites: [favorite('first', 'medium'), favorite('second', 'high')] })
  const row = h.menu.querySelector('[data-model-menu-pane]')
  assert.equal(row.getAttribute('role'), 'menuitem')
  assert.match(row.textContent, /즐겨찾기.*2/)
  await React.act(async () => row.click())
  assert.deepEqual({ ...h.controls.opened }, { key: row.dataset.modelMenuPane, title: '즐겨찾기' })
})

await test('즐겨찾기 상세 창에서 조합을 고르면 적용하고 메뉴를 닫으며 사용할 수 없는 항목은 비활성화한다', async (t) => {
  const h = await mount(t, {
    favorites: [favorite('first', 'medium'), favorite('second', 'high'), favorite('missing', 'low')],
  })
  await h.renderPane()
  const rows = [...h.pane.querySelectorAll('button[role=menuitemradio]')]
  assert.deepEqual(
    rows.map((row) => [row.getAttribute('aria-checked'), row.disabled]),
    [
      ['true', false],
      ['false', false],
      ['false', true],
    ]
  )
  assert.match(rows[2].textContent, /사용할 수 없음/)
  await React.act(async () => rows[1].click())
  assert.deepEqual({ ...h.requests[0].selection }, favorite('second', 'high'))
  assert.equal(h.dismissed(), 0)
  await h.reply()
  assert.equal(h.dismissed(), 1)
})

await test('즐겨찾기가 없으면 상세 창에 안내 문구를 표시한다', async (t) => {
  const h = await mount(t, { language: 'en' })
  await h.renderPane()
  assert.match(h.pane.textContent, /No favorites yet/)
  assert.equal(h.pane.querySelectorAll('button[role=menuitemradio]').length, 0)
})

await test('열기 단축키는 입력 위치가 속한 입력창의 공식 모델 버튼을 누른다', async (t) => {
  const h = await mount(t)
  const trigger = h.card.querySelector('button[aria-haspopup=menu]')
  let clicks = 0
  trigger.addEventListener('click', () => clicks++)
  const open = h.commands.get('dungsil.model-picker.open')
  const action = open.resolve({ region: 'editable', modal: null, target: h.card })
  assert.equal(action.status, 'handled')
  action.run()
  assert.equal(clicks, 1)
  trigger.disabled = true
  assert.equal(open.resolve({ region: 'editable', modal: null, target: h.card }).status, 'blocked')
})

await test('전환 단축키는 저장한 순서대로 다음 즐겨찾기를 적용하고 두 개 미만이면 차단한다', async (t) => {
  const h = await mount(t, { favorites: [favorite('first', 'medium'), favorite('second', 'high')] })
  const cycle = h.commands.get('dungsil.model-picker.cycle-favorites')
  const action = cycle.resolve({ region: 'editable', modal: null, target: h.card })
  assert.equal(action.status, 'handled')
  await React.act(async () => action.run())
  assert.deepEqual({ ...h.requests[0].selection }, favorite('second', 'high'))
  await h.reply()
  await React.act(async () => h.menu.querySelector('.dsh-picker-star').click())
  assert.equal(cycle.resolve({ region: 'editable', modal: null, target: h.card }).status, 'blocked')
})

await test('모든 로케일이 동일한 UI 키와 비어 있지 않은 번역을 제공한다', async () => {
  const languages = ['en', 'ko', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']
  const resources = await Promise.all(
    languages.map(async (language) =>
      JSON.parse(await readFile(new URL('../locale/' + language + '.json', import.meta.url), 'utf8'))
    )
  )
  const keys = Object.keys(resources[0].ui).sort()
  for (const resource of resources) {
    assert.deepEqual(Object.keys(resource.ui).sort(), keys)
    assert.ok(Object.values(resource.ui).every((value) => typeof value === 'string' && value.trim()))
  }
})
