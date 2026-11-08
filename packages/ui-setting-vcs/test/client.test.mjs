import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

const channel = '/api'
const readMethod = 'dungsil-setting-vcs/read'
const saveMethod = 'dungsil-setting-vcs/save'
const fixture = () => ({
  entries: [
    {
      id: 'worktree-one',
      kind: 'worktree',
      revision: 'worktree-v1',
      settings: { directory: '.worktrees', prefix: 'tree' },
    },
    {
      id: 'worktree-two',
      kind: 'worktree',
      revision: 'worktree-two-v1',
      settings: { directory: 'other/trees', prefix: 'second' },
    },
    { id: 'panel-one', kind: 'panel', revision: 'panel-v1', settings: { prefix: 'panel' } },
  ],
})
const success = (value) => ({ ok: true, value })
const plain = (value) => JSON.parse(JSON.stringify(value))

async function renderSettings(t, { language = 'ko', rpc = async () => success(fixture()) } = {}) {
  const window = new Window()
  const previous = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const container = window.document.body.appendChild(window.document.createElement('div'))
  const root = createRoot(container)
  const disposers = []
  let mounted = true
  const unmount = async () => {
    if (!mounted) return
    await React.act(async () => root.unmount())
    mounted = false
  }
  t.after(async () => {
    await unmount()
    disposers.reverse().forEach((dispose) => dispose?.())
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const timers = new Map()
  let now = 0
  let timerId = 0
  const setTimeout = (callback, delay) => {
    const id = ++timerId
    timers.set(id, { callback, at: now + delay })
    return id
  }
  const clearTimeout = (id) => timers.delete(id)
  const advance = async (milliseconds = 600) => {
    now += milliseconds
    for (;;) {
      const due = [...timers].find(([, timer]) => timer.at <= now)
      if (!due) break
      timers.delete(due[0])
      await React.act(async () => {
        due[1].callback()
      })
    }
  }
  const require = createRequire(import.meta.url)
  let plugin
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    AbortController,
    setTimeout,
    clearTimeout,
    document: window.document,
    window: {
      setTimeout,
      clearTimeout,
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id !== '@deepseek-ai/dsh-client-ui-primitives') return require(id)
            // Keep the bundled SettingsRow and locale hook; mock browser-only primitives.
            return {
              Button: ({ children, variant: _variant, size: _size, ...props }) =>
                React.createElement('button', props, children),
              Input: React.forwardRef(({ onChange, ...props }, ref) =>
                React.createElement('input', { ...props, ref, onInput: onChange })
              ),
            }
          })
        },
      },
    },
  })
  let snapshot = { active: language }
  const listeners = new Set()
  const calls = []
  let registration
  const connection = {
    rpc: {
      call: (api, method, payload, signal) => {
        assert.equal(api, channel)
        assert.ok(signal instanceof AbortSignal)
        assert.equal(signal.aborted, false)
        calls.push({ method, payload: plain(payload), signal })
        return rpc(method, payload, signal)
      },
    },
  }
  const ctx = {
    effect: (setup) => disposers.push(setup()),
    locale: {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getSnapshot: () => snapshot,
    },
    get: (name) => {
      assert.equal(name, 'connection')
      return connection
    },
    slots: {
      inject: (name, setup) => {
        assert.equal(name, 'settings.section')
        setup()
      },
      register: (options, Component) => {
        registration = options
        root.render(React.createElement(Component, options.inject()))
      },
    },
  }
  await React.act(async () => plugin.apply(ctx))
  assert.equal(registration.id, 'dungsil-ui-setting-vcs')
  return {
    container,
    window,
    calls,
    registration,
    unmount,
    advance,
    directory: () => container.querySelector('input[id$="-directory"]'),
    prefix: () => container.querySelector('input[id$="-prefix"]'),
    saves: () => calls.filter(({ method }) => method === saveMethod),
    setLanguage: async (active) =>
      React.act(async () => {
        snapshot = { active }
        listeners.forEach((listener) => listener())
      }),
    input: async (element, value) =>
      React.act(async () => {
        element.value = value
        element.dispatchEvent(new window.Event('input', { bubbles: true }))
      }),
    reload: async () => React.act(async () => container.querySelector('section > button').click()),
  }
}

function savedServer(initial = fixture()) {
  const view = plain(initial)
  return async (method, payload) => {
    if (method === readMethod) return success(plain(view))
    assert.equal(method, saveMethod)
    const entry = view.entries.find(({ id }) => id === payload.id)
    assert.equal(payload.revision, entry.revision)
    entry.revision += '-next'
    entry.settings = plain(payload.settings)
    return success(plain(view))
  }
}

await test('한국어 영어 중국어에서 디렉터리와 접두사 입력을 하나씩 표시하고 저장 버튼을 표시하지 않는다', async (t) => {
  const ui = await renderSettings(t)
  const locales = [
    ['ko', '버전 관리', '워크트리 디렉터리', '워크트리 이름 접두사', '서로 다른 값', '저장'],
    ['en', 'Version control', 'Worktree directory', 'Worktree name prefix', 'Different values', 'Save'],
    ['zh', '版本控制', '工作树目录', '工作树名称前缀', '值不一致', '保存'],
  ]
  for (const [language, nav, directory, prefix, mixed, save] of locales) {
    await ui.setLanguage(language)
    assert.equal(ui.registration.label(), nav)
    assert.equal(ui.container.querySelector('section').getAttribute('aria-label'), nav)
    assert.deepEqual(
      [...ui.container.querySelectorAll('label')].map((label) => label.textContent),
      [directory, prefix]
    )
    assert.equal(ui.container.querySelectorAll('input').length, 2)
    assert.equal(ui.container.querySelectorAll('input[id$="-directory"]').length, 1)
    assert.equal(ui.container.querySelectorAll('input[id$="-prefix"]').length, 1)
    assert.equal(ui.container.querySelector('section > button'), null)
    assert.equal(
      [...ui.container.querySelectorAll('button')].some((button) => button.textContent === save),
      false
    )
    for (const label of ui.container.querySelectorAll('label')) {
      assert.equal(ui.window.document.getElementById(label.htmlFor)?.tagName, 'INPUT')
    }
    assert.equal(ui.directory().value, '')
    assert.equal(ui.prefix().value, '')
    assert.equal(ui.directory().placeholder, mixed)
    assert.equal(ui.prefix().placeholder, mixed)
  }
  await ui.advance(3000)
  assert.deepEqual(
    ui.calls.map(({ method }) => method),
    [readMethod]
  )
})

await test('디렉터리를 마지막으로 변경한 뒤 600ms가 지나면 모든 worktree만 저장하고 기존 접두사를 유지한다', async (t) => {
  const ui = await renderSettings(t, { rpc: savedServer() })
  await ui.input(ui.directory(), 'first')
  await ui.advance(599)
  assert.equal(ui.saves().length, 0)
  await ui.input(ui.directory(), 'new/trees')
  await ui.advance(599)
  assert.equal(ui.saves().length, 0)
  await ui.advance(1)
  assert.deepEqual(
    ui.saves().map(({ payload }) => payload),
    fixture()
      .entries.slice(0, 2)
      .map((entry) => ({
        id: entry.id,
        revision: entry.revision,
        settings: { ...entry.settings, directory: 'new/trees' },
      }))
  )
  assert.equal(ui.directory().value, 'new/trees')
  assert.equal(ui.prefix().value, '')
  await ui.advance(3000)
  assert.equal(ui.saves().length, 2)
})

await test('접두사를 변경하면 모든 항목에 적용하고 서로 다른 기존 디렉터리를 유지한다', async (t) => {
  const ui = await renderSettings(t, { rpc: savedServer() })
  await ui.input(ui.prefix(), 'shared')
  await ui.advance()
  assert.deepEqual(
    ui.saves().map(({ payload }) => payload),
    fixture().entries.map((entry) => ({
      id: entry.id,
      revision: entry.revision,
      settings: { ...entry.settings, prefix: 'shared' },
    }))
  )
  assert.equal(ui.directory().value, '')
  assert.equal(ui.prefix().value, 'shared')
  await ui.advance(3000)
  assert.equal(ui.saves().length, 3)
})

await test('동일한 저장값은 입력에 표시하며 혼합값과 동일한 값 모두 로드 직후 저장하지 않는다', async (t) => {
  const view = fixture()
  for (const entry of view.entries) {
    entry.settings.prefix = 'same'
    if (entry.kind === 'worktree') entry.settings.directory = 'same/trees'
  }
  const ui = await renderSettings(t, { rpc: savedServer(view) })
  assert.equal(ui.directory().value, 'same/trees')
  assert.equal(ui.prefix().value, 'same')
  await ui.advance(3000)
  assert.equal(ui.saves().length, 0)
})

await test('잘못된 디렉터리나 접두사를 입력하면 오류를 표시하고 자동저장 RPC를 보내지 않는다', async (t) => {
  const ui = await renderSettings(t)
  const cases = [
    [
      ui.directory(),
      [
        '',
        ' ',
        '/absolute',
        'trailing/',
        'a//b',
        '.',
        '..',
        '../outside',
        'a/../b',
        'a\\b',
        'C:/trees',
        'a\u0001b',
        'a'.repeat(4097),
      ],
    ],
    [ui.prefix(), ['-leading', 'a/b', 'a\\b', 'a:b', 'has space', '한글', 'a\u0001b', 'a'.repeat(101)]],
  ]
  for (const [input, values] of cases) {
    for (const value of values) {
      await ui.input(input, value)
      await ui.advance()
      assert.equal(input.getAttribute('aria-invalid'), 'true', JSON.stringify(value))
      const alert = ui.container.querySelector('[role="alert"]')
      assert.ok(alert)
      assert.equal(input.getAttribute('aria-describedby'), alert.id)
      assert.equal(ui.saves().length, 0)
    }
  }
})

await test('빈 접두사를 허용하고 모든 항목에 자동저장한다', async (t) => {
  const ui = await renderSettings(t, { rpc: savedServer() })
  await ui.input(ui.prefix(), '')
  await ui.advance()
  assert.equal(ui.prefix().getAttribute('aria-invalid'), null)
  assert.deepEqual(
    ui.saves().map(({ payload }) => payload),
    fixture().entries.map((entry) => ({
      id: entry.id,
      revision: entry.revision,
      settings: { ...entry.settings, prefix: '' },
    }))
  )
})

await test('저장 중에도 입력을 허용하고 동시 RPC 없이 최신 초안을 이어서 저장한다', async (t) => {
  const view = fixture()
  const pending = []
  const ui = await renderSettings(t, {
    rpc: (method, payload) => {
      if (method === readMethod) return Promise.resolve(success(plain(view)))
      return new Promise((resolve) => pending.push({ payload: plain(payload), resolve }))
    },
  })
  await ui.input(ui.directory(), 'first')
  await ui.advance()
  assert.equal(pending.length, 1)
  assert.equal(ui.directory().disabled, false)
  assert.equal(ui.prefix().disabled, false)
  assert.equal(ui.directory().closest('fieldset')?.disabled ?? false, false)
  await ui.input(ui.directory(), 'superseded/trees')
  await ui.input(ui.prefix(), 'superseded')
  await ui.input(ui.directory(), 'latest/trees')
  await ui.input(ui.prefix(), 'latest')
  await ui.advance()
  assert.equal(pending.length, 1)
  const completed = []
  for (let index = 0; index < 10 && (index < pending.length || completed.length < 3); index++) {
    const next = pending[index]
    assert.ok(next, '직렬 저장의 다음 요청이 있어야 한다')
    const entry = view.entries.find(({ id }) => id === next.payload.id)
    assert.equal(next.payload.revision, entry.revision)
    entry.settings = plain(next.payload.settings)
    entry.revision += '-next'
    await React.act(async () => next.resolve(success(plain(view))))
    completed.push(next.payload)
    await ui.advance()
    assert.ok(pending.length <= index + 2, '이전 응답 전에는 다음 저장을 시작하지 않아야 한다')
    if (index + 1 === pending.length) break
  }
  assert.equal(ui.directory().value, 'latest/trees')
  assert.equal(ui.prefix().value, 'latest')
  assert.deepEqual(
    view.entries.map(({ settings }) => settings),
    [
      { directory: 'latest/trees', prefix: 'latest' },
      { directory: 'latest/trees', prefix: 'latest' },
      { prefix: 'latest' },
    ]
  )
  const count = ui.saves().length
  await ui.advance(3000)
  assert.equal(ui.saves().length, count)
})

for (const failure of ['conflict', 'error', 'throw']) {
  await test(`${failure === 'conflict' ? 'revision 충돌이' : failure === 'error' ? '저장 오류가' : 'RPC 예외가'} 발생하면 자동저장을 차단하고 다시 불러온 뒤 복구한다`, async (t) => {
    const fresh = fixture()
    for (const entry of fresh.entries) {
      entry.revision += '-fresh'
      entry.settings.prefix = 'fresh'
      if (entry.kind === 'worktree') entry.settings.directory = 'fresh/trees'
    }
    let reads = 0
    let fail = true
    const server = savedServer(fresh)
    const ui = await renderSettings(t, {
      rpc: async (method, payload) => {
        if (method === readMethod) return success(++reads === 1 ? fixture() : plain(fresh))
        if (fail) {
          if (failure === 'throw') throw new Error('offline')
          return { ok: false, error: { code: failure } }
        }
        return server(method, payload)
      },
    })
    await ui.input(ui.directory(), 'draft')
    await ui.advance()
    assert.ok(ui.container.querySelector('[role="alert"]'))
    assert.equal(ui.directory().closest('fieldset').disabled, true)
    assert.equal(ui.saves().length, 1)
    for (const [language, refresh] of [
      ['ko', '저장된 값 다시 불러오기'],
      ['en', 'Reload saved values'],
      ['zh', '重新加载已保存的值'],
    ]) {
      await ui.setLanguage(language)
      assert.equal(ui.container.querySelector('section > button').textContent, refresh)
    }
    await ui.advance(3000)
    assert.equal(ui.saves().length, 1)
    fail = false
    await ui.reload()
    assert.equal(ui.container.querySelector('[role="alert"]'), null)
    assert.equal(ui.directory().value, 'fresh/trees')
    assert.equal(ui.prefix().value, 'fresh')
    await ui.advance(3000)
    assert.equal(ui.saves().length, 1)
    await ui.input(ui.directory(), 'retry')
    await ui.advance()
    assert.equal(ui.saves().length, 3)
    assert.equal(ui.saves()[1].payload.revision, 'worktree-v1-fresh')
    assert.equal(ui.saves()[2].payload.revision, 'worktree-two-v1-fresh')
  })
}

await test('일부 항목 저장 후 충돌하면 나머지 쓰기를 차단하고 다시 불러온 혼합값을 자동저장하지 않는다', async (t) => {
  const view = fixture()
  const ui = await renderSettings(t, {
    rpc: async (method, payload) => {
      if (method === readMethod) return success(plain(view))
      assert.equal(method, saveMethod)
      if (payload.id === 'worktree-two') return { ok: false, error: { code: 'conflict' } }
      assert.equal(payload.id, 'worktree-one', '충돌 이후 panel에는 저장하지 않아야 한다')
      const entry = view.entries[0]
      assert.equal(payload.revision, entry.revision)
      entry.revision = 'worktree-v2'
      entry.settings = plain(payload.settings)
      return success(plain(view))
    },
  })
  await ui.input(ui.prefix(), 'shared')
  await ui.advance()
  assert.deepEqual(
    ui.saves().map(({ payload }) => payload.id),
    ['worktree-one', 'worktree-two']
  )
  assert.deepEqual(
    view.entries.map(({ settings }) => settings.prefix),
    ['shared', 'second', 'panel']
  )
  assert.equal(
    ui.container.querySelector('[role="alert"]').textContent,
    '다른 곳에서 설정을 변경했습니다. 저장된 값을 다시 불러온 뒤 재시도하세요.'
  )
  assert.equal(ui.prefix().closest('fieldset').disabled, true)
  assert.equal(ui.container.querySelector('section > button').textContent, '저장된 값 다시 불러오기')
  await ui.advance(3000)
  assert.equal(ui.saves().length, 2)
  await ui.reload()
  assert.equal(ui.container.querySelector('[role="alert"]'), null)
  assert.equal(ui.prefix().closest('fieldset').disabled, false)
  assert.equal(ui.prefix().value, '')
  assert.equal(ui.prefix().placeholder, '서로 다른 값')
  assert.equal(ui.directory().value, '')
  assert.equal(ui.directory().placeholder, '서로 다른 값')
  await ui.advance(3000)
  assert.equal(ui.calls.filter(({ method }) => method === readMethod).length, 2)
  assert.equal(ui.saves().length, 2)
})

for (const operation of ['read', 'save']) {
  await test(`${operation === 'read' ? '조회' : '저장'} RPC가 대기 중일 때 언마운트하면 요청을 중단하고 후속 저장하지 않는다`, async (t) => {
    let pending
    let aborted = 0
    const ui = await renderSettings(t, {
      rpc: (method, _payload, signal) => {
        if (operation === 'save' && method === readMethod) return Promise.resolve(success(fixture()))
        return new Promise((resolve, reject) => {
          pending = { signal, resolve }
          signal.addEventListener(
            'abort',
            () => {
              aborted++
              reject(new Error('aborted'))
            },
            { once: true }
          )
        })
      },
    })
    if (operation === 'save') {
      await ui.input(ui.directory(), 'pending')
      await ui.advance()
      await ui.input(ui.prefix(), 'queued')
    }
    assert.ok(pending)
    assert.equal(pending.signal.aborted, false)
    await ui.unmount()
    assert.equal(pending.signal.aborted, true)
    assert.equal(aborted, 1)
    await ui.advance(3000)
    await React.act(async () => pending.resolve(success(fixture())))
    assert.equal(ui.container.childElementCount, 0)
    assert.equal(ui.calls.length, operation === 'read' ? 1 : 2)
  })
}

await test('디바운스 대기 중 언마운트하면 저장 RPC를 보내지 않는다', async (t) => {
  const ui = await renderSettings(t)
  await ui.input(ui.directory(), 'pending')
  await ui.unmount()
  await ui.advance(3000)
  assert.equal(ui.saves().length, 0)
})
