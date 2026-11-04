import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Window } from 'happy-dom'
import { profileFixture } from '../../model-settings/test/profile.mjs'

const pair = JSON.stringify(['auxiliary', 'title-small'])
const otherPair = JSON.stringify(['conversation', 'chat-large'])
const allFields = 'button[aria-haspopup="menu"]'
const modelFields = `${allFields}:not([id$="-reasoning"])`
const titleField = 'button[id$="-target"]'
const worktreeField = 'button[id$="-worktree"]'
const titleEffortField = 'button[id$="-target-reasoning"]'
const worktreeEffortField = 'button[id$="-worktree-reasoning"]'
const failure = (code) => ({ ok: false, error: { code, message: code, details: {} } })
await test('English, Korean and Chinese settings copies have complete, nonempty translation keys', async () => {
  const source = await readFile(new URL('../src/client.tsx', import.meta.url), 'utf8')
  const match = source.match(/const copy = (\{[\s\S]*?\n\})\n/)
  assert.ok(match, 'settings translations must be present')
  const translations = runInNewContext(`(${match[1]})`)
  assert.deepEqual(Object.keys(translations).sort(), ['en', 'ko', 'zh'])
  const keys = Object.keys(translations.en).sort()
  for (const language of ['en', 'ko', 'zh']) {
    assert.deepEqual(Object.keys(translations[language]).sort(), keys, `${language} translation keys`)
    for (const key of ['description', 'hint', 'worktreeHint', 'saved', 'resynced'])
      assert.equal(Object.hasOwn(translations[language], key), false, `${language}.${key} must be removed`)
    for (const key of keys) {
      assert.equal(typeof translations[language][key], 'string', `${language}.${key}`)
      assert.ok(translations[language][key].trim(), `${language}.${key} must not be empty`)
      if (language === 'zh')
        assert.match(translations[language][key], /\p{Script=Han}/u, `zh.${key} must be translated`)
    }
  }
})

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function settingsUI(t, { worktree = false, strict = false, rpc, initialRoute = {} } = {}) {
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
  const { createElement, cloneElement, act, StrictMode } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let client
  const require = createRequire(import.meta.url)
  const primitives = {
    IconChevronDownOutlineRegular: () => createElement('svg'),
    Menu: ({ anchor, open, items, selectedId, onSelect }) =>
      createElement(
        'div',
        {},
        cloneElement(anchor, { 'data-value': selectedId }),
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
  const h = await profileFixture('first-prompt', initialRoute, worktree ? {} : undefined)
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
  const calls = []
  let intercept = rpc
  ctx.provide('connection', {
    rpc: {
      call: (channel, method, payload, signal) => {
        assert.equal(channel, '/api')
        assert.equal(method.startsWith('dungsil-model-settings/'), true)
        const endpoint = method.replace('dungsil-model-settings/', '')
        const call = { endpoint, payload: structuredClone(payload), signal }
        calls.push(call)
        const next = () => h.rpc(endpoint, payload)
        return Promise.resolve(intercept ? intercept(call, next) : next()).then((result) => {
          call.result = result
          return result
        })
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
  const mount = async () => {
    await act(async () => {
      const component = createElement(Component, registration.inject())
      root.render(strict ? createElement(StrictMode, null, component) : component)
    })
  }
  const unmount = async () => {
    await act(async () => {
      root.render(null)
    })
  }
  const toggle = async (selector) => {
    await act(async () => {
      const element = container.querySelector(selector)
      assert.ok(element, `Missing field: ${selector}`)
      element.click()
    })
  }
  const menuItems = async (selector = titleField) => {
    await toggle(selector)
    const items = [...container.querySelectorAll('[role=menuitem]')].map((item) => ({
      value: item.dataset.value,
      label: item.textContent,
      disabled: item.disabled,
    }))
    await toggle(selector)
    return items
  }
  const select = async (value, selector = titleField) => {
    await toggle(selector)
    if (container.querySelector(selector).disabled) return
    await act(async () => {
      const item = [...container.querySelectorAll('[role=menuitem]')].find((item) => item.dataset.value === value)
      assert.ok(item, `Missing option: ${value}`)
      item.click()
    })
    assert.equal(container.querySelector('[role=menu]'), null, 'selection closes the picker')
  }
  const setLocale = async (active) => {
    await act(async () => {
      locale = { active }
      for (const listener of listeners) listener()
    })
  }
  const ready = () =>
    waitFor(() => container.querySelector(modelFields) && !container.querySelector(modelFields).disabled)
  const saved = async () => {
    await waitFor(
      () =>
        calls.findLast(({ endpoint }) => endpoint === 'save')?.result?.ok === true &&
        container.querySelector('section').getAttribute('aria-busy') === 'false' &&
        !container.querySelector(modelFields).disabled
    )
    assert.equal(
      container.querySelector('.dsh-model-settings-field [role=alert]'),
      null,
      'a confirmed save clears row errors'
    )
    assert.equal(
      container.querySelector('.dsh-model-settings-field [role=status]'),
      null,
      'a confirmed save needs no row success notice'
    )
  }
  await mount()
  return {
    h,
    window,
    container,
    calls,
    waitFor,
    select,
    menuItems,
    setLocale,
    ready,
    saved,
    mount,
    unmount,
    act,
    intercept: (handler) => {
      intercept = handler
    },
    registration,
  }
}

for (const worktree of [false, true]) {
  await test(`selection saves immediately and resets inheritance with worktree ${worktree ? 'enabled' : 'absent'}`, async (t) => {
    const ui = await settingsUI(t, { worktree })
    await ui.ready()
    const { container, h, calls } = ui
    assert.equal(calls.length, 1, 'opening settings automatically reads the view')
    assert.equal(calls[0].endpoint, 'describe')
    assert.equal(container.querySelectorAll(modelFields).length, worktree ? 2 : 1)
    assert.equal(container.textContent.includes('워크트리 브랜치 이름'), worktree)
    assert.equal(container.querySelector('form, footer, button[type=submit]'), null)
    const selectElement = container.querySelector(modelFields)
    assert.equal(container.querySelector('[aria-describedby]'), null, 'removed helpers leave no ARIA references')
    assert.equal(container.querySelector('p'), null, 'loaded settings show labels without explanatory prose')
    assert.ok(selectElement.getAttribute('aria-label').startsWith('세션 제목 모델:'))
    assert.equal(selectElement.dataset.value, '')
    await ui.select('')
    assert.equal(calls.length, 1, 'selecting the saved value must not write')
    await ui.select(pair)
    await ui.saved()
    assert.deepEqual((await h.rpc('describe')).value.target.route, { provider: 'auxiliary', model: 'title-small' })
    assert.equal(selectElement.dataset.value, pair)
    assert.equal(calls.filter(({ endpoint }) => endpoint === 'save').length, 1)
    await ui.select('')
    await ui.saved()
    assert.equal((await h.rpc('describe')).value.target.route, null)
    if (worktree) {
      await ui.select(otherPair)
      await ui.saved()
      await ui.select(pair, worktreeField)
      await ui.saved()
      const view = (await h.rpc('describe')).value
      assert.deepEqual(view.worktree.route, { provider: 'auxiliary', model: 'title-small' })
      assert.deepEqual(view.target.route, { provider: 'conversation', model: 'chat-large' })
      assert.equal(
        container.querySelector(modelFields).dataset.value,
        otherPair,
        'saving worktree preserves the title selection'
      )
      await ui.select('', worktreeField)
      await ui.saved()
      assert.equal((await h.rpc('describe')).value.worktree.route, null)
    }
    await ui.setLocale('en')
    assert.ok(container.querySelector(modelFields).getAttribute('aria-label').startsWith('Session title Model:'))
    assert.equal(ui.registration.label(), 'Models by task')
    assert.equal(container.querySelector('p'), null, 'successful saves do not add introductory or success copy')
    assert.equal(container.textContent.includes('Reload settings'), false)
    assert.equal(container.querySelector('footer, button[type=submit]'), null)
  })
}

await test('model and reasoning pickers react to English, Korean and Chinese locale changes', async (t) => {
  const ui = await settingsUI(t, { worktree: true })
  await ui.ready()
  await ui.select(pair)
  await ui.saved()
  for (const [language, nav, title, effort, automatic] of [
    [
      'en',
      'Models by task',
      'Session title Model:',
      'Session title Reasoning effort:',
      'Automatic (lowest supported effort)',
    ],
    ['ko', '상황별 모델', '세션 제목 모델:', '세션 제목 추론 수준:', '자동 (지원하는 최저 수준)'],
    ['zh-CN', '任务模型设置', '会话标题 模型:', '会话标题 推理级别:', '自动（支持的最低级别）'],
  ]) {
    await ui.setLocale(language)
    assert.equal(ui.registration.label(), nav)
    assert.ok(ui.container.querySelector(titleField).getAttribute('aria-label').startsWith(title))
    assert.ok(ui.container.querySelector(titleEffortField).getAttribute('aria-label').startsWith(effort))
    assert.equal((await ui.menuItems(titleEffortField))[0].label, automatic)
    assert.equal(ui.container.querySelector('p'), null, `${language} has no introductory, helper or success prose`)
    assert.equal(ui.container.querySelector('[aria-describedby]'), null, `${language} has no dangling descriptions`)
  }
})

await test('an unavailable saved effort stays visible and can be reset to Automatic', async (t) => {
  const ui = await settingsUI(t, {
    initialRoute: { provider: 'auxiliary', model: 'title-small' },
    rpc: async (call, next) => {
      const result = await next()
      return call.endpoint === 'describe'
        ? { ...result, value: { ...result.value, target: { ...result.value.target, reasoningEffort: 'retired' } } }
        : result
    },
  })
  await ui.ready()
  const effort = ui.container.querySelector(titleEffortField)
  assert.equal(effort.dataset.value, 'retired')
  assert.equal(effort.disabled, false)
  assert.ok(effort.textContent.includes('저장된 추론 수준'))
  assert.equal((await ui.menuItems(titleEffortField)).find((item) => item.value === 'retired').disabled, true)
  assert.equal(ui.calls.length, 1, 'reading an unavailable effort must not overwrite it')
  await ui.select('', titleEffortField)
  await ui.saved()
  const target = (await ui.h.rpc('describe')).value.target
  assert.deepEqual(target.route, { provider: 'auxiliary', model: 'title-small' })
  assert.equal(target.reasoningEffort, null)
})

for (const task of ['target', 'worktree']) {
  await test(`${task} reasoning effort saves immediately, survives remount and clears on model changes`, async (t) => {
    const ui = await settingsUI(t, { worktree: task === 'worktree' })
    await ui.ready()
    const field = task === 'target' ? titleField : worktreeField
    const effortField = task === 'target' ? titleEffortField : worktreeEffortField
    const effort = () => ui.container.querySelector(effortField)
    const writes = () => ui.calls.filter(({ endpoint }) => endpoint === 'save')
    const snapshot = async () => (await ui.h.rpc('describe')).value[task]
    const models = (await ui.h.rpc('describe')).value.providers.find((provider) => provider.id === 'auxiliary').models
    assert.deepEqual(models.find((model) => model.id === 'title-small').efforts, [
      { id: 'quick', name: 'Quick' },
      { id: 'thorough', name: 'Thorough' },
    ])
    assert.deepEqual(models.find((model) => model.id === 'chat-large').efforts, [])
    assert.ok(effort())
    assert.equal(effort().disabled, true, 'inheriting the conversation model cannot set an explicit effort')
    assert.equal(
      effort().getAttribute('title'),
      '모델을 지정하면 추론 수준을 선택할 수 있습니다. 자동은 기존 동작을 유지합니다.',
      'the disabled effort picker retains its availability explanation'
    )
    assert.equal(writes().length, 0)
    await ui.select(pair, field)
    await ui.saved()
    assert.equal(effort().disabled, false)
    assert.equal(effort().dataset.value, '')
    const items = await ui.menuItems(effortField)
    assert.deepEqual(
      items.map((item) => item.value),
      ['', 'quick', 'thorough']
    )
    assert.equal(items[0].label, task === 'target' ? '자동 (지원하는 최저 수준)' : '자동 (모델 기본값)')
    assert.ok(effort().getAttribute('aria-label').includes('추론 수준:'), 'reasoning picker has an accessible name')
    assert.equal(writes().length, 1)
    await ui.select('thorough', effortField)
    await ui.saved()
    assert.equal(writes().length, 2, 'an effort-only change writes without a submit button')
    assert.deepEqual(writes().at(-1).payload.route, { provider: 'auxiliary', model: 'title-small' })
    assert.equal(writes().at(-1).payload.reasoningEffort, 'thorough')
    assert.equal((await snapshot()).reasoningEffort, 'thorough')
    assert.equal(effort().dataset.value, 'thorough')
    assert.equal(ui.container.querySelector('form, footer, button[type=submit]'), null)
    await ui.select(ui.container.querySelector(field).dataset.value, field)
    await ui.select('thorough', effortField)
    assert.equal(effort().dataset.value, 'thorough', 'reselecting the same model preserves its effort')
    assert.equal(writes().length, 2, 'reselecting either saved value must not write')
    await ui.unmount()
    await ui.mount()
    await ui.ready()
    assert.equal(effort().dataset.value, 'thorough', 'a fresh read restores the saved effort')
    await ui.select('', effortField)
    await ui.saved()
    assert.equal((await snapshot()).reasoningEffort, null)
    assert.equal(ui.container.querySelector(field).dataset.value, pair, 'Automatic keeps the existing model pair key')
    assert.equal(writes().length, 3, 'clearing only the effort also saves immediately')
    await ui.select('thorough', effortField)
    await ui.saved()
    await ui.select(JSON.stringify(['conversation', 'title-small']), field)
    await ui.saved()
    assert.equal((await snapshot()).reasoningEffort, null, 'changing provider also clears the previous effort')
    assert.equal(effort().dataset.value, '')
    assert.equal(effort().disabled, false, 'the new model still supports reasoning')
    await ui.select('thorough', effortField)
    await ui.saved()
    await ui.select(otherPair, field)
    await ui.saved()
    assert.equal((await snapshot()).reasoningEffort, null)
    assert.equal(writes().at(-1).payload.reasoningEffort, null)
    assert.equal(effort().dataset.value, '')
    assert.equal(effort().disabled, true, 'models without reasoning support cannot choose an effort')
    assert.equal(effort().getAttribute('title'), '이 모델은 추론 수준 설정을 제공하지 않습니다.')
    await ui.select(pair, field)
    await ui.saved()
    await ui.select('quick', effortField)
    await ui.saved()
    await ui.select('', field)
    await ui.saved()
    assert.equal((await snapshot()).route, null)
    assert.equal((await snapshot()).reasoningEffort, null)
    assert.equal(writes().at(-1).payload.route, null)
    assert.equal(writes().at(-1).payload.reasoningEffort, null)
    assert.equal(effort().dataset.value, '')
    assert.equal(effort().disabled, true)
  })
}

await test('title and worktree effort changes preserve each other’s saved model and effort', async (t) => {
  const ui = await settingsUI(t, { worktree: true })
  await ui.ready()
  const titlePair = JSON.stringify(['conversation', 'title-small'])
  await ui.select(titlePair)
  await ui.saved()
  await ui.select('thorough', titleEffortField)
  await ui.saved()
  await ui.select(pair, worktreeField)
  await ui.saved()
  await ui.select('quick', worktreeEffortField)
  await ui.saved()
  let view = (await ui.h.rpc('describe')).value
  assert.deepEqual(view.target.route, { provider: 'conversation', model: 'title-small' })
  assert.equal(view.target.reasoningEffort, 'thorough')
  assert.deepEqual(view.worktree.route, { provider: 'auxiliary', model: 'title-small' })
  assert.equal(view.worktree.reasoningEffort, 'quick')
  assert.equal(ui.container.querySelector(titleEffortField).dataset.value, 'thorough')
  await ui.select('quick', titleEffortField)
  await ui.saved()
  assert.equal(ui.container.querySelector(worktreeEffortField).dataset.value, 'quick')
  await ui.select('thorough', worktreeEffortField)
  await ui.saved()
  view = (await ui.h.rpc('describe')).value
  assert.equal(view.target.reasoningEffort, 'quick')
  assert.equal(view.worktree.reasoningEffort, 'thorough')
  await ui.select('', worktreeField)
  await ui.saved()
  view = (await ui.h.rpc('describe')).value
  assert.equal(view.worktree.route, null)
  assert.equal(view.worktree.reasoningEffort, null)
  assert.equal(view.target.reasoningEffort, 'quick')
  assert.equal(ui.container.querySelector(titleEffortField).dataset.value, 'quick')
})

await test('saving locks every model and reasoning input immediately and never queues rapid changes', async (t) => {
  const gate = deferred()
  const ui = await settingsUI(t, { worktree: true })
  await ui.ready()
  ui.intercept((call, next) => (call.endpoint === 'save' ? gate.promise.then(next) : next()))
  await ui.select(pair)
  assert.equal(ui.container.textContent.includes('저장 중'), true)
  assert.equal(ui.container.querySelector('section').getAttribute('aria-busy'), 'true')
  assert.equal(
    [...ui.container.querySelectorAll(allFields)].every((element) => element.disabled),
    true
  )
  await ui.select(otherPair)
  await ui.select(pair, worktreeField)
  await ui.select('thorough', titleEffortField)
  await ui.select('quick', worktreeEffortField)
  assert.equal(ui.calls.filter(({ endpoint }) => endpoint === 'save').length, 1)
  await ui.act(async () => {
    gate.resolve()
  })
  await ui.saved()
  const view = (await ui.h.rpc('describe')).value
  assert.deepEqual(view.target.route, { provider: 'auxiliary', model: 'title-small' })
  assert.equal(view.worktree.route, null)
  assert.equal(ui.container.querySelector(modelFields).dataset.value, pair)
  assert.equal(ui.container.querySelector(worktreeField).dataset.value, '')
  assert.equal(view.target.reasoningEffort, null)
  assert.equal(view.worktree.reasoningEffort, null)
  assert.equal(ui.container.querySelector(titleEffortField).dataset.value, '')
  assert.equal(ui.container.querySelector(worktreeEffortField).dataset.value, '')
  assert.equal(ui.container.querySelector('section').getAttribute('aria-busy'), 'false')
})

await test('an effort-only save locks every input and ignores changes until its response arrives', async (t) => {
  const ui = await settingsUI(t, { worktree: true })
  await ui.ready()
  await ui.select(pair)
  await ui.saved()
  await ui.select(pair, worktreeField)
  await ui.saved()
  const gate = deferred()
  ui.intercept((call, next) => (call.endpoint === 'save' ? gate.promise.then(next) : next()))
  await ui.select('thorough', titleEffortField)
  assert.equal(ui.container.querySelectorAll(allFields).length, 4)
  assert.equal(
    [...ui.container.querySelectorAll(allFields)].every((element) => element.disabled),
    true
  )
  await ui.select('quick', titleEffortField)
  await ui.select('quick', worktreeEffortField)
  await ui.select(otherPair, worktreeField)
  assert.equal(ui.calls.filter(({ endpoint }) => endpoint === 'save').length, 3)
  await ui.act(async () => {
    gate.resolve()
  })
  await ui.saved()
  const view = (await ui.h.rpc('describe')).value
  assert.equal(view.target.reasoningEffort, 'thorough')
  assert.equal(view.worktree.reasoningEffort, null)
  assert.deepEqual(view.worktree.route, { provider: 'auxiliary', model: 'title-small' })
  assert.equal(ui.container.querySelector(titleEffortField).dataset.value, 'thorough')
  assert.equal(ui.container.querySelector(worktreeEffortField).dataset.value, '')
})

await test('an effort conflict automatically restores the latest effort without retrying the write', async (t) => {
  const ui = await settingsUI(t, { initialRoute: { provider: 'auxiliary', model: 'title-small' } })
  await ui.ready()
  const target = (await ui.h.rpc('describe')).value.target
  const result = await ui.h.rpc('save', { ...target, reasoningEffort: 'thorough' })
  assert.equal(result.ok, true)
  const latest = result.value
  await ui.select('quick', titleEffortField)
  await ui.ready()
  assert.deepEqual(
    ui.calls.map(({ endpoint }) => endpoint),
    ['describe', 'save', 'describe']
  )
  assert.equal(ui.container.querySelector(titleEffortField).dataset.value, 'thorough')
  assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('다른 곳'), true)
  assert.equal((await ui.h.rpc('describe')).value.target.reasoningEffort, 'thorough')
  await ui.select('', titleEffortField)
  await ui.saved()
  assert.equal(ui.calls[3].payload.revision, latest.revision)
  assert.equal(ui.calls[3].payload.reasoningEffort, null)
  assert.equal((await ui.h.rpc('describe')).value.target.reasoningEffort, null)
})

await test('an unavailable effort remains visible after automatic catalog recovery without retrying', async (t) => {
  const ui = await settingsUI(t, { initialRoute: { provider: 'auxiliary', model: 'title-small' } })
  await ui.ready()
  ui.intercept(async (call, next) => {
    if (call.endpoint === 'save') return failure('reasoning_unavailable')
    const result = await next()
    return {
      ...result,
      value: {
        ...result.value,
        providers: result.value.providers.map((provider) => ({
          ...provider,
          models: provider.models.map((model) => ({
            ...model,
            efforts: model.efforts.filter((effort) => effort.id !== 'thorough'),
          })),
        })),
      },
    }
  })
  await ui.select('thorough', titleEffortField)
  await ui.ready()
  assert.deepEqual(
    ui.calls.map(({ endpoint }) => endpoint),
    ['describe', 'save', 'describe']
  )
  assert.equal(ui.container.querySelector(titleEffortField).dataset.value, '')
  assert.equal(
    (await ui.menuItems(titleEffortField)).some((item) => item.value === 'thorough'),
    false
  )
  assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('사용할 수 없는 추론 수준'), true)
  assert.equal((await ui.h.rpc('describe')).value.target.reasoningEffort, null)
  ui.intercept(undefined)
  await ui.select('quick', titleEffortField)
  await ui.saved()
  assert.equal(ui.calls.length, 4, 'only a subsequent user change may write again')
  assert.equal((await ui.h.rpc('describe')).value.target.reasoningEffort, 'quick')
})

await test('a conflict automatically reads the latest values without retrying the write', async (t) => {
  const ui = await settingsUI(t, { worktree: true })
  await ui.ready()
  const target = (await ui.h.rpc('describe')).value.target
  await ui.h.rpc('save', { ...target, route: { provider: 'conversation', model: 'chat-large' } })
  const latest = (await ui.h.rpc('describe')).value.target
  const gate = deferred()
  ui.intercept((call, next) => (call.endpoint === 'describe' ? gate.promise.then(next) : next()))
  await ui.select(pair)
  await ui.waitFor(() => ui.calls.length === 3)
  assert.equal(ui.container.textContent.includes('다른 곳'), true)
  assert.equal(ui.container.textContent.includes('저장된 설정을 확인하는 중'), true)
  assert.equal(ui.container.querySelector(modelFields).disabled, true)
  await ui.act(async () => {
    gate.resolve()
  })
  await ui.ready()
  assert.equal(ui.container.querySelector(modelFields).dataset.value, otherPair)
  assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('다른 곳'), true)
  assert.equal(ui.container.querySelector('[role=status]'), null, 'completed recovery adds no resynced notice')
  assert.equal(ui.container.textContent.includes('확인하는 중'), false)
  assert.deepEqual(
    ui.calls.map(({ endpoint }) => endpoint),
    ['describe', 'save', 'describe']
  )
  assert.deepEqual((await ui.h.rpc('describe')).value.target.route, latest.route)
  for (const [language, conflict] of [
    ['en', 'Settings changed elsewhere.'],
    ['zh-CN', '设置已在其他位置更改。'],
    ['ko', '다른 곳에서 설정을 변경했습니다.'],
  ]) {
    await ui.setLocale(language)
    assert.equal(ui.container.querySelector('[role=alert]').textContent.includes(conflict), true)
    assert.equal(ui.container.querySelector('[role=status]'), null, `${language} has no resynced success notice`)
    assert.equal(ui.container.querySelector('[aria-describedby]'), null)
  }
  assert.equal(ui.container.textContent.includes('Reload settings'), false)
  await ui.select('')
  await ui.saved()
  assert.equal(ui.calls[3].payload.revision, latest.revision, 'the next user change uses the synchronized revision')
  assert.equal((await ui.h.rpc('describe')).value.target.route, null)
})

for (const committed of [false, true]) {
  await test(`a lost write response resynchronizes ${committed ? 'committed' : 'unchanged'} values with an explicit error`, async (t) => {
    const ui = await settingsUI(t)
    await ui.ready()
    ui.intercept(async (call, next) => {
      if (call.endpoint !== 'save') return next()
      if (committed) await next()
      throw new Error('Disconnected')
    })
    await ui.select(pair)
    await ui.ready()
    assert.deepEqual(
      ui.calls.map(({ endpoint }) => endpoint),
      ['describe', 'save', 'describe']
    )
    assert.equal(ui.container.querySelector(modelFields).dataset.value, committed ? pair : '')
    assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('변경 여부'), true)
    assert.equal(ui.container.textContent.includes('저장했습니다'), false)
    assert.equal(ui.container.textContent.includes('새로고침'), false)
    assert.equal(ui.container.querySelector('footer, button[type=submit]'), null)
    ui.intercept(undefined)
    await ui.select(committed ? '' : pair)
    await ui.saved()
    assert.equal(ui.calls.length, 4, 'only the next explicit user change writes again')
  })
}

for (const code of ['model_unavailable', 'save_failed']) {
  await test(`${code} is visible after automatic read recovery`, async (t) => {
    const ui = await settingsUI(t)
    await ui.ready()
    ui.intercept(async (call, next) => {
      if (call.endpoint === 'save') return failure(code)
      const result = await next()
      if (code !== 'model_unavailable') return result
      return {
        ...result,
        value: {
          ...result.value,
          providers: result.value.providers.map((provider) => ({
            ...provider,
            models: provider.id === 'auxiliary' ? [] : provider.models,
          })),
        },
      }
    })
    await ui.select(pair)
    await ui.ready()
    assert.equal(ui.container.querySelector(modelFields).dataset.value, '')
    if (code === 'model_unavailable')
      assert.equal(
        (await ui.menuItems()).some((item) => item.value === pair),
        false
      )
    assert.equal(
      ui.container
        .querySelector('[role=alert]')
        .textContent.includes(code === 'model_unavailable' ? '사용할 수 없는 모델' : '변경 여부'),
      true
    )
    assert.deepEqual(
      ui.calls.map(({ endpoint }) => endpoint),
      ['describe', 'save', 'describe']
    )
  })
}

for (const throws of [false, true]) {
  await test(`recovery read ${throws ? 'transport failure' : 'RPC failure'} keeps the original error and disables stale writes`, async (t) => {
    const ui = await settingsUI(t)
    await ui.ready()
    ui.intercept(async (call) => {
      if (call.endpoint === 'save') return failure('conflict')
      if (throws) throw new Error('Disconnected')
      return failure('read_failed')
    })
    await ui.select(pair)
    await ui.waitFor(() => ui.container.textContent.includes('변경을 잠갔습니다'))
    assert.equal(ui.container.querySelector(modelFields).disabled, true)
    assert.equal(ui.container.textContent.includes('다른 곳'), true)
    await ui.select(otherPair)
    assert.equal(ui.calls.length, 3, 'recovery failure cannot start a stale write or repeated read')
    ui.intercept(undefined)
    await ui.unmount()
    await ui.mount()
    await ui.ready()
    assert.equal(ui.container.querySelector(modelFields).dataset.value, '')
    assert.equal(ui.container.querySelector('[role=alert]'), null)
    assert.equal(ui.calls[3].signal.aborted, false)
  })
}

for (const throws of [false, true]) {
  await test(`initial read ${throws ? 'transport failure' : 'RPC failure'} shows a recoverable error without buttons`, async (t) => {
    const ui = await settingsUI(t, {
      rpc: () => (throws ? Promise.reject(new Error('Disconnected')) : Promise.resolve(failure('read_failed'))),
    })
    await ui.waitFor(() => ui.container.querySelector('[role=alert]'))
    assert.equal(ui.container.textContent.includes('설정을 불러오지 못했습니다'), true)
    assert.equal(ui.container.querySelector('select, button'), null)
    assert.equal(ui.calls.length, 1)
    await ui.setLocale('en')
    assert.equal(ui.container.textContent.includes('Could not load settings.'), true)
    ui.intercept(undefined)
    await ui.unmount()
    await ui.mount()
    await ui.ready()
    assert.equal(ui.calls[0].signal.aborted, true)
    assert.equal(ui.calls[1].signal.aborted, false)
  })
}

await test('missing saved models and partial catalogs still allow immediate inheritance changes', async (t) => {
  const ui = await settingsUI(t, {
    initialRoute: { provider: 'auxiliary', model: 'title-small' },
    rpc: async (call, next) => {
      const result = await next()
      return call.endpoint === 'describe'
        ? { ...result, value: { ...result.value, providers: [], catalogError: true } }
        : result
    },
  })
  await ui.ready()
  assert.equal(ui.container.querySelector(modelFields).dataset.value, pair)
  assert.equal((await ui.menuItems()).find((item) => item.value === pair).disabled, true)
  assert.equal(ui.container.textContent.includes('현재 목록에 없음'), true)
  assert.equal(ui.container.textContent.includes('일부 모델 목록'), true)
  assert.equal(ui.container.textContent.includes('새로고침'), false)
  await ui.setLocale('en')
  assert.equal(ui.container.textContent.includes('reload settings'), false)
  await ui.setLocale('ko')
  await ui.select('')
  await ui.saved()
  assert.equal((await ui.h.rpc('describe')).value.target.route, null)
})

await test('a removed title target leaves its error visible and the worktree setting usable', async (t) => {
  const ui = await settingsUI(t, { worktree: true })
  await ui.ready()
  const titleEntry = ui.h.ctx.configEditor.entries().find((entry) => entry.options.id === 'custom-title-entry')
  await titleEntry.fiber.dispose()
  await ui.select(pair)
  await ui.ready()
  assert.equal(ui.container.querySelectorAll(modelFields).length, 1)
  assert.equal(ui.container.querySelector(modelFields).id.endsWith('-worktree'), true)
  assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('변경 여부'), true)
  assert.equal(ui.container.textContent.includes('지원하는 제목 생성기'), true)
  await ui.select(pair, worktreeField)
  await ui.saved()
  assert.deepEqual((await ui.h.rpc('describe')).value.worktree.route, { provider: 'auxiliary', model: 'title-small' })
  await ui.setLocale('en')
  assert.ok(
    ui.container.querySelector(modelFields).getAttribute('aria-label').startsWith('Worktree branch name Model:')
  )
})

for (const rejects of [false, true]) {
  await test(`StrictMode restarts initial effects and ignores the aborted read's late ${rejects ? 'failure' : 'success'}`, async (t) => {
    const stale = deferred()
    let reads = 0
    const ui = await settingsUI(t, { strict: true, rpc: (_call, next) => (++reads === 1 ? stale.promise : next()) })
    await ui.ready()
    assert.equal(ui.calls.length, 2)
    assert.equal(ui.calls[0].signal.aborted, true)
    assert.equal(ui.calls[1].signal.aborted, false)
    await ui.act(async () => {
      if (rejects) stale.reject(new Error('Aborted'))
      else {
        const result = await ui.h.rpc('describe')
        stale.resolve({
          ...result,
          value: {
            ...result.value,
            target: { ...result.value.target, route: { provider: 'conversation', model: 'chat-large' } },
          },
        })
      }
    })
    assert.equal(ui.container.querySelector(modelFields).dataset.value, '')
    assert.equal(ui.container.querySelector('[role=alert]'), null)
    await ui.select(pair)
    await ui.saved()
    assert.equal(ui.calls.filter(({ endpoint }) => endpoint === 'save').length, 1)
  })
}

for (const rejects of [false, true]) {
  await test(`unmount aborts recovery and ignores its late ${rejects ? 'failure' : 'success'}`, async (t) => {
    const stale = deferred()
    const ui = await settingsUI(t)
    await ui.ready()
    const view = await ui.h.rpc('describe')
    ui.intercept((call) => (call.endpoint === 'save' ? Promise.resolve(failure('conflict')) : stale.promise))
    await ui.select(pair)
    await ui.waitFor(() => ui.calls.length === 3)
    await ui.unmount()
    assert.equal(ui.calls[2].signal.aborted, true)
    ui.intercept(undefined)
    await ui.mount()
    await ui.ready()
    await ui.act(async () => {
      if (rejects) stale.reject(new Error('Disconnected'))
      else
        stale.resolve({
          ...view,
          value: {
            ...view.value,
            target: { ...view.value.target, route: { provider: 'auxiliary', model: 'title-small' } },
          },
        })
    })
    assert.equal(ui.container.querySelector(modelFields).dataset.value, '')
    assert.equal(ui.container.querySelector('[role=alert]'), null)
    assert.equal(ui.calls.length, 4)
    await ui.select(pair)
    await ui.saved()
  })
}

for (const outcome of ['success', 'failure', 'rejection']) {
  await test(`unmount aborts a pending write and its late ${outcome} cannot affect the replacement mount`, async (t) => {
    const stale = deferred()
    const current = deferred()
    const ui = await settingsUI(t)
    await ui.ready()
    const oldView = await ui.h.rpc('describe')
    ui.intercept(() => stale.promise)
    await ui.select(pair)
    const write = ui.calls[1]
    await ui.unmount()
    assert.equal(write.signal.aborted, true)
    ui.intercept((_call, next) => current.promise.then(next))
    await ui.mount()
    assert.equal(ui.calls[2].signal.aborted, false)
    await ui.act(async () => {
      if (outcome === 'rejection') stale.reject(new Error('Disconnected'))
      else
        stale.resolve(
          outcome === 'failure'
            ? failure('conflict')
            : { ok: true, value: { ...oldView.value.target, route: { provider: 'auxiliary', model: 'title-small' } } }
        )
    })
    assert.equal(ui.calls.length, 3, 'an unmounted write never triggers recovery or another write')
    assert.equal(ui.container.querySelector(modelFields), null)
    assert.equal(ui.container.textContent.includes('모델을 불러오는 중'), true)
    assert.equal(ui.container.querySelector('[role=alert]'), null)
    await ui.act(async () => {
      current.resolve()
    })
    await ui.ready()
    assert.equal(ui.container.querySelector(modelFields).dataset.value, '')
    ui.intercept(undefined)
    await ui.select(pair)
    await ui.saved()
  })
}
