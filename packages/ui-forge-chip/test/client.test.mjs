import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
const locales = Object.fromEntries(
  await Promise.all(
    ['en', 'ko', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'].map(async (language) => [
      language,
      JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8')),
    ])
  )
)
const tick = () => new Promise((resolve) => setImmediate(resolve))
const clean = () => ({ ok: true, value: { files: [], omitted: 0 } })
const dirty = () => ({ ok: true, value: { files: [{}], omitted: 0 } })
const request = (branch = 'topic') => ({
  url: `https://github.com/team/repo/pull/${branch}`,
  snapshot: { headBranch: branch, state: 'open', checksRollup: 'success' },
})
const panel = (overrides = {}) => ({
  checkout: { state: 'ready', checkout: { branch: 'topic' } },
  repository: { id: 'repository' },
  changeRequests: [],
  ...overrides,
})

// A controllable async iterator intentionally allows late delivery after disposal.
// This verifies the component's abort guard rather than relying on a helpful transport.
function stream() {
  const queued = []
  let waiter
  return {
    disposed: 0,
    [Symbol.asyncIterator]() {
      return this
    },
    next() {
      if (queued.length) return Promise.resolve(queued.shift())
      return new Promise((resolve) => {
        waiter = resolve
      })
    },
    emit(value) {
      const result = { value, done: false }
      if (waiter) {
        const resolve = waiter
        waiter = undefined
        resolve(result)
      } else queued.push(result)
    },
    end() {
      if (waiter) {
        const resolve = waiter
        waiter = undefined
        resolve({ done: true })
      } else queued.push({ done: true })
    },
    dispose() {
      this.disposed++
    },
  }
}

async function mount(options = {}) {
  const hooks = []
  const effects = []
  const streams = []
  const messages = []
  const calls = []
  const listeners = new Map()
  const events = new Map()
  const openedTabs = []
  const session = { openState: 'open', pendingSubmissions: [], ...options.session }
  let cursor = 0
  let registered, plugin, tree
  let language = options.language ?? 'en'
  let cwd = '/repo'
  let sessionId = 'target-session'
  let localDiff = options.localDiff ?? clean
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[index],
        (value) => {
          hooks[index] = typeof value === 'function' ? value(hooks[index]) : value
        },
      ]
    },
    useRef(initial) {
      return react.useState({ current: initial })[0]
    },
    useEffect(effect, deps) {
      const [previous, setPrevious] = react.useState()
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
        effects.push(() => {
          previous?.cleanup?.()
          setPrevious({ deps, cleanup: effect() })
        })
      }
    },
    useCallback: (callback) => callback,
    useMemo: (create) => create(),
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const jsx = (type, props) => ({ type, props })
  runInNewContext(bundle, {
    AbortController,
    document: { head: { append() {} }, createElement: () => ({ remove() {} }) },
    window: {
      addEventListener: (event, listener) => listeners.set(event, listener),
      removeEventListener: (event, listener) => {
        if (listeners.get(event) === listener) listeners.delete(event)
      },
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id === 'react') return react
            if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
            if (id === 'react-dom') return { createPortal: (children) => children }
            if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Pill: 'Pill', Menu: 'Menu' }
            throw new Error(`Unexpected dependency: ${id}`)
          })
        },
      },
    },
  })
  const context = {
    locale: { getSnapshot: () => ({ active: language }) },
    on(event, listener) {
      events.set(event, listener)
      return () => events.delete(event)
    },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (_registration, render) => {
        registered = render
      },
    },
    effect() {},
    sidebarRight: { openTab: (tab) => openedTabs.push(tab) },
    sessions: {
      scope(id) {
        calls.push(['scope', id])
        return {
          get(service) {
            assert.equal(service, 'conversation')
            return {
              send(message) {
                messages.push({ sessionId: id, message })
                return options.send?.(message)
              },
            }
          },
        }
      },
    },
    remote: {
      forgePanel: {
        follow(id, signal) {
          const value = stream()
          streams.push({ value, signal, sessionId: id })
          return value
        },
        localDiff(id, spec, signal) {
          calls.push(['localDiff', id, spec, signal])
          return localDiff(id, spec, signal)
        },
        changeRequestDiff(id, url, commits, signal) {
          calls.push(['changeRequestDiff', id, url, commits, signal])
          assert.equal(commits, null)
          assert.ok(signal instanceof AbortSignal)
          return options.changeRequestDiff?.(id, url, commits, signal) ?? { ok: true, value: { localAhead: 0 } }
        },
      },
    },
  }
  plugin.apply(
    new Proxy(context, {
      get(target, key) {
        if (['locale', 'slots', 'sidebarRight', 'sessions', 'remote'].includes(key)) {
          assert.ok(plugin.inject.includes(key), `Service ${String(key)} must be explicitly injected`)
        }
        return target[key]
      },
    })
  )
  async function render() {
    cursor = 0
    const element = registered({
      sessionId,
      useSession: (select) => select(session),
      useAccess: () => options.canPrompt !== false,
      useProjection: () => cwd,
    })
    tree = element.type(element.props)
    for (const effect of effects.splice(0)) effect()
    await tick()
    return tree
  }
  async function refresh() {
    await render()
    await render()
    return render()
  }
  await render()
  if (!options.noPanel && streams.length) streams.at(-1).value.emit(options.panel ?? panel())
  await refresh()
  return {
    calls,
    messages,
    streams,
    session,
    openedTabs,
    render,
    refresh,
    get tree() {
      return tree
    },
    get primary() {
      return tree?.props.children[0].props.children[0].props
    },
    get menu() {
      return tree?.props.children[0].props.children[1].props
    },
    get checks() {
      return tree?.props.children[1]?.props
    },
    setLocalDiff(value) {
      localDiff = value
    },
    setLanguage(value) {
      language = value
    },
    setCwd(value) {
      cwd = value
    },
    setSessionId(value) {
      sessionId = value
    },
    focus() {
      listeners.get('focus')?.()
    },
    reset() {
      events.get('connection/reset')?.()
    },
    unmount() {
      for (const hook of hooks) hook?.cleanup?.()
    },
  }
}

await test('모든 로케일의 Git 작업은 현재 화면이 아닌 대상 세션의 conversation에 해당 프롬프트만 보낸다', async () => {
  for (const language of Object.keys(locales)) {
    for (const [operation, key] of [
      ['commit', 'promptCommit'],
      ['push', 'promptPush'],
      ['pr', 'promptPr'],
    ]) {
      const view = await mount({ language: `${language}-REGION` })
      try {
        assert.equal(view.primary.disabled, false)
        view.menu.onSelect(operation)
        await tick()
        assert.deepEqual(view.messages, [{ sessionId: 'target-session', message: locales[language][key] }])
        assert.deepEqual(
          view.calls.filter(([name]) => name === 'scope'),
          [['scope', 'target-session']]
        )
        assert.equal(view.menu.side, 'top')
        assert.equal(view.menu.portal, true)
      } finally {
        view.unmount()
      }
    }
  }
})

await test('실행 중이거나 제출 대기 중이거나 프롬프트 권한이 없으면 직접 호출해도 전송하지 않는다', async () => {
  for (const options of [
    { session: { running: true } },
    { session: { pendingSubmissions: [{}] } },
    { canPrompt: false },
  ]) {
    const view = await mount(options)
    try {
      assert.equal(view.primary.disabled, true)
      assert.equal(view.menu.anchor.props.disabled, true)
      view.primary.onClick()
      view.menu.onSelect('commit')
      assert.equal(view.messages.length, 0)
    } finally {
      view.unmount()
    }
  }
})

await test('전송 완료 전 같은 렌더의 버튼과 메뉴를 반복 호출해도 한 번만 전송한다', async () => {
  const pending = Promise.withResolvers()
  const view = await mount({ send: () => pending.promise })
  try {
    view.primary.onClick()
    view.menu.onSelect('commit')
    view.primary.onClick()
    assert.equal(view.messages.length, 1)
    await view.refresh()
    assert.equal(view.primary['aria-busy'], true)
    assert.equal(view.primary.disabled, true)
    pending.resolve()
    await view.refresh()
    assert.equal(view.primary['aria-busy'], false)
  } finally {
    pending.resolve()
    view.unmount()
  }
})

await test('관련 없는 PR은 보기를 제공하거나 차이를 조회하지 않고 현재 브랜치의 열린 PR만 사용한다', async () => {
  const unrelated = await mount({ panel: panel({ changeRequests: [request('other')] }) })
  try {
    assert.equal(unrelated.primary.children[1], locales.en.push)
    assert.equal(unrelated.checks, undefined)
    assert.equal(unrelated.calls.filter(([name]) => name === 'changeRequestDiff').length, 0)
  } finally {
    unrelated.unmount()
  }
  for (const language of Object.keys(locales)) {
    const view = await mount({ language, panel: panel({ changeRequests: [request('other'), request()] }) })
    try {
      assert.equal(view.primary.children[1], locales[language].viewPr)
      view.primary.onClick()
      assert.deepEqual(view.openedTabs, ['forge-panel'])
      assert.equal(view.messages.length, 0)
      assert.equal(view.calls.find(([name]) => name === 'changeRequestDiff')[2], request().url)
      view.setLocalDiff(dirty)
      view.focus()
      await view.refresh()
      assert.equal(view.primary.children[1], locales[language].updatePr)
    } finally {
      view.unmount()
    }
  }
})

await test('연결 초기화와 디렉터리 변경은 이전 스트림을 중단하고 늦게 도착한 상태를 무시한다', async () => {
  const view = await mount()
  try {
    const initial = view.streams[0]
    view.reset()
    await view.refresh()
    assert.equal(initial.signal.aborted, true)
    assert.ok(initial.value.disposed > 0)
    assert.equal(view.streams.length, 2)
    assert.equal(view.tree, null)
    initial.value.emit(panel({ changeRequests: [request()] }))
    await view.refresh()
    assert.equal(view.tree, null)
    view.streams[1].value.emit(panel())
    await view.refresh()
    assert.equal(view.primary.children[1], locales.en.push)
    view.setCwd('/other')
    await view.refresh()
    assert.equal(view.streams[1].signal.aborted, true)
    assert.equal(view.streams.length, 3)
  } finally {
    view.unmount()
    assert.ok(view.streams.every(({ signal, value }) => signal.aborted && value.disposed > 0))
  }
})

await test('새 패널을 조회한 뒤 도착한 이전 diff 응답은 새 패널의 작업 가능 상태를 덮어쓰지 않는다', async () => {
  const pending = Promise.withResolvers()
  const view = await mount({ localDiff: () => pending.promise })
  try {
    assert.equal(view.primary.disabled, true)
    view.setLocalDiff(clean)
    view.streams[0].value.emit(panel({ local: { base: 'origin/main' } }))
    await view.refresh()
    assert.equal(view.primary.disabled, false)
    assert.equal(view.primary.children[1], locales.en.pr)
    pending.resolve({ ok: false, error: { code: 'stale' } })
    await view.refresh()
    assert.equal(view.primary.disabled, false)
    assert.equal(view.primary.children[1], locales.en.pr)
  } finally {
    pending.resolve(clean())
    view.unmount()
  }
})

await test('조회 실패는 전송을 차단하고 포커스로 다시 조회하면 복구한다', async () => {
  const view = await mount({ localDiff: () => ({ ok: false, error: { code: 'unavailable' } }) })
  try {
    assert.equal(view.primary.disabled, true)
    view.menu.onSelect('commit')
    assert.equal(view.messages.length, 0)
    view.setLocalDiff(clean)
    view.focus()
    await view.refresh()
    assert.equal(view.primary.disabled, false)
  } finally {
    view.unmount()
  }
})
