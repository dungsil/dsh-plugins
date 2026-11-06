import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const panel = (request = null, extra = {}) => ({
  directory: '/repo',
  checkout: { state: 'ready', checkout: { branch: 'main', commit: 'abc' } },
  worktree: {
    editable: true,
    blocker: null,
    request,
    created: null,
    creation: null,
    restoration: null,
    waiting: null,
    failure: null,
    missing: null,
    ...extra,
  },
})
function load(snapshot, language = 'en', clock = { setTimeout, clearTimeout }) {
  let plugin
  const jsx = (type, props, key) => ({ type, props, key })
  const react = {
    forwardRef: (render) => render,
    useEffect() {},
    useCallback: (fn) => fn,
    useId: () => 'status',
    useRef: (value) => ({ current: value }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useSyncExternalStore: (_subscribe, getSnapshot) => {
      const value = getSnapshot()
      return value && 'active' in value ? value : snapshot
    },
  }
  runInNewContext(bundle, {
    AbortController,
    ...clock,
    console,
    document: { createElement: () => ({ remove() {} }), head: { append() {} } },
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id === 'react') return react
            if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
            if (id === '@deepseek-ai/dsh-client-ui-primitives')
              return { Menu: 'Menu', MenuItemButton: 'MenuItemButton' }
            throw Error(`Unexpected dependency: ${id}`)
          })
        },
      },
    },
  })
  const registrations = [],
    cleanups = []
  const ctx = {
    remote: { forgePanel: {} },
    locale: { getSnapshot: () => ({ active: language }), subscribe: () => () => {} },
    on: () => () => {},
    slots: {
      inject: (_key, fn) => fn(),
      register: (options, component) => {
        registrations.push({ options, component })
        return () => {}
      },
    },
    effect: (effect) => {
      /* Styles have no document in the VM. */ const cleanup = effect()
      if (cleanup) cleanups.push(cleanup)
      return () => {}
    },
  }
  return { plugin, ctx, registrations, cleanups }
}
function harness(t, initial = panel()) {
  const { plugin } = load()
  const streams = [],
    calls = [],
    timers = []
  function follow(id, signal) {
    const queue = [],
      pending = []
    let done = false
    const stream = {
      id,
      signal,
      disposed: false,
      push(value) {
        if (pending.length) pending.shift().resolve({ value, done: false })
        else queue.push(value)
      },
      fail(error) {
        if (pending.length) pending.shift().reject(error)
        else throw error
      },
      dispose() {
        this.disposed = true
        done = true
        for (const item of pending.splice(0)) item.resolve({ done: true })
      },
      [Symbol.asyncIterator]() {
        return this
      },
      next() {
        if (queue.length) return Promise.resolve({ value: queue.shift(), done: false })
        if (done) return Promise.resolve({ done: true })
        const item = deferred()
        pending.push(item)
        return item.promise
      },
    }
    streams.push(stream)
    return stream
  }
  let mutation = () => Promise.resolve({ ok: true })
  const remote = {
    follow,
    requestWorktree: (...args) => {
      calls.push(['new', ...args])
      return mutation()
    },
    cancelWorktree: (...args) => {
      calls.push(['current', ...args])
      return mutation()
    },
  }
  const controller = new plugin.SelectionController(remote, 'session')
  t.after(() => {
    controller.dispose()
    for (const timer of timers) clearTimeout(timer)
  })
  controller.refresh()
  if (initial) streams[0].push(initial)
  return {
    controller,
    streams,
    calls,
    mutation: (fn) => {
      mutation = fn
    },
  }
}

await test('Forge의 선택 슬롯만 동일 ID와 우선순위로 교체하고 진행 카드와 사이드바는 변경하지 않는다', () => {
  const h = load({ busy: false, error: false })
  h.plugin.apply(h.ctx)
  assert.deepEqual(
    Array.from(h.registrations, (entry) => entry.options.name),
    ['conversation.hero.options', 'conversation.input.left']
  )
  assert.equal(h.registrations[0].options.id, 'forge-panel.worktree')
  assert.equal(h.registrations[0].options.priority, -100)
  assert.equal(h.registrations[0].component(), null)
  for (const cleanup of h.cleanups) cleanup()
})

await test('새 워크트리 요청은 HEAD를 사용하고 RPC 완료만으로 선택을 확정하지 않는다', async (t) => {
  const h = harness(t)
  await tick()
  await h.controller.choose('new')
  assert.equal(h.calls[0][0], 'new')
  assert.equal(h.calls[0][1], 'session')
  assert.equal(h.calls[0][2], null)
  assert.equal(h.controller.getSnapshot().busy, true)
  assert.equal(h.controller.getSnapshot().panel.worktree.request, null)
  assert.equal(h.streams[0].disposed, true)
  h.streams[1].push(panel({ from: null }))
  await tick()
  assert.equal(h.controller.getSnapshot().busy, false)
  assert.notEqual(h.controller.getSnapshot().panel.worktree.request, null)
})

await test('취소 요청은 확인 프레임이 올 때까지 대기하고 병렬 변경을 보내지 않는다', async (t) => {
  const h = harness(t, panel({ from: 'main' }))
  await tick()
  await h.controller.choose('current')
  await h.controller.choose('new')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0][0], 'current')
  h.streams[1].push(panel({ from: 'main' }))
  await tick()
  assert.equal(h.controller.getSnapshot().busy, true)
  h.streams[1].push(panel())
  await tick()
  assert.equal(h.controller.getSnapshot().busy, false)
})

await test('응답을 기다리는 동안 빠른 중복 클릭을 직렬화한다', async (t) => {
  const h = harness(t)
  await tick()
  const wait = deferred()
  h.mutation(() => wait.promise)
  const first = h.controller.choose('new')
  await h.controller.choose('current')
  await h.controller.choose('new')
  assert.equal(h.calls.length, 1)
  wait.resolve({ ok: true })
  await first
})

for (const { condition, variant } of [
  { condition: '선택을 편집할 수 없으면', variant: { editable: false } },
  { condition: '워크트리가 이미 생성되었으면', variant: { created: { branch: 'feature' } } },
  { condition: '워크트리를 생성 중이면', variant: { creation: { phase: 'prepare' } } },
  { condition: '워크트리를 복구 중이면', variant: { restoration: { phase: 'checkout' } } },
])
  await test(`${condition} 선택을 변경하지 않는다`, async (t) => {
    const h = harness(t, panel(null, variant))
    await tick()
    await h.controller.choose('new')
    await h.controller.choose('current')
    assert.equal(h.calls.length, 0)
  })

await test('생성 차단 상태에서는 새 요청만 막고 기존 요청 취소는 허용한다', async (t) => {
  const h = harness(t, panel(null, { blocker: 'read-only' }))
  await tick()
  await h.controller.choose('new')
  assert.equal(h.calls.length, 0)
  h.streams[0].push(panel({ from: null }, { blocker: 'read-only' }))
  await tick()
  await h.controller.choose('current')
  assert.equal(h.calls.length, 1)
})

await test('이미 선택된 항목은 다시 요청하지 않는다', async (t) => {
  const h = harness(t)
  await tick()
  await h.controller.choose('current')
  assert.equal(h.calls.length, 0)
  h.streams[0].push(panel({ from: 'develop' }))
  await tick()
  await h.controller.choose('new')
  assert.equal(h.calls.length, 0)
})

for (const kind of ['result', 'throw'])
  await test(`${kind} 실패 후 자동 재시도하지 않고 새 상태 확인 후에만 변경한다`, async (t) => {
    const h = harness(t)
    await tick()
    h.mutation(() =>
      kind === 'result' ? Promise.resolve({ ok: false, error: { code: 'busy' } }) : Promise.reject(Error('offline'))
    )
    await h.controller.choose('new')
    assert.equal(h.controller.getSnapshot().error, true)
    await h.controller.choose('new')
    assert.equal(h.calls.length, 1)
    h.controller.refresh()
    h.streams.at(-1).push(panel({ from: null }))
    await tick()
    assert.equal(h.controller.getSnapshot().error, false)
    assert.equal(h.calls.length, 1)
  })

await test('구독 실패와 정상 스트림 종료를 처리하여 확인되지 않은 변경을 막는다', async (t) => {
  const h = harness(t)
  await tick()
  h.streams[0].fail(Error('offline'))
  await tick()
  assert.equal(h.controller.getSnapshot().error, true)
  h.controller.refresh()
  h.streams[1].dispose()
  await tick()
  assert.equal(h.controller.getSnapshot().error, true)
})

await test('해제 시 스트림과 요청을 중단하고 늦은 응답으로 다시 구독하지 않는다', async (t) => {
  const h = harness(t)
  await tick()
  const wait = deferred()
  h.mutation(() => wait.promise)
  const pending = h.controller.choose('new')
  h.controller.dispose()
  assert.equal(h.streams[0].disposed, true)
  assert.equal(h.streams[0].signal.aborted, true)
  assert.equal(h.calls[0][3].aborted, true)
  wait.reject(Error('aborted'))
  await pending
  assert.equal(h.streams.length, 1)
})

await test('확인 프레임이 오지 않으면 제한 시간 후 오류를 표시하고 스트림을 정리한다', () => {
  let timeout,
    disposed = false
  const { plugin } = load(undefined, 'en', {
    setTimeout: (callback) => {
      timeout = callback
      return 1
    },
    clearTimeout() {},
  })
  const controller = new plugin.SelectionController(
    {
      follow() {
        return {
          dispose() {
            disposed = true
          },
          [Symbol.asyncIterator]() {
            return this
          },
          next() {
            return new Promise(() => {})
          },
        }
      },
    },
    'session'
  )
  controller.refresh()
  timeout()
  assert.equal(controller.getSnapshot().error, true)
  assert.equal(controller.getSnapshot().busy, false)
  assert.equal(disposed, true)
  controller.dispose()
})

await test('StrictMode의 효과 재실행 후 새 구독을 만들고 이전 요청 응답은 무시한다', async (t) => {
  const h = harness(t)
  await tick()
  const wait = deferred()
  h.mutation(() => wait.promise)
  const pending = h.controller.choose('new')
  h.controller.dispose()
  h.controller.activate()
  h.streams[1].push(panel())
  await tick()
  wait.resolve({ ok: true })
  await pending
  assert.equal(h.streams.length, 2)
  assert.equal(h.controller.getSnapshot().busy, false)
})

for (const [language, label, current] of [
  ['en', 'New worktree', 'Current branch'],
  ['ko-KR', '새 워크트리', '현재 브랜치'],
  ['zh-CN', '新建工作树', '当前分支'],
]) {
  await test(`${language} 로케일에서 확인된 선택과 현재 브랜치 항목을 표시한다`, () => {
    const h = load({ panel: panel({ from: null }), busy: false, error: false }, language)
    h.plugin.apply(h.ctx)
    const wrapped = h.registrations[1].component({
      sessionId: 'session',
      useSession: (fn) => fn({ running: false, removed: false, openState: 'open', pendingSubmissions: [] }),
      useInput: (fn) => fn({ phase: 'plain' }),
    })
    const tree = wrapped.type(wrapped.props)
    const menu = tree.props.children[0]
    assert.equal(menu.props.anchor.props.label, label)
    assert.equal(menu.props.anchor.props.disabled, false)
    assert.equal(menu.props.children[0].props.current, true)
    assert.equal(menu.props.children[1].props.current, false)
    assert.equal(menu.props.children[1].props.children.props.children[1].props.children, current)
    for (const cleanup of h.cleanups) cleanup()
  })
}

await test('영어 한국어 중국어 문구를 모두 번들에 포함하고 다른 플러그인을 DOM이나 CSS로 숨기지 않는다', () => {
  for (const value of ['New worktree', '새 워크트리', '新建工作树', 'Refresh selection', '선택 새로고침', '刷新选择'])
    assert.ok(bundle.includes(value))
  assert.ok(!bundle.includes('MutationObserver'))
  assert.ok(!bundle.includes('mtc7-a_'))
  assert.ok(!bundle.includes('querySelectorAll'))
})
