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
const worktreeField = 'select[id$="-worktree"]'
const failure = (code) => ({ ok: false, error: { code, message: code, details: {} } })
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
  const { createElement, act, StrictMode } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let client
  const require = createRequire(import.meta.url)
  window.__ModuleLoader__ = {
    load: ({ id, factory }) => {
      assert.equal(id, '@dungsil/dsh-plugin-ui-model-settings')
      client = factory((specifier) => {
        assert.ok(['react', 'react/jsx-runtime'].includes(specifier), `Unexpected host dependency: ${specifier}`)
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
        return intercept ? intercept(call, next) : next()
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
  const select = async (value, selector = 'select') => {
    await act(async () => {
      const element = container.querySelector(selector)
      assert.ok(element, `Missing field: ${selector}`)
      element.value = value
      element.dispatchEvent(new window.Event('change', { bubbles: true }))
    })
  }
  const setLocale = async (active) => {
    await act(async () => {
      locale = { active }
      for (const listener of listeners) listener()
    })
  }
  const ready = () => waitFor(() => container.querySelector('select') && !container.querySelector('select').disabled)
  const saved = () =>
    waitFor(() => container.textContent.includes('저장했습니다') && !container.querySelector('select').disabled)
  await mount()
  return {
    h,
    window,
    container,
    calls,
    waitFor,
    select,
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
    const { container, window, h, calls } = ui
    assert.equal(calls.length, 1, 'opening settings automatically reads the view')
    assert.equal(calls[0].endpoint, 'describe')
    assert.equal(container.querySelectorAll('select').length, worktree ? 2 : 1)
    assert.equal(container.textContent.includes('워크트리 브랜치 이름'), worktree)
    assert.equal(container.querySelector('button, form'), null)
    const selectElement = container.querySelector('select')
    assert.equal(window.document.getElementById(selectElement.getAttribute('aria-describedby')).tagName, 'SMALL')
    assert.equal(container.querySelector('label').htmlFor, selectElement.id)
    assert.equal(selectElement.value, '')
    await ui.select('')
    assert.equal(calls.length, 1, 'selecting the saved value must not write')
    await ui.select(pair)
    await ui.saved()
    assert.deepEqual((await h.rpc('describe')).value.target.route, { provider: 'auxiliary', model: 'title-small' })
    assert.equal(selectElement.value, pair)
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
      assert.equal(container.querySelector('select').value, otherPair, 'saving worktree preserves the title selection')
      await ui.select('', worktreeField)
      await ui.saved()
      assert.equal((await h.rpc('describe')).value.worktree.route, null)
    }
    await ui.setLocale('en')
    assert.equal(container.querySelector('label').textContent, 'Session title')
    assert.equal(ui.registration.label(), 'Models by task')
    assert.equal(container.textContent.includes('Changes are saved automatically.'), true)
    assert.equal(container.textContent.includes('Reload settings'), false)
    assert.equal(container.querySelector('button'), null)
  })
}

await test('saving locks both inputs immediately and never queues rapid changes', async (t) => {
  const gate = deferred()
  const ui = await settingsUI(t, { worktree: true })
  await ui.ready()
  ui.intercept((call, next) => (call.endpoint === 'save' ? gate.promise.then(next) : next()))
  await ui.select(pair)
  assert.equal(ui.container.textContent.includes('저장 중'), true)
  assert.equal(ui.container.querySelector('section').getAttribute('aria-busy'), 'true')
  assert.equal(
    [...ui.container.querySelectorAll('select')].every((element) => element.disabled),
    true
  )
  await ui.select(otherPair)
  await ui.select(pair, worktreeField)
  assert.equal(ui.calls.filter(({ endpoint }) => endpoint === 'save').length, 1)
  await ui.act(async () => {
    gate.resolve()
  })
  await ui.saved()
  const view = (await ui.h.rpc('describe')).value
  assert.deepEqual(view.target.route, { provider: 'auxiliary', model: 'title-small' })
  assert.equal(view.worktree.route, null)
  assert.equal(ui.container.querySelector('select').value, pair)
  assert.equal(ui.container.querySelector(worktreeField).value, '')
  assert.equal(ui.container.querySelector('section').getAttribute('aria-busy'), 'false')
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
  assert.equal(ui.container.querySelector('select').disabled, true)
  await ui.act(async () => {
    gate.resolve()
  })
  await ui.ready()
  assert.equal(ui.container.querySelector('select').value, otherPair)
  assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('다른 곳'), true)
  assert.equal(ui.container.textContent.includes('저장된 설정을 다시 불러왔습니다'), true)
  assert.equal(ui.container.textContent.includes('확인하는 중'), false)
  assert.deepEqual(
    ui.calls.map(({ endpoint }) => endpoint),
    ['describe', 'save', 'describe']
  )
  assert.deepEqual((await ui.h.rpc('describe')).value.target.route, latest.route)
  await ui.setLocale('en')
  assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('Settings changed elsewhere.'), true)
  assert.equal(ui.container.textContent.includes('Reload settings'), false)
  await ui.setLocale('ko')
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
    assert.equal(ui.container.querySelector('select').value, committed ? pair : '')
    assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('변경 여부'), true)
    assert.equal(ui.container.textContent.includes('저장했습니다'), false)
    assert.equal(ui.container.textContent.includes('새로고침'), false)
    assert.equal(ui.container.querySelector('button'), null)
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
    assert.equal(ui.container.querySelector('select').value, '')
    if (code === 'model_unavailable') assert.equal(ui.container.querySelector(`option[value='${pair}']`), null)
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
    assert.equal(ui.container.querySelector('select').disabled, true)
    assert.equal(ui.container.textContent.includes('다른 곳'), true)
    await ui.select(otherPair)
    assert.equal(ui.calls.length, 3, 'recovery failure cannot start a stale write or repeated read')
    ui.intercept(undefined)
    await ui.unmount()
    await ui.mount()
    await ui.ready()
    assert.equal(ui.container.querySelector('select').value, '')
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
  assert.equal(ui.container.querySelector('select').value, pair)
  assert.equal(ui.container.querySelector(`option[value='${pair}']`).disabled, true)
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
  assert.equal(ui.container.querySelectorAll('select').length, 1)
  assert.equal(ui.container.querySelector('select').id.endsWith('-worktree'), true)
  assert.equal(ui.container.querySelector('[role=alert]').textContent.includes('변경 여부'), true)
  assert.equal(ui.container.textContent.includes('지원하는 제목 생성기'), true)
  await ui.select(pair, worktreeField)
  await ui.saved()
  assert.deepEqual((await ui.h.rpc('describe')).value.worktree.route, { provider: 'auxiliary', model: 'title-small' })
  await ui.setLocale('en')
  assert.equal(ui.container.querySelector('label').textContent, 'Worktree branch name')
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
    assert.equal(ui.container.querySelector('select').value, '')
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
    assert.equal(ui.container.querySelector('select').value, '')
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
    assert.equal(ui.container.querySelector('select'), null)
    assert.equal(ui.container.textContent.includes('모델을 불러오는 중'), true)
    assert.equal(ui.container.querySelector('[role=alert]'), null)
    await ui.act(async () => {
      current.resolve()
    })
    await ui.ready()
    assert.equal(ui.container.querySelector('select').value, '')
    ui.intercept(undefined)
    await ui.select(pair)
    await ui.saved()
  })
}
