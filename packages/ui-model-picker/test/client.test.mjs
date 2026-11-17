import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

async function mount(
  t,
  { language = 'ko', locked = false, runtime = 'desktop', favorites, conflict = false, sessionId = 'test' } = {}
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
        Picker = render
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

await test('단축키는 피커를 열고 다시 실행해도 닫지 않으며 Escape는 트리거로 포커스를 돌린다', async (t) => {
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
  assert.ok(h.slider())
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

const favorite = (model, reasoningEffort) => ({ provider: 'provider', model, reasoningEffort })
const runCycle = (h, context) =>
  React.act(async () => {
    const resolution = h.cycle().resolve(context ?? { region: 'editable', modal: null, target: null })
    assert.equal(resolution.status, 'handled')
    resolution.run()
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
