import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
const tick = () => new Promise((resolve) => setImmediate(resolve))
const view = (branch = 'main') => ({ cwd: '/repo', worktrees: [{ path: '/repo', branch }] })
const linkedView = () => ({
  cwd: '/other-worktree',
  worktrees: [...view().worktrees, { path: '/other-worktree', branch: 'feature/worktree' }],
})
const success = (value = view()) => ({ ok: true, value })
const failure = (code) => ({ ok: false, error: { code } })
function deferred() {
  let resolve
  const promise = new Promise((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

const mutationReadinessCases = [
  { name: 'running', blocked: { running: true }, ready: { running: false } },
  { name: 'pending submission', blocked: { pendingSubmissions: [{}] }, ready: { pendingSubmissions: [] } },
]
const readReadinessCases = [
  { name: 'opening', blocked: { openState: 'opening' }, ready: { openState: 'open' } },
  { name: 'removed', blocked: { removed: true }, ready: { removed: false } },
]
const uninitializedView = () => ({ ...view(), needsInitialization: true })
const pendingCreationView = () => ({ ...view(), pendingCreation: { name: 'New worktree', failed: false } })
const selection = ({ cwd = '/repo', choice, path }) => ({
  cwd,
  ...(choice === 'new' ? { pendingCreation: { name: 'New worktree', failed: false } } : {}),
  ...(choice === 'existing' ? { pendingSwitch: { path, failed: false } } : {}),
})
const operations = (h) => h.calls.map((call) => call.operation)

function elements(node) {
  if (Array.isArray(node)) return Array.from(node).flatMap(elements)
  if (!node || typeof node !== 'object' || !node.props) return []
  return [node, ...elements(node.props.children), ...elements(node.props.anchor)]
}

function visibleText(node) {
  if (Array.isArray(node)) return node.map(visibleText).join(' ')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object' || !node.props || node.type === 'dialog') return ''
  return [node.props.label, visibleText(node.props.children), visibleText(node.props.anchor)].filter(Boolean).join(' ')
}

// Exercise the shipped entry point using the same VM boundary as ui-vcs. Unlike
// a hook-value stub, this runner commits effect cleanups and remounts on JSX keys.
async function mount(
  t,
  {
    initial = {},
    language = 'en',
    rpc = ({ operation, payload }) => success(operation === 'select' ? selection(payload) : view()),
  } = {}
) {
  const sessions = new Map()
  const directories = new Map()
  const blockStores = new Map()
  const blockValues = new Map()
  const blockListeners = new Map()
  const blocks = {
    set(id, block) {
      blockValues.set(id, block)
      for (const listener of blockListeners.get(id) ?? []) listener()
    },
    storeFor(id) {
      if (!blockStores.has(id))
        blockStores.set(id, {
          getSnapshot: () => blockValues.get(id),
          subscribe(listener) {
            if (!blockListeners.has(id)) blockListeners.set(id, new Set())
            blockListeners.get(id).add(listener)
            return () => blockListeners.get(id).delete(listener)
          },
        })
      return blockStores.get(id)
    },
  }
  const rootCleanups = []
  const calls = []
  const warnings = []
  const listeners = new Map()
  let plugin,
    registered,
    instance,
    active,
    sessionId = 'original'
  const session = (id) => {
    if (!sessions.has(id))
      sessions.set(id, { running: false, removed: false, openState: 'open', pendingSubmissions: [] })
    return sessions.get(id)
  }
  Object.assign(session(sessionId), initial)
  const react = {
    forwardRef: (render) => render,
    useCallback(callback, deps) {
      const owner = active
      const index = owner.cursor++
      const previous = owner.hooks[index]
      if (
        !previous ||
        !deps ||
        deps.length !== previous.deps?.length ||
        deps.some((value, i) => !Object.is(value, previous.deps[i]))
      )
        owner.hooks[index] = { value: callback, deps: deps?.slice() }
      return owner.hooks[index].value
    },
    useState(initialValue) {
      const owner = active
      const index = owner.cursor++
      if (!(index in owner.hooks))
        owner.hooks[index] = { value: typeof initialValue === 'function' ? initialValue() : initialValue }
      const hook = owner.hooks[index]
      return [
        hook.value,
        (value) => {
          if (!owner.mounted) return
          const next = typeof value === 'function' ? value(hook.value) : value
          if (!Object.is(next, hook.value)) {
            hook.value = next
            owner.dirty = true
          }
        },
      ]
    },
    useRef(initialValue) {
      return react.useState(() => ({ current: initialValue }))[0]
    },
    useEffect(effect, deps) {
      const owner = active
      const index = owner.cursor++
      const previous = owner.hooks[index]
      if (
        !previous ||
        !deps ||
        deps.length !== previous.deps?.length ||
        deps.some((value, i) => !Object.is(value, previous.deps[i]))
      ) {
        const hook = { deps: deps?.slice(), cleanup: previous?.cleanup }
        owner.hooks[index] = hook
        owner.effects.push(() => {
          hook.cleanup?.()
          hook.cleanup = effect()
        })
      }
    },
    useId: () => react.useState(() => `worktree-${active.cursor}`)[0],
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const jsx = (type, props, key) => ({ type, props, key })
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  const window = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener: (type, listener) => listeners.get(type)?.delete(listener),
    __ModuleLoader__: {
      load({ factory }) {
        plugin = factory((id) => {
          if (id === 'react') return react
          if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
          if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Menu: 'Menu', MenuItemButton: 'MenuItemButton' }
          throw new Error(`Unexpected dependency: ${id}`)
        })
      },
    },
  }
  runInNewContext(bundle, {
    AbortController,
    console: { warn: (...args) => warnings.push(args) },
    document: {
      createElement: () => ({ remove() {} }),
      head: { append() {} },
      querySelectorAll: () => [],
      defaultView: { MutationObserver },
      body: {},
    },
    MutationObserver,
    window,
  })
  assert.ok(plugin.inject.includes('conversation'), 'ComposerBlocks must be an explicit plugin dependency')
  plugin.apply({
    get(name) {
      assert.equal(name, 'connection')
      return {
        rpc: {
          call: async (channel, endpoint, payload, signal) => {
            const call = { channel, endpoint, operation: endpoint.split('/').at(-1), payload, signal }
            calls.push(call)
            return rpc(call)
          },
        },
      }
    },
    locale: { getSnapshot: () => ({ active: language }), subscribe: () => () => {} },
    conversation: { blocks },
    uiConversation: { events: { register() {} } },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, render) => {
        if (options.name === 'conversation.input.left') registered = render
      },
    },
    effect(start) {
      const cleanup = start()
      if (typeof cleanup === 'function') rootCleanups.push(cleanup)
    },
  })
  function disposePlugin() {
    for (const cleanup of rootCleanups.splice(0).reverse()) cleanup()
  }
  function unmount() {
    if (!instance) return
    instance.mounted = false
    for (const hook of instance.hooks) hook?.cleanup?.()
    instance = undefined
  }
  function render() {
    const element = registered({
      sessionId,
      useSession: (select) => select(session(sessionId)),
      useInput: (select) => select({ phase: session(sessionId).inputPhase ?? 'plain' }),
      useProjection: (key) => {
        assert.equal(key, 'workingDirectory')
        return directories.get(sessionId) ?? '/repo'
      },
    })
    if (instance && (instance.key !== element.key || instance.type !== element.type)) unmount()
    if (!instance) instance = { key: element.key, type: element.type, hooks: [], mounted: true }
    active = instance
    instance.cursor = 0
    instance.effects = []
    instance.dirty = false
    instance.tree = element.type(element.props)
    active = undefined
    for (const element of elements(instance.tree)) {
      const ref = element.props.ref
      if (ref && ref.current === null)
        ref.current = {
          open: false,
          focus() {},
          showModal() {
            this.open = true
          },
          close() {
            this.open = false
          },
        }
    }
    for (const effect of instance.effects) effect()
  }
  async function flush() {
    for (let pass = 0; pass < 16; pass++) {
      if (instance?.dirty) render()
      await tick()
      if (!instance?.dirty) return
    }
    assert.fail('Client did not settle within 16 render passes')
  }
  const harness = {
    calls,
    warnings,
    listeners,
    blocks,
    get block() {
      return blocks.storeFor(sessionId).getSnapshot()
    },
    send() {
      // Mirror the native composer's public gate; no submit hook is invented.
      return !blocks.storeFor(sessionId).getSnapshot()
    },
    get tree() {
      return instance.tree
    },
    get menu() {
      return elements(instance.tree).find((element) => element.props.className === 'dsh-worktree-picker').props
    },
    get menuItems() {
      return elements(harness.menu.children)
        .filter((element) => element.type === 'MenuItemButton')
        .map((element) => ({ id: element.key == null ? 'create' : `path:${element.key}`, ...element.props }))
    },
    get selectedId() {
      return harness.menuItems.find((item) => item.current)?.id
    },
    get text() {
      return visibleText(instance.tree)
    },
    async update(patch) {
      Object.assign(session(sessionId), patch)
      render()
      await flush()
    },
    async changeDirectory(cwd) {
      directories.set(sessionId, cwd)
      render()
      await flush()
    },
    async navigate(id, patch = {}) {
      sessionId = id
      Object.assign(session(id), patch)
      render()
      await flush()
    },
    async focus() {
      for (const listener of listeners.get('focus') ?? []) listener()
      await flush()
    },
    async select(id) {
      const item = harness.menuItems.find((item) => item.id === id)
      assert.ok(item, `Missing menu option: ${id}`)
      item.onSelect()
      await flush()
    },
    async chooseAfterError() {
      harness.menu.anchor.props.onClick()
      const button = elements(instance.tree).find((element) => element.props['data-worktree-choose'])
      assert.ok(button, 'The error dialog must offer manual selection without requiring a lookup')
      assert.equal(button.props.disabled, false)
      button.props.onClick()
      await flush()
      assert.equal(harness.menu.open, true)
    },
    async retry() {
      const button = elements(instance.tree).find((element) => element.props['data-worktree-retry'])
      assert.ok(button, 'The explicit refresh control must remain available')
      button.props.onClick()
      await flush()
    },
    flush,
    unmount,
    disposePlugin,
  }
  t.after(() => {
    unmount()
    disposePlugin()
  })
  render()
  await flush()
  return harness
}

await test('실행 중인 세션으로 돌아오면 변경을 활성화하지 않고 현재 브랜치를 읽는다', async (t) => {
  const h = await mount(t, {
    rpc: ({ payload }) => success(view(payload.sessionId === 'original' ? 'original-branch' : 'other-branch')),
  })
  assert.match(h.text, /original-branch/)
  await h.update({ running: true })
  await h.navigate('other')
  assert.match(h.text, /other-branch/)
  const beforeReturn = h.calls.length
  await h.navigate('original')
  assert.equal(h.calls.length, beforeReturn + 1, 'Returning to a running session must issue a read-only describe')
  assert.equal(h.calls.at(-1).operation, 'describe')
  assert.equal(h.calls.at(-1).payload.sessionId, 'original')
  assert.match(h.text, /original-branch/)
  assert.doesNotMatch(h.text, /Lookup failed/)
  assert.equal(h.menu.anchor.props.disabled, true)
  await h.update({ running: false })
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('유휴 마운트는 한 번만 불러오고, 안정적인 렌더링은 다시 불러오지 않으며, 유휴 포커스는 새로 고친다', async (t) => {
  const h = await mount(t)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].channel, '/api')
  assert.equal(h.calls[0].endpoint, 'dungsil-worktree/describe')
  assert.equal(h.calls[0].payload.sessionId, 'original')
  assert.match(h.text, /main/)
  assert.equal(h.menu.anchor.props.disabled, false)
  await h.update({})
  assert.equal(h.calls.length, 1)
  await h.focus()
  assert.equal(h.calls.length, 2)
  assert.equal(h.listeners.get('focus').size, 1)
  h.unmount()
  assert.equal(h.listeners.get('focus').size, 0)
  assert.equal(h.listeners.get('resize').size, 0)
  assert.equal(h.calls.at(-1).signal.aborted, true)
})

await test('컴포넌트 메뉴는 생성 항목과 기본 체크아웃을 연결된 워크트리보다 앞에 고정한다', async (t) => {
  const h = await mount(t, {
    rpc: ({ operation, payload }) => success(operation === 'select' ? selection(payload) : linkedView()),
  })
  assert.deepEqual(
    h.menuItems.map((item) => item.id),
    ['create', 'path:/repo', 'path:/other-worktree']
  )
  assert.equal(h.selectedId, 'path:/other-worktree')
  assert.equal(h.menuItems.filter((item) => item.current).length, 1)
  const pinned = elements(h.menu.children).find((element) => element.props.className === 'dsh-worktree-pinned')
  assert.ok(pinned)
  assert.deepEqual(
    elements(pinned)
      .filter((element) => element.type === 'MenuItemButton')
      .map((item) => item.key),
    [undefined, '/repo']
  )
  assert.equal(h.menuItems[2].separatorBefore, true)
  await h.select('path:/repo')
  const selections = h.calls.filter((call) => call.operation === 'select')
  assert.equal(selections.length, 1)
  assert.equal(selections[0].payload.choice, 'existing')
  assert.equal(selections[0].payload.path, '/repo')
  assert.equal(h.selectedId, 'path:/repo')
  assert.deepEqual(operations(h), ['describe', 'select'])
})

for (const { name, blocked, ready } of mutationReadinessCases) {
  await test(`${name} 마운트와 포커스는 브랜치를 읽지만 변경 동작은 비활성으로 유지한다`, async (t) => {
    const h = await mount(t, { initial: blocked, rpc: () => success(linkedView()) })
    assert.deepEqual(operations(h), ['describe'])
    assert.match(h.text, /feature\/worktree/)
    assert.equal(h.menu.anchor.props.disabled, true)
    await h.select('create')
    await h.select('path:/repo')
    assert.deepEqual(operations(h), ['describe'], 'Disabled menu handlers must not perform writes')
    await h.focus()
    assert.deepEqual(operations(h), ['describe', 'describe'])
    assert.match(h.text, /feature\/worktree/)
    assert.equal(h.menu.anchor.props.disabled, true)
    await h.update(ready)
    assert.equal(h.menu.anchor.props.disabled, false)
    assert.ok(h.calls.every((call) => call.operation === 'describe'))
  })

  await test(`${name} 상태가 된 뒤의 포커스도 현재 변경 준비 상태를 사용해 읽는다`, async (t) => {
    const h = await mount(t)
    await h.update(blocked)
    const beforeFocus = h.calls.length
    await h.focus()
    assert.equal(h.calls.length, beforeFocus + 1)
    assert.equal(h.calls.at(-1).operation, 'describe')
    assert.match(h.text, /main/)
    assert.equal(h.menu.anchor.props.disabled, true)
    await h.update(ready)
    assert.equal(h.menu.anchor.props.disabled, false)
  })
}

for (const { name, blocked, ready } of readReadinessCases) {
  await test(`${name} 마운트와 포커스는 세션이 준비될 때까지 조회를 미룬다`, async (t) => {
    const h = await mount(t, { initial: blocked })
    assert.equal(h.calls.length, 0, `A ${name} session must not issue its initial describe`)
    await h.changeDirectory('/other-worktree')
    assert.equal(h.calls.length, 0, 'Directory changes must not query an unreadable session')
    assert.equal(h.menu.anchor.props.disabled, true)
    assert.doesNotMatch(h.text, /Lookup failed/)
    await h.focus()
    assert.equal(h.calls.length, 0, `Focus must not query a ${name} session`)
    await h.update(ready)
    assert.equal(h.calls.length, 1, 'Readiness must trigger the deferred lookup automatically')
    assert.match(h.text, /main/)
    assert.equal(h.menu.anchor.props.disabled, false)
    assert.equal(h.listeners.get('focus').size, 1)
  })

  await test(`${name} 상태가 된 뒤의 포커스는 마운트 시점의 오래된 준비 상태를 사용하지 않는다`, async (t) => {
    const h = await mount(t)
    assert.equal(h.calls.length, 1)
    await h.update(blocked)
    await h.focus()
    assert.equal(h.calls.length, 1, `Focus must not describe after the session becomes ${name}`)
    assert.equal(h.menu.anchor.props.disabled, true)
    await h.update(ready)
    assert.equal(h.calls.length, 2, 'Becoming ready must refresh an already-loaded list')
    assert.equal(h.menu.anchor.props.disabled, false)
  })
}

await test('새 워크트리를 선택하고 다른 곳으로 이동한 뒤 실행 중에 돌아오면 예약을 읽는다', async (t) => {
  let selected = view()
  const h = await mount(t, {
    rpc: ({ operation, payload }) => {
      if (operation === 'select') {
        selected = { ...selected, ...selection(payload) }
        return success(selection(payload))
      }
      return success(selected)
    },
  })
  await h.select('create')
  assert.deepEqual(operations(h), ['describe', 'select'])
  assert.equal(h.selectedId, 'create')
  await h.update({ running: true })
  await h.navigate('other')
  assert.equal(h.calls[0].signal.aborted, true, 'The keyed navigation must run the old Picker cleanup')
  const beforeReturn = h.calls.length
  await h.navigate('original')
  assert.equal(h.calls.length, beforeReturn + 1)
  assert.equal(h.menu.anchor.props.label, 'New worktree')
  await h.focus()
  assert.equal(h.calls.length, beforeReturn + 2, 'Return and focus must each read during the original task')
  assert.equal(h.menu.anchor.props.disabled, true)
  assert.doesNotMatch(h.text, /Lookup failed/)
  await h.update({ running: false })
  assert.equal(h.menu.anchor.props.label, 'New worktree')
  assert.equal(h.menu.anchor.props.disabled, false)
  assert.equal(h.calls.filter((call) => call.operation === 'select').length, 1)
})

for (const { name, blocked, ready } of mutationReadinessCases) {
  await test(`초기화되지 않은 ${name} 세션은 먼저 조회하고 유휴 상태가 된 뒤에만 초기화한다`, async (t) => {
    let initialized = false
    const h = await mount(t, {
      initial: blocked,
      rpc: ({ operation }) => {
        if (operation === 'initialize') initialized = true
        return success(initialized ? pendingCreationView() : uninitializedView())
      },
    })
    assert.deepEqual(operations(h), ['describe'])
    assert.match(h.text, /main/)
    assert.equal(h.menu.anchor.props.disabled, true)
    await h.focus()
    assert.deepEqual(operations(h), ['describe', 'describe'], 'Read-only focus must not initialize a busy session')
    const beforeIdle = h.calls.length
    await h.update(ready)
    assert.deepEqual(operations(h).slice(beforeIdle), ['describe', 'initialize'])
    const initialization = h.calls.at(-1)
    assert.equal(initialization.endpoint, 'dungsil-worktree/initialize')
    assert.equal(initialization.payload.sessionId, 'original')
    assert.equal(initialization.payload.cwd, '/repo')
    assert.equal(h.selectedId, 'create', 'The initialize response must apply pendingCreation immediately')
    assert.match(h.menu.anchor.props.label, /New worktree/)
    assert.equal(h.menu.anchor.props.disabled, false)
    await h.update({})
    await h.focus()
    assert.equal(h.calls.filter((call) => call.operation === 'initialize').length, 1)
    assert.equal(h.calls.filter((call) => call.operation === 'create').length, 0)
  })
}

await test('워크트리 준비가 끝나면 작업 실행 중에도 예약 문구를 갱신한다', async (t) => {
  let selected = pendingCreationView()
  const h = await mount(t, { rpc: () => success(selected) })
  assert.equal(h.menu.anchor.props.label, 'New worktree')
  await h.update({ running: true })
  selected = linkedView()
  const beforeReady = h.calls.length
  await h.changeDirectory(selected.cwd)
  assert.equal(h.menu.anchor.props.label, 'feature/worktree', 'Readiness must replace the reserved label before idle')
  assert.equal(h.selectedId, 'path:/other-worktree')
  assert.deepEqual(operations(h).slice(beforeReady), ['describe'])
  assert.equal(h.menu.anchor.props.disabled, true, 'Refreshing the label must not allow mutations while running')
  await h.update({})
  await h.changeDirectory(selected.cwd)
  assert.equal(h.calls.length, beforeReady + 1, 'An unchanged directory must not trigger another read')
})

await test('조회 중 작업 경로가 바뀌면 요청을 중복 실행하지 않고 새 워크트리를 조회한다', async (t) => {
  const response = deferred()
  let reads = 0
  const h = await mount(t, {
    initial: { running: true },
    rpc: () => (++reads === 1 ? response.promise : success(linkedView())),
  })
  await h.changeDirectory('/other-worktree')
  assert.equal(h.calls.length, 1, 'Directory updates must not overlap a pending read')
  response.resolve(success(pendingCreationView()))
  await h.flush()
  assert.deepEqual(operations(h), ['describe', 'describe'])
  assert.equal(h.menu.anchor.props.label, 'feature/worktree')
  assert.equal(h.menu.anchor.props.disabled, true)
})

await test('성공한 초기화는 describe가 다시 명시적으로 초기화를 요청할 때까지 반복하지 않는다', async (t) => {
  let needsInitialization = true
  const h = await mount(t, {
    rpc: ({ operation }) => {
      if (operation === 'initialize') needsInitialization = false
      return success(needsInitialization ? uninitializedView() : pendingCreationView())
    },
  })
  assert.deepEqual(operations(h), ['describe', 'initialize'])
  assert.equal(h.selectedId, 'create')
  await h.update({})
  await h.focus()
  assert.equal(h.calls.filter((call) => call.operation === 'initialize').length, 1)
  needsInitialization = true
  await h.focus()
  assert.deepEqual(operations(h).slice(-2), ['describe', 'initialize'])
  assert.equal(h.calls.filter((call) => call.operation === 'initialize').length, 2)
})

await test('사용 중인 초기화 경합은 읽기 화면을 보존하고 반복 없이 준비 상태에서 재시도한다', async (t) => {
  const response = deferred()
  let attempts = 0
  let initialized = false
  const h = await mount(t, {
    rpc: ({ operation }) => {
      if (operation === 'initialize') {
        if (++attempts === 1) return response.promise
        initialized = true
      }
      return success(initialized ? pendingCreationView() : uninitializedView())
    },
  })
  assert.deepEqual(operations(h), ['describe', 'initialize'])
  await h.update({ running: true })
  response.resolve(failure('busy'))
  await h.flush()
  assert.match(h.text, /main/)
  assert.doesNotMatch(h.text, /Lookup failed|Check worktree state/)
  assert.equal(h.calls.length, 2, 'Busy initialization must not cause an immediate retry loop')
  await h.update({})
  assert.equal(h.calls.length, 2)
  await h.focus()
  assert.equal(h.calls.at(-1).operation, 'describe', 'Running focus may read but must not retry initialization')
  assert.equal(attempts, 1)
  const beforeIdle = h.calls.length
  await h.update({ running: false })
  assert.deepEqual(operations(h).slice(beforeIdle), ['describe', 'initialize'])
  assert.equal(attempts, 2)
  assert.equal(h.selectedId, 'create')
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('초기화가 사용 중이면 관련 없는 렌더링이 아니라 나중의 유휴 포커스에서 재시도한다', async (t) => {
  let attempts = 0
  let initialized = false
  const h = await mount(t, {
    rpc: ({ operation }) => {
      if (operation === 'initialize') {
        if (++attempts === 1) return failure('busy')
        initialized = true
      }
      return success(initialized ? pendingCreationView() : uninitializedView())
    },
  })
  assert.deepEqual(operations(h), ['describe', 'initialize'])
  assert.match(h.text, /main/)
  assert.doesNotMatch(h.text, /Lookup failed|Check worktree state/)
  await h.update({})
  assert.equal(h.calls.length, 2)
  await h.focus()
  assert.deepEqual(operations(h), ['describe', 'initialize', 'describe', 'initialize'])
  assert.equal(h.selectedId, 'create')
})

await test('진행 중인 초기화 도중 유휴 상태로 전환되면 직렬화된 새로 고침을 하나 대기시킨다', async (t) => {
  const response = deferred()
  let attempts = 0
  let initialized = false
  const h = await mount(t, {
    rpc: ({ operation }) => {
      if (operation === 'initialize') {
        if (++attempts === 1) return response.promise
        initialized = true
      }
      return success(initialized ? pendingCreationView() : uninitializedView())
    },
  })
  assert.deepEqual(operations(h), ['describe', 'initialize'])
  await h.update({ running: true })
  await h.update({ running: false })
  await h.focus()
  await h.focus()
  assert.equal(h.calls.length, 2, 'Readiness and focus must not overlap an in-flight initialization')
  response.resolve(failure('busy'))
  await h.flush()
  assert.deepEqual(operations(h), ['describe', 'initialize', 'describe', 'initialize'])
  assert.equal(h.selectedId, 'create')
})

await test('describe 응답은 초기화 전에 모든 변경 조건을 다시 확인한다', async (t) => {
  const response = deferred()
  let reads = 0
  let initialized = false
  const h = await mount(t, {
    rpc: ({ operation }) => {
      if (operation === 'describe' && ++reads === 1) return response.promise
      if (operation === 'initialize') initialized = true
      return success(initialized ? pendingCreationView() : uninitializedView())
    },
  })
  await h.update({ running: true, pendingSubmissions: [{}] })
  response.resolve(success(uninitializedView()))
  await h.flush()
  assert.deepEqual(operations(h), ['describe'], 'A session that became busy during describe must not initialize')
  assert.match(h.text, /main/)
  assert.equal(h.menu.anchor.props.disabled, true)
  await h.update({ running: false })
  await h.focus()
  assert.ok(h.calls.every((call) => call.operation === 'describe'))
  const beforeReady = h.calls.length
  await h.update({ pendingSubmissions: [] })
  assert.deepEqual(operations(h).slice(beforeReady), ['describe', 'initialize'])
  assert.equal(h.selectedId, 'create')
})

await test('키 기반 이동은 초기화를 중단하고 늦게 도착한 pendingCreation 응답을 무시한다', async (t) => {
  const response = deferred()
  const h = await mount(t, {
    rpc: ({ operation, payload }) => {
      if (payload.sessionId !== 'original') return success(view('other-branch'))
      return operation === 'initialize' ? response.promise : success(uninitializedView())
    },
  })
  assert.deepEqual(operations(h), ['describe', 'initialize'])
  const initialization = h.calls.at(-1)
  await h.navigate('other', { running: true })
  assert.equal(initialization.signal.aborted, true)
  assert.match(h.text, /other-branch/)
  response.resolve(success(pendingCreationView()))
  await h.flush()
  assert.match(h.text, /other-branch/)
  assert.equal(h.selectedId, 'path:/repo')
  assert.equal(h.warnings.length, 0)
  assert.equal(h.listeners.get('focus').size, 1)
  await h.navigate('original', { running: true })
  assert.equal(h.calls.at(-1).operation, 'describe')
  assert.equal(h.calls.filter((call) => call.operation === 'initialize').length, 1)
  assert.match(h.text, /main/)
  assert.equal(h.menu.anchor.props.disabled, true)
})

await test('진행 중인 describe 도중 반복된 포커스는 하나의 직렬화된 읽기로 합쳐진다', async (t) => {
  const response = deferred()
  let reads = 0
  const h = await mount(t, { rpc: () => (++reads === 1 ? response.promise : success()) })
  await h.focus()
  await h.focus()
  assert.equal(h.calls.length, 1)
  response.resolve(success())
  await h.flush()
  assert.deepEqual(operations(h), ['describe', 'describe'])
  assert.match(h.text, /main/)
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('실제 읽기 실패는 명시적 확인 전까지 대기 중인 유휴 새로 고침을 막는다', async (t) => {
  const response = deferred()
  let reads = 0
  const h = await mount(t, { rpc: () => (reads++ === 0 ? response.promise : success()) })
  await h.update({ running: true })
  await h.update({ running: false })
  response.resolve(failure('forbidden'))
  await h.flush()
  assert.equal(h.calls.length, 1)
  assert.match(h.text, /Lookup failed/)
  await h.retry()
  assert.equal(h.calls.length, 2)
  assert.match(h.text, /main/)
})

await test('사용 중인 최초 describe는 즉시 재시도 루프 없이 다음 유휴 포커스에서 재시도한다', async (t) => {
  let reads = 0
  const h = await mount(t, { rpc: () => (reads++ === 0 ? failure('busy') : success()) })
  assert.equal(h.calls.length, 1, 'Busy must not start an unbounded immediate retry loop')
  assert.doesNotMatch(h.text, /Lookup failed/)
  await h.update({})
  assert.equal(h.calls.length, 1, 'An unrelated render is not a retry trigger')
  await h.focus()
  assert.equal(h.calls.length, 2, 'The next ready focus must retry a busy lookup')
  assert.match(h.text, /main/)
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('사용 중인 포커스 새로 고침은 알려진 브랜치를 보존하고 자동 재시도를 유지한다', async (t) => {
  let reads = 0
  const h = await mount(t, { rpc: () => (++reads === 2 ? failure('busy') : success()) })
  await h.focus()
  assert.equal(h.calls.length, 2)
  assert.match(h.text, /main/)
  assert.doesNotMatch(h.text, /Lookup failed/)
  await h.focus()
  assert.equal(h.calls.length, 3)
  assert.equal(h.menu.anchor.props.disabled, false)
})

for (const code of ['timeout', 'forbidden', 'invalid_response']) {
  await test(`초기화 ${code} 실패는 describe가 서버 상태를 확인할 때까지 수동으로 남는다`, async (t) => {
    let needsInitialization = true
    const h = await mount(t, {
      rpc: ({ operation }) => {
        if (operation === 'initialize') {
          needsInitialization = false
          return failure(code)
        }
        return success(needsInitialization ? uninitializedView() : pendingCreationView())
      },
    })
    assert.deepEqual(operations(h), ['describe', 'initialize'])
    assert.match(h.text, /Check worktree state/)
    await h.focus()
    await h.update({ running: true })
    await h.update({ running: false })
    await h.focus()
    assert.equal(h.calls.length, 2, 'An uncertain initialization must not be replayed automatically')
    await h.retry()
    assert.deepEqual(operations(h), ['describe', 'initialize', 'describe'])
    assert.equal(h.selectedId, 'create')
    assert.doesNotMatch(h.text, /Check worktree state|Lookup failed/)
    assert.equal(h.menu.anchor.props.disabled, false)
  })
}

for (const code of ['forbidden', 'connection_error', 'invalid_response']) {
  await test(`실제 ${code} 조회 오류는 명시적 새로 고침 전까지 유지된다`, async (t) => {
    let reads = 0
    const h = await mount(t, { rpc: () => (reads++ === 0 ? failure(code) : success()) })
    assert.match(h.text, /Lookup failed/)
    await h.focus()
    await h.update({ running: true })
    await h.update({ running: false })
    await h.focus()
    assert.equal(h.calls.length, 1, 'Real errors must not silently auto-retry on readiness or focus')
    assert.match(h.text, /Lookup failed/)
    await h.retry()
    assert.equal(h.calls.length, 2)
    assert.match(h.text, /main/)
    assert.doesNotMatch(h.text, /Lookup failed/)
    assert.equal(h.menu.anchor.props.disabled, false)
  })
}

for (const choice of ['new', 'existing']) {
  for (const code of ['timeout', 'busy', 'invalid_response']) {
    await test(`불확실한 ${choice} 선택 ${code} 결과는 포커스나 준비 상태에서 절대 재시도하지 않는다`, async (t) => {
      const h = await mount(t, {
        rpc: ({ operation }) => (operation === 'select' ? failure(code) : success({ ...linkedView(), cwd: '/repo' })),
      })
      await h.select(choice === 'new' ? 'create' : 'path:/other-worktree')
      assert.equal(h.calls.length, 2)
      assert.equal(h.calls.at(-1).operation, 'select')
      assert.equal(h.calls.at(-1).payload.choice, choice)
      assert.equal(h.send(), false)
      assert.match(h.text, /Check worktree state/)
      await h.changeDirectory('/other-worktree')
      await h.focus()
      await h.update({ running: true })
      await h.update({ running: false })
      await h.focus()
      assert.equal(h.calls.length, 2, 'An uncertain selection requires explicit reconciliation, not automatic replay')
      await h.retry()
      assert.equal(h.calls.length, 3)
      assert.equal(h.calls.at(-1).operation, 'describe')
      assert.equal(h.calls.filter((call) => call.operation === 'select').length, 1)
      assert.equal(h.send(), true)
      assert.doesNotMatch(h.text, /Check worktree state|Lookup failed/)
      assert.equal(h.menu.anchor.props.disabled, false)
    })
  }
}

await test('불확실한 변경 뒤의 수동 확인이 사용 중이면 수동 새로 고침 경계를 유지한다', async (t) => {
  let reads = 0
  const h = await mount(t, {
    rpc: ({ operation }) => {
      if (operation === 'select') return failure('timeout')
      return ++reads === 2 ? failure('busy') : success()
    },
  })
  await h.select('create')
  assert.match(h.text, /Check worktree state/)
  await h.retry()
  assert.equal(h.calls.length, 3)
  assert.match(h.text, /Check worktree state/, 'Busy verification must not hide the unresolved mutation')
  await h.focus()
  await h.update({ running: true })
  await h.update({ running: false })
  await h.focus()
  assert.equal(h.calls.length, 3, 'A busy explicit verification must not turn uncertainty into auto-retryable state')
  await h.retry()
  assert.equal(h.calls.length, 4)
  assert.equal(h.calls.at(-1).operation, 'describe')
  assert.equal(h.calls.filter((call) => call.operation === 'select').length, 1)
  assert.equal(h.send(), true)
  assert.doesNotMatch(h.text, /Check worktree state|Lookup failed/)
})

await test('선택 성공은 목록을 보존하고 describe나 변경 중 표시 없이 다음 작업 위치만 갱신한다', async (t) => {
  const h = await mount(t, {
    rpc: ({ operation, payload }) =>
      success(operation === 'select' ? selection(payload) : { ...linkedView(), cwd: '/repo' }),
  })
  await h.select('path:/other-worktree')
  assert.deepEqual(operations(h), ['describe', 'select'])
  assert.equal(h.menu.anchor.props.label, 'feature/worktree')
  assert.match(h.menu.anchor.props.title, /Next task location.*next prompt/)
  assert.equal(h.selectedId, 'path:/other-worktree')
  assert.equal(h.menuItems.length, 3, 'Selection-only responses must retain the last described worktree list')
  assert.equal(h.menu.anchor.props['aria-busy'], false)
  assert.equal(h.menu.anchor.props.disabled, false)
  assert.equal(h.send(), true)
  assert.doesNotMatch(h.text, /Changing worktree|Loading worktrees/)
})

await test('키 기반 이동은 진행 중인 조회를 중단하고 늦게 도착한 사용 중 응답을 무시한다', async (t) => {
  const response = deferred()
  let originalReads = 0
  const h = await mount(t, {
    rpc: ({ payload }) =>
      payload.sessionId === 'original' && ++originalReads === 1 ? response.promise : success(view('other')),
  })
  const first = h.calls[0]
  assert.equal(first.signal.aborted, false)
  await h.navigate('other')
  assert.equal(first.signal.aborted, true)
  assert.equal(h.listeners.get('focus').size, 1, 'Unmount must remove the original focus listener')
  response.resolve(failure('busy'))
  await h.flush()
  assert.match(h.text, /other/)
  assert.doesNotMatch(h.text, /Lookup failed/)
  assert.equal(h.warnings.length, 0, 'Aborted replies must not be recorded as failures')
  await h.focus()
  assert.equal(h.calls.length, 3)
  assert.equal(h.calls.at(-1).payload.sessionId, 'other')
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('describe는 열려 있는 현재 세션을 요구하고, 초기화는 모든 변경 조건을 기다린다', async (t) => {
  let initialized = false
  const h = await mount(t, {
    initial: { running: true, removed: true, openState: 'opening', pendingSubmissions: [{}] },
    rpc: ({ operation }) => {
      if (operation === 'initialize') initialized = true
      return success(initialized ? pendingCreationView() : uninitializedView())
    },
  })
  assert.equal(h.calls.length, 0)
  await h.update({ openState: 'open' })
  await h.focus()
  assert.equal(h.calls.length, 0, 'Removed sessions must not read even when open')
  await h.update({ removed: false })
  assert.deepEqual(operations(h), ['describe'])
  assert.match(h.text, /main/)
  await h.update({ running: false })
  await h.focus()
  assert.ok(
    h.calls.every((call) => call.operation === 'describe'),
    'Queued submissions still prohibit initialization'
  )
  assert.equal(h.menu.anchor.props.disabled, true)
  const beforeReady = h.calls.length
  await h.update({ pendingSubmissions: [] })
  assert.deepEqual(operations(h).slice(beforeReady), ['describe', 'initialize'])
  assert.equal(h.selectedId, 'create')
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('고정된 읽기 오류는 세션이 실행 중일 때 수동으로 새로 고칠 수 있다', async (t) => {
  let reads = 0
  const h = await mount(t, { rpc: () => (reads++ === 0 ? failure('forbidden') : success()) })
  assert.match(h.text, /Lookup failed/)
  await h.update({ running: true })
  assert.equal(h.calls.length, 1, 'Readiness alone must not clear a sticky error')
  await h.retry()
  assert.deepEqual(operations(h), ['describe', 'describe'])
  assert.match(h.text, /main/)
  assert.doesNotMatch(h.text, /Lookup failed/)
  assert.equal(h.menu.anchor.props.disabled, true)
  await h.update({ running: false })
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('실제 조회 오류에 대한 확인이 사용 중이면 수동 새로 고침 요구를 해제하지 않는다', async (t) => {
  let reads = 0
  const h = await mount(t, {
    rpc: () => {
      reads++
      return reads === 1 ? failure('forbidden') : reads === 2 ? failure('busy') : success()
    },
  })
  await h.retry()
  assert.equal(h.calls.length, 2)
  assert.match(h.text, /Lookup failed/)
  await h.focus()
  await h.update({ running: true })
  await h.update({ running: false })
  assert.equal(h.calls.length, 2, 'Busy must not downgrade an existing real lookup failure')
  await h.retry()
  assert.equal(h.calls.length, 3)
  assert.doesNotMatch(h.text, /Lookup failed/)
})

await test('새 워크트리와 현재 위치를 빠르게 번갈아 선택하면 최신 의도만 직렬 저장한다', async (t) => {
  const first = deferred()
  const last = deferred()
  let writes = 0
  const h = await mount(t, {
    rpc: ({ operation }) => (operation === 'select' ? (++writes === 1 ? first.promise : last.promise) : success()),
  })
  const chooseNew = h.menuItems.find((item) => item.id === 'create').onSelect
  const chooseCurrent = h.menuItems.find((item) => item.id === 'path:/repo').onSelect
  chooseNew()
  assert.equal(h.send(), false, 'The native composer must be gated synchronously before the RPC settles')
  chooseCurrent()
  chooseNew()
  chooseCurrent()
  await h.flush()
  assert.equal(
    h.selectedId,
    'path:/repo',
    'Even handlers from the same render must observe the latest optimistic value'
  )
  assert.deepEqual(operations(h), ['describe', 'select'])
  assert.equal(h.calls[1].payload.choice, 'new')
  assert.equal(h.menu.anchor.props.disabled, false)
  assert.equal(h.menu.anchor.props['aria-busy'], false)
  await h.focus()
  assert.equal(h.calls.length, 2, 'Focus must not introduce describe while selection synchronization is pending')
  first.resolve(success(selection({ choice: 'new' })))
  await h.flush()
  assert.equal(
    h.selectedId,
    'path:/repo',
    'An older successful snapshot must not replace the current optimistic choice'
  )
  assert.equal(h.calls.length, 3)
  assert.equal(h.calls[2].payload.choice, 'current')
  assert.equal(h.send(), false, 'An intermediate success must not release the latest selection gate')
  last.resolve(success({ cwd: '/repo' }))
  await h.flush()
  assert.deepEqual(operations(h), ['describe', 'select', 'select'])
  assert.equal(h.selectedId, 'path:/repo')
  assert.equal(h.block, undefined)
  assert.equal(h.send(), true)
})

await test('오래된 선택 실패는 더 최신 선택의 저장과 낙관적 값을 막지 않는다', async (t) => {
  const first = deferred()
  let writes = 0
  const h = await mount(t, {
    rpc: ({ operation, payload }) =>
      operation !== 'select' ? success() : ++writes === 1 ? first.promise : success(selection(payload)),
  })
  await h.select('create')
  assert.equal(h.selectedId, 'create')
  await h.select('path:/repo')
  first.resolve(failure('timeout'))
  await h.flush()
  assert.deepEqual(operations(h), ['describe', 'select', 'select'])
  assert.equal(h.calls.at(-1).payload.choice, 'current')
  assert.equal(h.selectedId, 'path:/repo')
  assert.equal(h.send(), true)
  assert.equal(h.warnings.length, 0)
  assert.doesNotMatch(h.text, /Check worktree state/)
})

await test('선택 실패 뒤 현재 위치를 직접 선택하면 예약과 전송 차단을 해제한다', async (t) => {
  let writes = 0
  const h = await mount(t, {
    rpc: ({ operation, payload }) =>
      operation !== 'select' ? success() : ++writes === 1 ? failure('timeout') : success(selection(payload)),
  })
  await h.select('create')
  assert.equal(h.send(), false)
  assert.match(h.block.reason, /Confirm the worktree selection/)
  await h.chooseAfterError()
  await h.select('path:/repo')
  assert.deepEqual(operations(h), ['describe', 'select', 'select'])
  assert.equal(h.calls.at(-1).payload.choice, 'current')
  assert.equal(h.selectedId, 'path:/repo')
  assert.equal(h.send(), true)
  assert.doesNotMatch(h.text, /Check worktree state/)
})

await test('실패한 생성이나 기존 워크트리 예약도 현재 위치 선택으로 취소한다', async (t) => {
  for (const pending of [
    { pendingCreation: { name: 'New worktree', failed: true } },
    { pendingSwitch: { path: '/other-worktree', failed: true } },
  ]) {
    const h = await mount(t, {
      rpc: ({ operation, payload }) =>
        success(operation === 'select' ? selection(payload) : { ...linkedView(), cwd: '/repo', ...pending }),
    })
    assert.match(h.text, /Check worktree state/)
    await h.select('path:/repo')
    assert.equal(h.calls.at(-1).payload.choice, 'current')
    assert.equal(h.selectedId, 'path:/repo')
    assert.doesNotMatch(h.text, /Check worktree state/)
    h.unmount()
  }
})

await test('플러그인 해제는 마운트된 구독이 있어도 자기 차단을 복원하거나 다른 차단을 지우지 않는다', async (t) => {
  const result = deferred()
  const h = await mount(t, {
    rpc: ({ operation }) => (operation === 'select' ? result.promise : success()),
  })
  await h.select('create')
  assert.ok(h.block)
  h.disposePlugin()
  assert.equal(h.block, undefined, 'Disposal must remove ownership before notifying restoration subscribers')
  h.unmount()
  result.resolve(success(selection({ choice: 'new' })))
  await h.flush()

  const otherResult = deferred()
  const other = await mount(t, {
    rpc: ({ operation }) => (operation === 'select' ? otherResult.promise : success()),
  })
  await other.select('create')
  const foreign = { reason: 'Another plugin owns this block' }
  other.blocks.set('original', foreign)
  other.disposePlugin()
  assert.equal(other.block, foreign)
  other.unmount()
  otherResult.resolve(success(selection({ choice: 'new' })))
  await other.flush()
})

await test('선택 저장과 완료는 다른 플러그인의 차단 객체를 덮어쓰거나 지우지 않는다', async (t) => {
  const result = deferred()
  const h = await mount(t, {
    rpc: ({ operation }) => (operation === 'select' ? result.promise : success()),
  })
  const other = { reason: 'Another plugin owns this block' }
  h.blocks.set('original', other)
  await h.select('create')
  assert.equal(h.block, other)
  result.resolve(success(selection({ choice: 'new' })))
  await h.flush()
  assert.equal(h.block, other)
  h.blocks.set('original', undefined)
  assert.equal(h.block, undefined)
})

await test('저장 중 차단 소유권이 바뀌면 다른 차단을 보존하고 비어 있을 때만 자기 차단을 복원한다', async (t) => {
  const result = deferred()
  const h = await mount(t, {
    rpc: ({ operation }) => (operation === 'select' ? result.promise : success()),
  })
  await h.select('create')
  const own = h.block
  const other = { reason: own.reason }
  h.blocks.set('original', other)
  assert.equal(h.block, other, 'Equal text does not imply ownership')
  h.blocks.set('original', undefined)
  assert.equal(h.block, own)
  result.resolve(success(selection({ choice: 'new' })))
  await h.flush()
  assert.equal(h.block, undefined)
})

await test('선택 저장 중 이동하면 원래 세션의 차단을 보존하고 늦은 응답을 화면에 적용하지 않는다', async (t) => {
  const result = deferred()
  const h = await mount(t, {
    rpc: ({ operation, payload }) =>
      operation === 'select' ? result.promise : success(view(payload.sessionId === 'original' ? 'main' : 'other')),
  })
  await h.select('create')
  const request = h.calls.at(-1)
  const own = h.block
  await h.navigate('other')
  assert.equal(request.signal.aborted, true)
  assert.equal(h.block, undefined)
  assert.equal(h.blocks.storeFor('original').getSnapshot(), own)
  result.resolve(success(selection({ choice: 'new' })))
  await h.flush()
  assert.equal(h.menu.anchor.props.label, 'other')
  assert.equal(h.warnings.length, 0)
  await h.navigate('original')
  assert.equal(h.menu.anchor.props.label, 'main')
  assert.equal(h.block, undefined, 'A fresh read on return reconciles the aborted selection')
  assert.equal(h.calls.filter((call) => call.operation === 'select').length, 1)
})

for (const phase of ['adjudicating', 'claimed', 'submitting']) {
  await test(`네이티브 입력이 ${phase} 단계이면 조회는 허용하지만 선택과 초기화는 금지한다`, async (t) => {
    const h = await mount(t, { initial: { inputPhase: phase }, rpc: () => success(uninitializedView()) })
    assert.deepEqual(operations(h), ['describe'])
    assert.equal(h.menu.anchor.props.disabled, true)
    await h.select('create')
    assert.deepEqual(operations(h), ['describe'])
  })
}

for (const [language, title, hint] of [
  ['en', 'Next task location', /next prompt/],
  ['ko', '다음 작업 위치', /다음 프롬프트/],
  ['zh', '下一任务的位置', /下一条提示/],
]) {
  await test(`${language} 로케일은 선택된 기존 워크트리를 다음 작업 위치로 안내한다`, async (t) => {
    const h = await mount(t, {
      language,
      rpc: ({ operation, payload }) =>
        success(operation === 'select' ? selection(payload) : { ...linkedView(), cwd: '/repo' }),
    })
    await h.select('path:/other-worktree')
    assert.match(h.menu.anchor.props['aria-label'], new RegExp(title))
    assert.match(h.menu.anchor.props.title, hint)
    assert.match(h.text, hint)
  })
}
