import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

async function mount(
  t,
  {
    language = 'ko',
    locked = false,
    runtime = 'desktop',
    mobile = false,
    favorites,
    conflict = false,
    sessionId = 'test',
  } = {}
) {
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
  let plugin, Picker, command, fixedInput
  const commands = new Map()
  if (favorites) window.localStorage.setItem('dungsil.model-picker.favorites', JSON.stringify(favorites))
  const disposers = []
  const primitives = {
    Tooltip: ({ label, shortcutKeys, children }) =>
      React.createElement(
        'span',
        { 'data-tooltip': label },
        children,
        shortcutKeys?.map((key) => React.createElement('kbd', { key }, key))
      ),
    Input: React.forwardRef(({ className, ...props }, ref) =>
      React.createElement('span', { className }, React.createElement('input', { ...props, ref }))
    ),
    isMobileDevice: () => mobile,
    rankByName: (items, query) =>
      items.filter(({ name }) => {
        let at = 0
        for (const char of name.toLowerCase()) if (char === query.toLowerCase()[at]) at++
        return at === query.length
      }),
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
  const initial = {
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
  // Each session owns its directory, as the host resolver does.
  const directories = new Map()
  const directoryFor = (id) => {
    if (directories.has(id)) return directories.get(id)
    let state = { ...initial }
    const listeners = new Set()
    const requests = []
    const update = (patch) => {
      state = { ...state, ...patch }
      listeners.forEach((listener) => listener())
    }
    const directory = {
      store: {
        getSnapshot: () => state,
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
      update,
      requests,
    }
    directories.set(id, directory)
    return directory
  }
  const directory = directoryFor(sessionId)
  const { update, requests } = directory
  const locale = { active: language }
  let shortcutRows = [{ id: 'other.command', keys: ['Ctrl', 'X'] }]
  const emptyShortcutRows = []
  const shortcutListeners = new Set()
  const shortcutCatalog = {
    getSnapshot: () => shortcutRows,
    subscribe: (listener) => {
      shortcutListeners.add(listener)
      return () => shortcutListeners.delete(listener)
    },
  }
  const setShortcutKeys = (keys) => {
    shortcutRows = [
      { id: 'other.command', keys: ['Ctrl', 'X'] },
      { id: 'dungsil.model-picker.open', keys },
    ]
    shortcutListeners.forEach((listener) => listener())
  }
  plugin.apply({
    shortcuts: {
      runtime,
      catalog: runtime === 'desktop' ? shortcutCatalog : { ...shortcutCatalog, getSnapshot: () => emptyShortcutRows },
      fixedCatalog: runtime === 'web' ? shortcutCatalog : { ...shortcutCatalog, getSnapshot: () => emptyShortcutRows },
      registerFixed: (value) => {
        command = value
        setShortcutKeys(value.keys)
        return () => {
          command = undefined
        }
      },
      observeFixedInput: (listener) => {
        fixedInput = listener
        return () => {
          fixedInput = undefined
        }
      },
      register: (value) => {
        if (conflict && value.id === 'dungsil.model-picker.cycle-favorites' && Object.keys(value.defaults).length)
          throw new Error('Conflicting shortcut defaults')
        commands.set(value.id, value)
        if (value.id === 'dungsil.model-picker.open') {
          command = value
          setShortcutKeys(['Alt', 'P'])
        }
        return () => {
          commands.delete(value.id)
          if (command === value) command = undefined
        }
      },
    },
    locale: { getSnapshot: () => locale, subscribe: () => () => {} },
    modelDirectories: { directoryFor },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (_options, render) => {
        if (_options.name === 'conversation.input.model') Picker = render
      },
    },
    effect(setup, name) {
      if (name === 'ui-model-picker: shortcut') disposers.push(setup())
    },
  })
  await React.act(async () =>
    root.render(React.createElement(Picker, { sessionId, useSession: (read) => read({}), locked }))
  )
  const click = (selector) => React.act(async () => document.querySelector(selector).click())
  const slider = () => document.querySelector('input[type=range]')
  let activeGesture = null
  const change = (value, event = 'change', key = 'ArrowRight') =>
    React.act(async () => {
      const input = slider()
      const kind = event === 'keyup' ? 'keyboard' : 'pointer'
      if (activeGesture !== kind) {
        input.dispatchEvent(
          kind === 'keyboard'
            ? new window.KeyboardEvent('keydown', { key, bubbles: true })
            : new window.PointerEvent('pointerdown', { bubbles: true, pointerId: 7 })
        )
        activeGesture = kind
      }
      // Use the native setter so React observes the input rather than its value tracker.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, String(value))
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
      input.dispatchEvent(
        event === 'keyup'
          ? new window.KeyboardEvent(event, { key, bubbles: true })
          : event.startsWith('pointer')
            ? new window.PointerEvent(event, { bubbles: true, pointerId: 7 })
            : new window.Event(event, { bubbles: true })
      )
      if (event === 'keyup' || event === 'pointerup') activeGesture = null
    })
  const commit = async (value, event = 'pointerup') => {
    await change(value, event)
  }
  const reply = (ok = true, project = true, target = directory) =>
    React.act(async () => {
      const { selection, resolve } = target.requests.at(-1)
      target.update({ status: 'ready', ...(ok && project ? { current: selection } : {}) })
      resolve({ ok })
    })
  const scroll = (target) => React.act(async () => target.dispatchEvent(new window.Event('scroll')))
  const anchor = document.querySelector('.dsh-codex-picker')
  anchor.getClientRects = () => [anchor.getBoundingClientRect()]
  t.after(() => disposers.forEach((dispose) => dispose()))
  return {
    window,
    document,
    slider,
    click,
    change,
    commit,
    reply,
    requests,
    update,
    scroll,
    snapshot: () => directory.store.getSnapshot(),
    command: () => command,
    commands,
    cycle: () => commands.get('dungsil.model-picker.cycle-favorites'),
    directoryFor,
    Picker: () => Picker,
    createRoot,
    container,
    fixedInput: (input) => fixedInput(input),
    setShortcutKeys: (keys) => React.act(async () => setShortcutKeys(keys)),
    anchor,
  }
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

for (const [language, tooltip, label] of [
  ['ko', '추론 수준 설정', '모델 피커 열기'],
  ['en', 'Configure reasoning effort', 'Open model picker'],
  ['zh', '设置推理级别', '打开模型选择器'],
  ['ja-JP', '推論強度を設定', 'モデル選択を開く'],
  ['es-MX', 'Configurar esfuerzo de razonamiento', 'Abrir selector de modelos'],
  ['fr-CA', 'Configurer l’effort de raisonnement', 'Ouvrir le sélecteur de modèles'],
  ['de-DE', 'Denkaufwand einstellen', 'Modellauswahl öffnen'],
  ['ru-RU', 'Настроить глубину рассуждений', 'Открыть выбор модели'],
  ['pt-BR', 'Configurar esforço de raciocínio', 'Abrir seletor de modelos'],
  ['JA_jp', '推論強度を設定', 'モデル選択を開く'],
  ['unknown', 'Configure reasoning effort', 'Open model picker'],
]) {
  await test(`${language} 로케일에서 추론 수준 툴팁과 단축키 이름을 제공한다`, async (t) => {
    const h = await mount(t, { language })
    assert.equal(h.document.querySelector('[data-tooltip]').getAttribute('data-tooltip'), tooltip)
    assert.deepEqual(
      [...h.document.querySelectorAll('kbd')].map((key) => key.textContent),
      ['Alt', 'P']
    )
    assert.equal(h.document.querySelector('.dsh-codex-trigger').hasAttribute('title'), false)
    assert.equal(h.command().label(), label)
    for (const binding of Object.values(h.command().defaults)) {
      assert.equal(binding.code, 'KeyP')
      assert.deepEqual([...binding.modifiers], ['alt'])
    }
  })
}

await test('툴팁은 현재 단축키를 표시하고 키 변경과 해제를 즉시 반영한다', async (t) => {
  const h = await mount(t)
  await h.setShortcutKeys(['Ctrl', 'Shift', 'M'])
  assert.deepEqual(
    [...h.document.querySelectorAll('kbd')].map((key) => key.textContent),
    ['Ctrl', 'Shift', 'M']
  )
  await h.setShortcutKeys([])
  assert.equal(h.document.querySelector('kbd'), null)
  assert.equal(h.document.querySelector('[data-tooltip]').getAttribute('data-tooltip'), '추론 수준 설정')
  await h.setShortcutKeys(['Alt', 'P'])
  assert.deepEqual(
    [...h.document.querySelectorAll('kbd')].map((key) => key.textContent),
    ['Alt', 'P']
  )
})

await test('웹 고정 단축키는 정확한 Alt P만 처리하고 모달과 터미널 및 조합 중 입력을 무시한다', async (t) => {
  const h = await mount(t, { runtime: 'web' })
  assert.deepEqual([...h.command().keys], ['Alt', 'P'])
  assert.deepEqual(
    [...h.document.querySelectorAll('kbd')].map((key) => key.textContent),
    ['Alt', 'P']
  )
  let consumed = 0
  const input = {
    type: 'keydown',
    gesture: {
      code: 'KeyP',
      alt: true,
      control: false,
      meta: false,
      shift: false,
      repeat: false,
      composing: false,
      defaultPrevented: false,
    },
    context: { region: 'editable', modal: null },
    consume: () => consumed++,
  }
  for (const patch of [
    { control: true },
    { shift: true },
    { meta: true },
    { alt: false },
    { composing: true },
    { repeat: true },
    { defaultPrevented: true },
    { code: 'KeyQ' },
    { secondCode: 'KeyQ' },
  ]) {
    h.fixedInput({ ...input, gesture: { ...input.gesture, ...patch } })
  }
  h.fixedInput({ ...input, context: { region: 'terminal', modal: null } })
  h.fixedInput({ ...input, context: { region: 'page', modal: 'settings' } })
  assert.equal(consumed, 0)
  assert.equal(h.slider(), null)
  await React.act(async () => h.fixedInput(input))
  assert.equal(consumed, 1)
  assert.ok(h.slider())
})

await test('단축키는 피커를 열고 다시 실행하면 닫으며 Escape는 트리거로 포커스를 돌린다', async (t) => {
  const h = await mount(t)
  const invoke = () =>
    React.act(async () => {
      const resolution = h.command().resolve()
      assert.equal(resolution.status, 'handled')
      resolution.run()
    })
  await invoke()
  assert.ok(h.slider())
  assert.equal(h.document.activeElement, h.slider())
  await invoke()
  assert.equal(h.slider(), null)
  await invoke()
  await React.act(async () =>
    h.slider().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  )
  assert.equal(h.slider(), null)
  assert.equal(h.document.activeElement, h.document.querySelector('.dsh-codex-trigger'))
})

await test('단축키는 잠금이나 변경 중에 피커를 열지 않고 숨겨진 피커를 무시한다', async (t) => {
  const h = await mount(t, { locked: true })
  assert.equal(h.command().resolve().status, 'blocked')
  h.anchor.getClientRects = () => []
  assert.equal(h.command().resolve().status, 'pass')
  assert.equal(h.slider(), null)
})

await test('단축키는 모델 변경 중에 피커를 열지 않는다', async (t) => {
  const h = await mount(t)
  await React.act(async () => h.update({ status: 'selecting' }))
  assert.equal(h.command().resolve().status, 'blocked')
  assert.equal(h.slider(), null)
})

await test('추론 수준이 없는 모델의 툴팁은 모델 선택을 안내한다', async (t) => {
  const h = await mount(t)
  await React.act(async () => h.update({ groups: [{ id: 'provider', models: [{ id: 'first', name: 'first' }] }] }))
  assert.equal(h.document.querySelector('[data-tooltip]').getAttribute('data-tooltip'), '모델 선택')
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

await test('다섯 모델부터 검색하며 제공자 순서를 유지하고 검색 결과를 선택한다', async (t) => {
  const h = await mount(t)
  const efforts = ['low', 'high'].map((id) => ({ id, name: id }))
  const entry = (id) => ({ id, name: id, reasoning: { efforts, defaultEffort: 'low' } })
  await React.act(async () =>
    h.update({
      groups: [
        { id: 'other', name: 'Other', models: [entry('first'), entry('apple'), entry('berry')] },
        { id: 'deepseek-official', name: 'Official', models: [entry('alpha')] },
        { id: 'deepseek-account', name: 'Account', models: [entry('atlas')] },
      ],
      current: { provider: 'other', model: 'first', reasoningEffort: 'low' },
    })
  )
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  assert.deepEqual(
    [...h.document.querySelectorAll('.dsh-codex-models .dsh-codex-provider')].map((el) => el.textContent),
    ['Account', 'Official', 'Other']
  )
  const input = h.document.querySelector('[role=searchbox]')
  assert.equal(h.document.activeElement, input)
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype, 'value').set.call(input, 'ap')
    input.dispatchEvent(new h.window.Event('input', { bubbles: true }))
  })
  assert.deepEqual(
    [...h.document.querySelectorAll('.dsh-codex-models button')].map((el) => el.textContent),
    ['alpha', 'apple']
  )
  assert.equal(h.document.activeElement, input)
  await React.act(async () =>
    input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  )
  await React.act(async () =>
    input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  assert.match(h.document.querySelector('.dsh-codex-model').textContent, /apple/)
  assert.equal(h.requests.length, 0)
})

await test('방향키로 열고 모델 화면에 들어갔다가 뒤로 이동하며 Home과 End로 버튼을 탐색한다', async (t) => {
  const h = await mount(t)
  const key = (element, value, options = {}) =>
    React.act(async () =>
      element.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: value, bubbles: true, ...options }))
    )
  const trigger = h.document.querySelector('.dsh-codex-trigger')
  await key(trigger, 'ArrowDown')
  const model = h.document.querySelector('.dsh-codex-model')
  model.focus()
  await key(model, 'ArrowRight')
  assert.ok(h.document.querySelector('.dsh-codex-models'))
  await key(h.document.activeElement, 'End')
  assert.equal(h.document.activeElement.textContent, '모델 목록 새로고침')
  await key(h.document.activeElement, 'Home')
  assert.ok(h.document.activeElement.classList.contains('dsh-codex-back'))
  await key(h.document.activeElement, 'ArrowLeft')
  assert.equal(h.document.activeElement, h.document.querySelector('.dsh-codex-model'))
  await key(h.document.activeElement, 'ArrowRight')
  await key(h.document.activeElement, 'Tab', { shiftKey: true })
  assert.equal(h.document.activeElement, h.document.querySelector('.dsh-codex-model'))
})

await test('비모달 피커에서 Alt P를 다시 누르면 닫고 다른 모달에서는 처리하지 않는다', async (t) => {
  const h = await mount(t, { runtime: 'web' })
  let consumed = 0
  const input = {
    type: 'keydown',
    gesture: { code: 'KeyP', alt: true },
    context: { region: 'editable', modal: null },
    consume: () => consumed++,
  }
  await React.act(async () => h.fixedInput(input))
  assert.equal(h.document.querySelector('[role=dialog]').getAttribute('aria-modal'), null)
  await React.act(async () => h.fixedInput({ ...input, context: { region: 'editable', modal: 'settings' } }))
  assert.ok(h.slider())
  await React.act(async () => h.fixedInput(input))
  assert.equal(h.slider(), null)
  assert.equal(consumed, 2)
})

for (const cancellation of ['pointercancel', 'lostpointercapture', 'blur', 'windowblur', 'Escape']) {
  await test(`${cancellation} 이후 늦게 도착한 포인터 해제는 변경을 확정하지 않는다`, async (t) => {
    const h = await mount(t)
    await h.click('.dsh-codex-trigger')
    const input = h.slider()
    await h.change(2)
    await React.act(async () => {
      if (cancellation === 'Escape')
        input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      else if (cancellation === 'windowblur') h.window.dispatchEvent(new h.window.Event('blur'))
      else if (cancellation === 'blur') input.dispatchEvent(new h.window.Event('blur', { bubbles: true }))
      else input.dispatchEvent(new h.window.PointerEvent(cancellation, { bubbles: true, pointerId: 7 }))
      input.dispatchEvent(new h.window.PointerEvent('pointerup', { bubbles: true, pointerId: 7 }))
    })
    assert.equal(h.requests.length, 0)
    if (h.slider()) assert.equal(h.slider().value, '1')
  })
}

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

await test('수정 키와 조합 중 입력 및 취소된 키는 슬라이더를 확정하지 않는다', async (t) => {
  const h = await mount(t)
  await h.click('.dsh-codex-trigger')
  const input = h.slider()
  for (const options of [
    { altKey: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { isComposing: true },
  ]) {
    await React.act(async () => {
      const down = new h.window.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
        ...options,
      })
      input.dispatchEvent(down)
      assert.equal(down.defaultPrevented, !options.isComposing)
      input.dispatchEvent(new h.window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, ...options }))
    })
  }
  await React.act(async () => {
    const down = new h.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    down.preventDefault()
    input.dispatchEvent(down)
    input.dispatchEvent(new h.window.KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }))
  })
  assert.equal(h.requests.length, 0)
})

await test('검색 결과의 강조 행을 가까운 위치로 스크롤한다', async (t) => {
  const h = await mount(t)
  const seen = []
  h.window.HTMLElement.prototype.scrollIntoView = function (options) {
    seen.push([this.id, options.block])
  }
  await React.act(async () =>
    h.update({
      groups: [
        {
          id: 'provider',
          name: 'Provider',
          models: ['first', 'second', 'third', 'fourth', 'fifth'].map((id) => ({ id, name: id })),
        },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  const input = h.document.querySelector('[role=searchbox]')
  assert.ok(input)
  const before = input.getAttribute('aria-activedescendant')
  await React.act(async () =>
    input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  )
  const after = input.getAttribute('aria-activedescendant')
  assert.notEqual(after, before)
  assert.deepEqual(seen.at(-1), [after, 'nearest'])
  assert.equal(h.document.getElementById(after).getAttribute('role'), 'option')
})

await test('검색 결과에 포인터를 움직이면 단일 강조 행을 갱신하고 탭 순서에서 제외한다', async (t) => {
  const h = await mount(t)
  await React.act(async () =>
    h.update({
      groups: [
        {
          id: 'provider',
          name: 'Provider',
          models: ['first', 'second', 'third', 'fourth', 'fifth'].map((id) => ({ id, name: id })),
        },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  const options = [...h.document.querySelectorAll('[role=option]')]
  assert.ok(options.every((option) => option.tabIndex === -1))
  await React.act(async () => options[3].dispatchEvent(new h.window.MouseEvent('mousemove', { bubbles: true })))
  assert.deepEqual([...h.document.querySelectorAll('[data-highlighted]')], [options[3]])
  assert.equal(h.document.querySelector('[role=searchbox]').getAttribute('aria-activedescendant'), options[3].id)
  assert.equal(options[3].parentElement.getAttribute('role'), 'group')
  assert.equal(options[3].parentElement.querySelector('.dsh-codex-provider').getAttribute('aria-hidden'), 'true')
})

await test('검색 결과 인덱스를 제공자 전체에서 다시 계산하고 같은 모델 ID도 원본 변경 없이 구분한다', async (t) => {
  const h = await mount(t)
  const initial = h.snapshot().groups[0]
  const shared = Object.freeze({ id: 'shared', name: 'Shared Provider' })
  await React.act(async () =>
    h.update({
      groups: [
        { ...initial, models: [initial.models[0], shared, Object.freeze({ id: 'more', name: 'More' })] },
        {
          id: 'deepseek-official',
          name: 'Official',
          models: [
            Object.freeze({ id: 'shared', name: 'Shared Official' }),
            Object.freeze({ id: 'last', name: 'Last' }),
          ],
        },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  const rows = () => [...h.document.querySelectorAll('[role=option]')]
  assert.equal(rows().length, 5)
  assert.ok(rows().every((row, index) => row.id.endsWith('-model-' + index)))
  const search = h.document.querySelector('[role=searchbox]')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype, 'value').set.call(search, 'shared')
    search.dispatchEvent(new h.window.Event('input', { bubbles: true }))
  })
  assert.deepEqual(
    rows().map((row) => row.textContent),
    ['Shared Official', 'Shared Provider']
  )
  assert.ok(rows().every((row, index) => row.id.endsWith('-model-' + index)))
  const providerRow = rows()[1]
  await React.act(async () => providerRow.dispatchEvent(new h.window.MouseEvent('mousemove', { bubbles: true })))
  assert.equal(search.getAttribute('aria-activedescendant'), providerRow.id)
  assert.deepEqual([...h.document.querySelectorAll('[data-highlighted]')], [providerRow])
  await React.act(async () =>
    search.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  assert.deepEqual({ ...h.requests.at(-1).selection }, { provider: 'provider', model: 'shared' })
  assert.deepEqual(Object.keys(shared), ['id', 'name'])
})

await test('모바일에서는 검색을 자동으로 포커스하지 않고 트리거에 둔다', async (t) => {
  const h = await mount(t, { mobile: true })
  await React.act(async () =>
    h.update({
      current: null,
      groups: [
        {
          id: 'provider',
          name: 'Provider',
          models: ['first', 'second', 'third', 'fourth', 'fifth'].map((id) => ({ id, name: id })),
        },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  assert.ok(h.document.querySelector('[role=searchbox]'))
  assert.equal(h.document.activeElement, h.document.querySelector('.dsh-codex-trigger'))
})

await test('모델 로딩 뒤 검색창이 나타나면 데스크톱에서 검색창에 포커스한다', async (t) => {
  const h = await mount(t)
  await React.act(async () => h.update({ current: null, groups: [], status: 'loading' }))
  await h.click('.dsh-codex-trigger')
  await React.act(async () =>
    h.update({
      status: 'ready',
      groups: [
        {
          id: 'provider',
          name: 'Provider',
          models: ['first', 'second', 'third', 'fourth', 'fifth'].map((id) => ({ id, name: id })),
        },
      ],
    })
  )
  assert.equal(h.document.activeElement, h.document.querySelector('[role=searchbox]'))
})

const favorite = (model, reasoningEffort) => ({ provider: 'provider', model, reasoningEffort })
const runCycle = (h, context) =>
  React.act(async () => {
    const resolution = h.cycle().resolve(context ?? { region: 'editable', modal: null, target: null })
    assert.equal(resolution.status, 'handled')
    resolution.run()
  })

await test('검색 결과를 키보드로 선택해도 즐겨찾기를 유지하고 모델 결과의 기본 강도를 준비한다', async (t) => {
  const h = await mount(t, { favorites: [favorite('third', 'high')] })
  const efforts = ['low', 'medium', 'high'].map((id) => ({ id, name: id }))
  await React.act(async () =>
    h.update({
      groups: [
        {
          id: 'provider',
          name: 'Provider',
          models: ['first', 'second', 'third', 'fourth', 'fifth'].map((id) => ({
            id,
            name: id,
            reasoning: { efforts, defaultEffort: 'low' },
          })),
        },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  const input = h.document.querySelector('[role=searchbox]')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype, 'value').set.call(input, 'se')
    input.dispatchEvent(new h.window.Event('input', { bubbles: true }))
  })
  assert.deepEqual(
    [...h.document.querySelectorAll('[role=option]')].map((row) => row.textContent),
    ['second']
  )
  assert.equal(h.document.querySelector('.dsh-codex-favorite .dsh-codex-option').textContent, 'thirdhigh')
  const active = h.document.getElementById(input.getAttribute('aria-activedescendant'))
  assert.equal(active.getAttribute('role'), 'option')
  assert.equal(active.textContent, 'second')
  await React.act(async () =>
    input.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  )
  assert.match(h.document.querySelector('.dsh-codex-model').textContent, /low.*second/)
  assert.equal(h.requests.length, 0)
  await h.click('.dsh-codex-model')
  await h.click('.dsh-codex-favorite .dsh-codex-option')
  assert.deepEqual({ ...h.requests.at(-1).selection }, favorite('third', 'high'))
  await h.reply()
  assert.equal(h.document.querySelector('[role=dialog]'), null)
})

for (const query of ['', 'zzzz']) {
  await test(`${query ? '검색 결과가 없어도' : '첫 검색 결과에서'} 위쪽 방향키로 즐겨찾기에 도달하고 선택 없이 제거한다`, async (t) => {
    const h = await mount(t, { favorites: [favorite('first', 'medium')] })
    const initial = h.snapshot().groups[0]
    await React.act(async () =>
      h.update({
        groups: [
          { ...initial, models: [...initial.models, ...['third', 'fourth', 'fifth'].map((id) => ({ id, name: id }))] },
        ],
      })
    )
    await h.click('.dsh-codex-trigger')
    await h.click('.dsh-codex-model')
    const search = h.document.querySelector('[role=searchbox]')
    assert.equal(h.document.activeElement, search)
    if (query) {
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype, 'value').set.call(search, query)
        search.dispatchEvent(new h.window.Event('input', { bubbles: true }))
      })
    }
    const active = search.getAttribute('aria-activedescendant')
    await React.act(async () =>
      search.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    )
    const star = h.document.querySelector('.dsh-codex-favorite .dsh-codex-star')
    assert.equal(h.document.activeElement, star)
    assert.equal(search.getAttribute('aria-activedescendant'), active)
    await h.click('.dsh-codex-favorite .dsh-codex-star')
    assert.deepEqual(JSON.parse(h.window.localStorage.getItem('dungsil.model-picker.favorites')), [])
    assert.equal(h.requests.length, 0)
  })
}

await test('검색창의 Tab은 강조된 모델의 강도를 준비하고 Shift Tab 두 번으로 선택 없이 닫는다', async (t) => {
  const h = await mount(t)
  const initial = h.snapshot().groups[0]
  await React.act(async () =>
    h.update({
      groups: [
        { ...initial, models: [...initial.models, ...['third', 'fourth', 'fifth'].map((id) => ({ id, name: id }))] },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  const search = h.document.querySelector('[role=searchbox]')
  const tab = new h.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  await React.act(async () => search.dispatchEvent(tab))
  assert.equal(tab.defaultPrevented, true)
  assert.ok(h.slider())
  assert.equal(h.requests.length, 0)
  await h.click('.dsh-codex-model')
  await React.act(async () =>
    h.document.activeElement.dispatchEvent(
      new h.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    )
  )
  assert.ok(h.slider())
  await React.act(async () =>
    h.document.activeElement.dispatchEvent(
      new h.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    )
  )
  assert.equal(h.document.querySelector('[role=dialog]'), null)
  assert.equal(h.document.activeElement, h.document.querySelector('.dsh-codex-trigger'))
  assert.equal(h.requests.length, 0)
})

await test('검색창에서 위쪽 방향키와 End로 새로고침 버튼에 도달하고 모델 선택 없이 다시 불러온다', async (t) => {
  const h = await mount(t, { favorites: [favorite('first', 'medium')] })
  const initial = h.snapshot().groups[0]
  await React.act(async () =>
    h.update({
      groups: [
        { ...initial, models: [...initial.models, ...['third', 'fourth', 'fifth'].map((id) => ({ id, name: id }))] },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  const search = h.document.querySelector('[role=searchbox]')
  assert.equal(h.document.activeElement, search)
  await React.act(async () =>
    search.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  )
  assert.ok(h.document.activeElement.closest('.dsh-codex-favorites'))
  await React.act(async () =>
    h.document.activeElement.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  )
  const reload = h.document.activeElement
  assert.equal(reload.textContent, '모델 목록 새로고침')
  let loads = 0
  h.directoryFor('test').load = async () => {
    loads++
  }
  await React.act(async () => reload.click())
  assert.equal(loads, 1)
  assert.equal(h.requests.length, 0)
})

await test('즐겨찾기와 검색 결과가 없으면 Tab 기본 이동을 막지 않고 Escape로 선택 없이 닫는다', async (t) => {
  const h = await mount(t)
  await React.act(async () =>
    h.update({
      current: null,
      groups: [
        {
          id: 'provider',
          name: 'Provider',
          models: ['first', 'second', 'third', 'fourth', 'fifth'].map((id) => ({ id, name: id })),
        },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  const search = h.document.querySelector('[role=searchbox]')
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype, 'value').set.call(search, 'zzzz')
    search.dispatchEvent(new h.window.Event('input', { bubbles: true }))
  })
  assert.equal(h.document.querySelector('.dsh-codex-favorites'), null)
  assert.equal(h.document.querySelectorAll('[role=option]').length, 0)
  const tab = new h.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  await React.act(async () => search.dispatchEvent(tab))
  assert.equal(tab.defaultPrevented, false)
  await React.act(async () =>
    search.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  )
  assert.equal(h.document.querySelector('[role=dialog]'), null)
  assert.equal(h.document.activeElement, h.document.querySelector('.dsh-codex-trigger'))
  assert.equal(h.requests.length, 0)
})

await test('검색창이 있어도 즐겨찾기의 방향키 탐색은 검색창으로 포커스를 옮기지 않는다', async (t) => {
  const h = await mount(t, { favorites: [favorite('first', 'medium')] })
  const initial = h.snapshot().groups[0]
  await React.act(async () =>
    h.update({
      groups: [
        { ...initial, models: [...initial.models, ...['third', 'fourth', 'fifth'].map((id) => ({ id, name: id }))] },
      ],
    })
  )
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  const search = h.document.querySelector('[role=searchbox]')
  const option = h.document.querySelector('.dsh-codex-favorite .dsh-codex-option')
  const star = h.document.querySelector('.dsh-codex-favorite .dsh-codex-star')
  const active = search.getAttribute('aria-activedescendant')
  option.focus()
  await React.act(async () =>
    option.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  )
  assert.equal(h.document.activeElement, star)
  await React.act(async () =>
    star.dispatchEvent(new h.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  )
  assert.equal(h.document.activeElement, option)
  assert.equal(search.getAttribute('aria-activedescendant'), active)
  assert.equal(h.requests.length, 0)
})

await test('즐겨찾기 전환은 저장된 순서를 따르고 현재 조합 다음 항목을 선택한다', async (t) => {
  const h = await mount(t, {
    favorites: [favorite('second', 'high'), favorite('first', 'medium'), favorite('first', 'low')],
  })
  await runCycle(h)
  assert.deepEqual({ ...h.requests.at(-1).selection }, favorite('first', 'low'))
  await h.reply()
  await runCycle(h)
  assert.deepEqual({ ...h.requests.at(-1).selection }, favorite('second', 'high'))
  await h.reply()
  await runCycle(h)
  assert.deepEqual({ ...h.requests.at(-1).selection }, favorite('first', 'medium'))
  assert.equal(h.slider(), null)
})

await test('즐겨찾기 추가는 목록 끝에 붙여 저장하고 다시 누르면 제거한다', async (t) => {
  const h = await mount(t, { favorites: [favorite('second', 'high')] })
  await h.click('.dsh-codex-trigger')
  await h.change(2)
  const star = () => h.document.querySelector('.dsh-codex-header .dsh-codex-star')
  assert.equal(star().getAttribute('aria-pressed'), 'false')
  assert.match(star().getAttribute('aria-label'), /^즐겨찾기에 추가: first, high$/)
  await h.click('.dsh-codex-header .dsh-codex-star')
  assert.equal(star().getAttribute('aria-pressed'), 'true')
  assert.equal(h.requests.length, 0)
  const stored = () => JSON.parse(h.window.localStorage.getItem('dungsil.model-picker.favorites'))
  assert.deepEqual(stored(), [favorite('second', 'high'), favorite('first', 'high')])
  await h.click('.dsh-codex-model')
  assert.deepEqual(
    [...h.document.querySelectorAll('.dsh-codex-favorite .dsh-codex-option')].map((row) => row.textContent),
    ['secondhigh', 'firsthigh']
  )
  await h.click('.dsh-codex-favorite:last-child .dsh-codex-star')
  assert.deepEqual(stored(), [favorite('second', 'high')])
  assert.equal(h.document.querySelectorAll('.dsh-codex-favorite').length, 1)
})

await test('즐겨찾기 행을 누르면 모델과 추론 강도를 함께 적용한다', async (t) => {
  const h = await mount(t, { favorites: [favorite('second', 'high')] })
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  await h.click('.dsh-codex-favorite .dsh-codex-option')
  assert.deepEqual({ ...h.requests[0].selection }, favorite('second', 'high'))
  await h.reply()
  assert.equal(h.document.querySelector('[role=dialog]'), null)
})

await test('사용할 수 없는 모델과 지원하지 않는 추론 강도는 비활성화하고 전환에서 건너뛴다', async (t) => {
  const h = await mount(t, {
    favorites: [
      favorite('first', 'medium'),
      favorite('gone', 'high'),
      favorite('second', 'max'),
      favorite('second', 'low'),
    ],
  })
  await runCycle(h)
  assert.deepEqual({ ...h.requests.at(-1).selection }, favorite('second', 'low'))
  await h.reply()
  await h.click('.dsh-codex-trigger')
  await h.click('.dsh-codex-model')
  const rows = [...h.document.querySelectorAll('.dsh-codex-favorite .dsh-codex-option')]
  assert.deepEqual(
    rows.map((row) => row.disabled),
    [false, true, true, false]
  )
  assert.match(rows[1].textContent, /사용할 수 없음/)
  assert.match(rows[2].textContent, /사용할 수 없음/)
  assert.match(rows[1].textContent, /^gonehigh/)
  assert.match(rows[2].textContent, /^secondmax/)
})

await test('사용 가능한 즐겨찾기가 두 개 미만이면 전환을 차단한다', async (t) => {
  const h = await mount(t, { favorites: [favorite('first', 'medium'), favorite('gone', 'high')] })
  assert.equal(h.cycle().resolve({ region: 'editable', modal: null, target: null }).status, 'blocked')
})

await test('잠긴 입력창에서는 즐겨찾기 전환을 차단한다', async (t) => {
  const locked = await mount(t, {
    locked: true,
    favorites: [favorite('first', 'medium'), favorite('second', 'high')],
  })
  assert.equal(locked.cycle().resolve({ region: 'editable', modal: null, target: null }).status, 'blocked')
  assert.equal(locked.requests.length, 0)
})

await test('여러 입력창이 보이면 입력 위치의 피커를 대상으로 전환하고 대상이 없으면 통과한다', async (t) => {
  const h = await mount(t, { favorites: [favorite('first', 'medium'), favorite('second', 'high')] })
  const composer = h.document.createElement('div')
  const container = h.document.createElement('div')
  const editor = h.document.createElement('textarea')
  composer.append(editor, container)
  h.document.body.append(composer)
  const root = h.createRoot(container)
  await React.act(async () =>
    root.render(React.createElement(h.Picker(), { sessionId: 'other', useSession: (read) => read({}), locked: false }))
  )
  for (const anchor of h.document.querySelectorAll('.dsh-codex-picker'))
    anchor.getClientRects = () => [anchor.getBoundingClientRect()]
  assert.equal(h.cycle().resolve({ region: 'page', modal: null, target: h.document.body }).status, 'pass')
  await runCycle(h, { region: 'editable', modal: null, target: editor })
  const other = h.directoryFor('other')
  assert.deepEqual({ ...other.requests.at(-1).selection }, favorite('second', 'high'))
  assert.equal(h.requests.length, 0)
  await React.act(async () => root.unmount())
})

await test('기본 단축키가 충돌하면 기본값 없이 전환 명령을 등록하고 열기 명령을 유지한다', async (t) => {
  const h = await mount(t, { conflict: true })
  assert.deepEqual(Object.keys(h.cycle().defaults), [])
  assert.equal(h.cycle().resolve({ region: 'page', modal: null, target: null }).status, 'blocked')
  assert.equal(h.command().id, 'dungsil.model-picker.open')
})

await test('데스크톱 기본 전환 단축키는 Alt Shift P이고 웹 기본값은 없다', async (t) => {
  const desktop = await mount(t)
  assert.deepEqual(Object.keys(desktop.cycle().defaults).sort(), ['desktop:linux', 'desktop:macos', 'desktop:windows'])
  for (const binding of Object.values(desktop.cycle().defaults))
    assert.deepEqual([...binding.modifiers], ['alt', 'shift'])
  assert.equal(desktop.cycle().label(), '다음 즐겨찾기 모델로 전환')
})
