import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

async function createHarness(t, { slot = 'main', language = 'ko' } = {}) {
  const window = new Window()
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = window.document.createElement('div')
  window.document.body.append(container)
  // Initialize React DOM after the document exists so native input events reach onChange.
  const { createRoot } = await import('react-dom/client')
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
  let plugin, Page, props
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    document: window.document,
    MutationObserver: window.MutationObserver,
    AbortController,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id !== '@deepseek-ai/dsh-client-ui-primitives') return require(id)
            return {
              Button: ({ children, variant: _variant, icon: _icon, ...rest }) =>
                React.createElement('button', rest, children),
              Input: (rest) => React.createElement('input', rest),
              SegmentedControl: () => null,
              Tag: ({ children }) => React.createElement('span', {}, children),
              IconChevronDownOutlineRegular: () => null,
              IconRefreshOutlineRegular: () => null,
              IconSearchOutlineRegular: () => null,
            }
          })
        },
      },
    },
  })
  const listeners = new Set()
  const events = new Map()
  const requests = []
  const rpcCalls = []
  const pending = []
  const connection = {
    generation: {
      getSnapshot: () => ({ id: 1 }),
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    rpc: {
      call: (_channel, method, payload) => {
        requests.push(method.split('/').at(-1))
        rpcCalls.push({ method: method.split('/').at(-1), payload: { ...payload } })
        return new Promise((resolve) => pending.push(resolve))
      },
    },
  }
  const snapshot = { active: language }
  const ctx = {
    get: () => connection,
    emit: (event) => events.get(event)?.forEach((listener) => listener()),
    locale: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    effect: (setup) => setup(),
    on: (event, listener) => {
      const set = events.get(event) ?? new Set()
      events.set(event, set)
      set.add(listener)
      return () => set.delete(listener)
    },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, render) => {
        if (options.name === slot) {
          Page = render
          props = options.inject()
        }
      },
    },
  }
  plugin.apply(ctx)
  const mount = () => React.act(() => root.render(React.createElement(Page, props)))
  const leave = () => React.act(() => root.render(null))
  const respond = (result) =>
    React.act(async () => {
      assert.ok(pending.length, '응답할 RPC 요청이 있어야 한다')
      pending.shift()(result)
    })
  const reply = (value) => respond({ ok: true, value })
  const change = (input, value) =>
    React.act(async () => {
      input.focus()
      // Bypass React's value tracker just as a real browser edit does.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  const blur = (input) => React.act(async () => input.blur())
  const enter = (input) =>
    React.act(async () => {
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  return { window, container, requests, rpcCalls, listeners, mount, leave, reply, respond, change, blur, enter }
}

const view = { baseURL: 'http://localhost:8317', revision: '1', apiKeySaved: true, managementKeySaved: true }

await test('CPA는 시간이 지나도 재진입 시 요청과 로딩 없이 캐시를 표시하고 새로고침과 연결 변경 때 다시 조회한다', async (t) => {
  const { container, requests, listeners, mount, leave, reply } = await createHarness(t)
  const account = {
    name: 'cached-account',
    provider: 'codex',
    status: 'ready',
    disabled: false,
    authIndex: 'auth-1',
    editable: true,
    supported: true,
  }
  const quota = (usedPercent) => ({
    windows: [{ id: 'primary_window', usedPercent }],
    observedAt: '2026-11-05T00:00:00Z',
  })
  await mount()
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), 'true')
  await reply(view)
  await reply([account])
  await reply(quota(27))
  assert.ok(container.textContent.includes('27%'))
  const initialRequests = [...requests]
  assert.equal(initialRequests.length, 3)
  await leave()
  t.mock.method(Date, 'now', () => Date.parse('2027-01-01T00:00:00Z'))
  await mount()
  assert.deepEqual(requests, initialRequests)
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), 'false')
  assert.ok(container.textContent.includes('cached-account'))
  assert.ok(container.textContent.includes('27%'))
  const refresh = [...container.querySelectorAll('button')].find((button) => button.textContent.includes('새로고침'))
  assert.ok(refresh)
  await React.act(async () => refresh.click())
  assert.equal(requests.length, 4)
  await reply([account])
  await reply(quota(63))
  assert.ok(container.textContent.includes('63%'))
  await leave()
  await mount()
  assert.equal(requests.length, 5)
  assert.ok(container.textContent.includes('63%'))
  await leave()
  await React.act(async () => listeners.forEach((listener) => listener()))
  await mount()
  assert.equal(requests.length, 6)
  assert.equal(container.textContent.includes('cached-account'), false)
  await reply({ ...view, revision: '2' })
  await reply([])
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), 'false')
  await leave()
  await mount()
  assert.equal(requests.length, 7, 'empty account lists are cached too')
})

function settingsInputs(container) {
  return [...container.querySelectorAll('input')]
}

function assertBusy(container, busy) {
  assert.equal(container.querySelector('section').getAttribute('aria-busy'), String(busy))
  for (const control of container.querySelectorAll('input, button')) assert.equal(control.disabled, busy)
}

for (const [language, saveLabel, successLabel] of [
  ['en', 'Save connection', 'Connection saved and checked.'],
  ['ko', '연결 저장', '연결을 저장하고 확인했습니다.'],
  ['zh', '保存连接', '连接已保存并确认。'],
]) {
  await test(`${language} 설정은 초기 렌더에서 저장하지 않고 URL을 blur하면 키를 초기화하며 저장 버튼과 성공 알림을 표시하지 않는다`, async (t) => {
    const h = await createHarness(t, { slot: 'settings.section', language })
    await h.mount()
    assert.deepEqual(h.requests, ['describe'])
    await h.reply(view)
    assert.deepEqual(h.requests, ['describe'])
    assertBusy(h.container, false)
    assert.equal(h.container.textContent.includes(saveLabel), false)
    assert.equal(h.container.textContent.includes(successLabel), false)
    assert.equal(h.container.querySelectorAll('.dsh-plugin-settings-row').length, 3)
    const [url] = settingsInputs(h.container)
    await h.change(url, ' https://proxy.example.test ')
    assert.deepEqual(h.requests, ['describe'], '입력 중에는 저장하지 않는다')
    await h.blur(url)
    assert.deepEqual(h.rpcCalls.at(-1), {
      method: 'save',
      payload: { revision: '1', baseURL: 'https://proxy.example.test', apiKey: '', managementKey: '' },
    })
    assertBusy(h.container, true)
    await h.reply(undefined)
    assert.deepEqual(h.requests, ['describe', 'save', 'describe'])
    assertBusy(h.container, true)
    await h.reply({
      ...view,
      baseURL: 'https://proxy.example.test',
      revision: '2',
      apiKeySaved: false,
      managementKeySaved: false,
    })
    assert.equal(url.value, 'https://proxy.example.test')
    assert.equal(url.disabled, false)
    assert.equal(h.container.querySelector('[role="status"]'), null)
    assert.equal(h.container.querySelector('[role="alert"]'), null)
    assert.equal(h.container.textContent.includes(saveLabel), false)
    assert.equal(h.container.textContent.includes(successLabel), false)
    await h.mount()
    assert.deepEqual(h.requests, ['describe', 'save', 'describe'])
  })
}

await test('API 키는 blur에서 관리 키는 Enter로 실제 포커스를 해제하여 한 번 저장하고 빈 키는 기존 값을 보존한다', async (t) => {
  const h = await createHarness(t, { slot: 'settings.section' })
  await h.mount()
  await h.reply(view)
  const [url, api, management] = settingsInputs(h.container)
  await React.act(async () => api.focus())
  await h.blur(api)
  await h.change(api, 'discarded-draft')
  await h.change(api, '')
  await h.blur(api)
  await React.act(async () => url.focus())
  await h.enter(url)
  assert.notEqual(h.window.document.activeElement, url)
  assert.deepEqual(h.requests, ['describe'], '빈 입력과 변경 없는 Enter는 저장하지 않는다')
  await h.change(api, 'new-api-key')
  await h.blur(api)
  assert.deepEqual(h.rpcCalls.at(-1), {
    method: 'save',
    payload: { revision: '1', baseURL: view.baseURL, apiKey: 'new-api-key', managementKey: undefined },
  })
  assert.equal(api.value, '')
  assertBusy(h.container, true)
  await h.reply(undefined)
  await h.reply({ ...view, revision: '2' })
  await h.change(management, 'new-management-key')
  assert.equal(h.window.document.activeElement, management)
  await h.enter(management)
  assert.notEqual(h.window.document.activeElement, management)
  assert.deepEqual(h.rpcCalls.at(-1), {
    method: 'save',
    payload: { revision: '2', baseURL: view.baseURL, apiKey: undefined, managementKey: 'new-management-key' },
  })
  assert.equal(management.value, '')
  await h.reply(undefined)
  await h.reply({ ...view, revision: '3' })
  await h.blur(management)
  assert.deepEqual(h.requests, ['describe', 'save', 'describe', 'save', 'describe'])
  assert.equal(h.container.querySelector('[role="status"]'), null)
})

for (const [index, key, savedFlag] of [
  [0, 'apiKey', 'apiKeySaved'],
  [1, 'managementKey', 'managementKeySaved'],
]) {
  await test(`${key} 저장키 삭제 버튼은 클릭 즉시 해당 키만 비워 저장하고 revision을 다시 조회한다`, async (t) => {
    const h = await createHarness(t, { slot: 'settings.section' })
    await h.mount()
    await h.reply(view)
    const buttons = [...h.container.querySelectorAll('button')]
    assert.equal(buttons.length, 2)
    await React.act(async () => buttons[index].click())
    assert.deepEqual(h.rpcCalls.at(-1), {
      method: 'save',
      payload: { revision: '1', baseURL: view.baseURL, apiKey: undefined, managementKey: undefined, [key]: '' },
    })
    assertBusy(h.container, true)
    await React.act(async () => buttons[index].click())
    assert.deepEqual(h.requests, ['describe', 'save'])
    await h.reply(undefined)
    assertBusy(h.container, true)
    await h.reply({ ...view, revision: '2', [savedFlag]: false })
    assert.deepEqual(h.requests, ['describe', 'save', 'describe'])
    assert.equal(buttons[index].disabled, true)
    assert.equal(buttons[1 - index].disabled, false)
    assert.equal(h.container.querySelector('[role="status"]'), null)
  })
}

await test('저장 실패 뒤 revision을 다시 조회하지만 자동으로 저장을 재시도하지 않는다', async (t) => {
  const h = await createHarness(t, { slot: 'settings.section' })
  await h.mount()
  await h.reply(view)
  const [url] = settingsInputs(h.container)
  await h.change(url, 'https://failed.example.test')
  await h.blur(url)
  await h.respond({ ok: false, error: { code: 'FAILED', message: 'private server detail' } })
  assert.deepEqual(h.requests, ['describe', 'save', 'describe'])
  assertBusy(h.container, true)
  await h.reply({ ...view, revision: '2' })
  assertBusy(h.container, false)
  assert.ok(h.container.querySelector('[role="alert"]'))
  assert.equal(h.container.textContent.includes('private server detail'), false)
  assert.equal(url.value, view.baseURL)
  await h.mount()
  await React.act(async () => url.focus())
  await h.blur(url)
  await React.act(async () => {})
  assert.deepEqual(h.requests, ['describe', 'save', 'describe'])
  await h.change(url, 'https://explicit.example.test')
  await h.blur(url)
  assert.equal(h.rpcCalls.at(-1).payload.revision, '2')
  await h.reply(undefined)
  await h.respond({ ok: false })
  assert.equal(url.disabled, true)
  assert.ok(h.container.querySelector('[role="alert"]'))
  await h.mount()
  await React.act(async () => {})
  assert.deepEqual(h.requests, ['describe', 'save', 'describe', 'save', 'describe'])
})
