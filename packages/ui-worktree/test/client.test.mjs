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

const readinessCases = [
  { name: 'running', blocked: { running: true }, ready: { running: false } },
  { name: 'opening', blocked: { openState: 'opening' }, ready: { openState: 'open' } },
  { name: 'pending submission', blocked: { pendingSubmissions: [{}] }, ready: { pendingSubmissions: [] } },
  { name: 'removed', blocked: { removed: true }, ready: { removed: false } },
]

function elements(node) {
  if (Array.isArray(node)) return node.flatMap(elements)
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
async function mount(t, { initial = {}, rpc = () => success() } = {}) {
  const sessions = new Map()
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
          if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Menu: 'Menu' }
          throw new Error(`Unexpected dependency: ${id}`)
        })
      },
    },
  }
  runInNewContext(bundle, {
    AbortController,
    console: { warn: (...args) => warnings.push(args) },
    document: {
      createElement: () => ({}),
      querySelectorAll: () => [],
      defaultView: { MutationObserver },
      body: {},
    },
    MutationObserver,
    window,
  })
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
    locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
    uiConversation: { events: { register() {} } },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, render) => {
        if (options.name === 'conversation.input.left') registered = render
      },
    },
    effect() {},
  })
  function unmount() {
    if (!instance) return
    instance.mounted = false
    for (const hook of instance.hooks) hook?.cleanup?.()
    instance = undefined
  }
  function render() {
    const element = registered({ sessionId, useSession: (select) => select(session(sessionId)) })
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
    get tree() {
      return instance.tree
    },
    get menu() {
      return elements(instance.tree).find((element) => element.props.className === 'dsh-worktree-picker').props
    },
    get text() {
      return visibleText(instance.tree)
    },
    async update(patch) {
      Object.assign(session(sessionId), patch)
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
      assert.ok(
        harness.menu.items.some((item) => item.id === id),
        `Missing menu option: ${id}`
      )
      harness.menu.onSelect(id)
      await flush()
    },
    async retry() {
      const button = elements(instance.tree).find((element) => element.props['data-worktree-retry'])
      assert.ok(button, 'The explicit refresh control must remain available')
      button.props.onClick()
      await flush()
    },
    flush,
    unmount,
  }
  t.after(unmount)
  render()
  await flush()
  return harness
}

await test('returning to a running session defers lookup and recovers automatically when idle', async (t) => {
  let running = false
  const h = await mount(t, {
    rpc: ({ payload }) => (payload.sessionId === 'original' && running ? failure('busy') : success()),
  })
  assert.equal(h.calls.length, 1)
  assert.match(h.text, /main/)
  running = true
  await h.update({ running: true })
  await h.navigate('other')
  const beforeReturn = h.calls.length
  await h.navigate('original')
  const afterReturn = h.calls.length
  assert.equal(afterReturn, beforeReturn, 'Returning to a still-running session must not query the busy server')
  assert.doesNotMatch(h.text, /Lookup failed/)
  running = false
  await h.update({ running: false })
  assert.equal(h.calls.length, afterReturn + 1, 'An idle transition must load without manual refresh')
  assert.match(h.text, /main/)
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('idle mount loads once, stable renders do not reload, and idle focus refreshes', async (t) => {
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

for (const { name, blocked, ready } of readinessCases) {
  await test(`${name} mount and focus defer lookup until the session is ready`, async (t) => {
    const h = await mount(t, { initial: blocked })
    assert.equal(h.calls.length, 0, `A ${name} session must not issue its initial describe`)
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

  await test(`focus after becoming ${name} does not use stale mount-time readiness`, async (t) => {
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

await test('create worktree, navigate away, and return while running never produces Lookup failed', async (t) => {
  let running = false
  let selected = view()
  const h = await mount(t, {
    rpc: ({ operation, payload }) => {
      if (payload.sessionId === 'original' && running) return failure('busy')
      if (operation === 'create') selected = linkedView()
      return success(selected)
    },
  })
  await h.select('create')
  assert.equal(h.calls.filter((call) => call.operation === 'create').length, 1)
  assert.match(h.text, /feature\/worktree/)
  running = true
  await h.update({ running: true })
  await h.navigate('other')
  assert.equal(h.calls[0].signal.aborted, true, 'The keyed navigation must run the old Picker cleanup')
  const beforeReturn = h.calls.length
  await h.navigate('original')
  await h.focus()
  assert.equal(h.calls.length, beforeReturn, 'Return and focus must both defer reads during the original task')
  assert.doesNotMatch(h.text, /Lookup failed/)
  running = false
  await h.update({ running: false })
  assert.equal(h.calls.length, beforeReturn + 1)
  assert.match(h.text, /feature\/worktree/)
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('a busy describe race is deferred rather than a sticky lookup error and retries on readiness', async (t) => {
  const response = deferred()
  let reads = 0
  const h = await mount(t, { rpc: () => (reads++ === 0 ? response.promise : success()) })
  assert.equal(h.calls.length, 1)
  await h.update({ running: true })
  response.resolve(failure('busy'))
  await h.flush()
  assert.doesNotMatch(h.text, /Lookup failed/, 'A busy read is temporary, not a manual-refresh error')
  await h.focus()
  assert.equal(h.calls.length, 1)
  await h.update({ running: false })
  assert.equal(h.calls.length, 2)
  assert.match(h.text, /main/)
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('an idle transition during an in-flight busy read schedules one follow-up lookup', async (t) => {
  const response = deferred()
  let reads = 0
  const h = await mount(t, { rpc: () => (reads++ === 0 ? response.promise : success()) })
  await h.update({ running: true })
  await h.update({ running: false })
  assert.equal(h.calls.length, 1, 'The next read must wait for the in-flight request')
  response.resolve(failure('busy'))
  await h.flush()
  assert.equal(h.calls.length, 2, 'The idle refresh must not disappear behind an in-flight read')
  assert.match(h.text, /main/)
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('a real read failure blocks a queued idle refresh until explicit verification', async (t) => {
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

await test('a busy initial describe retries on the next idle focus without an immediate retry loop', async (t) => {
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

await test('a busy focus refresh preserves the known branch and remains automatically retryable', async (t) => {
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

for (const code of ['forbidden', 'connection_error', 'invalid_response']) {
  await test(`a real ${code} lookup error remains sticky until explicit refresh`, async (t) => {
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

for (const operation of ['create', 'switch']) {
  for (const code of ['timeout', 'busy']) {
    await test(`an uncertain ${operation} ${code} result never retries on focus or readiness`, async (t) => {
      const h = await mount(t, {
        rpc: ({ operation: requested }) =>
          requested === operation ? failure(code) : success({ ...linkedView(), cwd: '/repo' }),
      })
      await h.select(operation === 'create' ? 'create' : 'path:/other-worktree')
      assert.equal(h.calls.length, 2)
      assert.equal(h.calls.at(-1).operation, operation)
      assert.match(h.text, /Check worktree state/)
      await h.focus()
      await h.update({ running: true })
      await h.update({ running: false })
      await h.focus()
      assert.equal(h.calls.length, 2, 'An uncertain mutation requires an explicit lookup, not any automatic retry')
      assert.match(h.text, /Check worktree state/)
      await h.retry()
      assert.equal(h.calls.length, 3)
      assert.equal(h.calls.at(-1).operation, 'describe', 'Explicit refresh must read state, not repeat the mutation')
      assert.equal(h.calls.filter((call) => call.operation === operation).length, 1)
      assert.doesNotMatch(h.text, /Check worktree state|Lookup failed/)
      assert.equal(h.menu.anchor.props.disabled, false)
    })
  }
}

await test('busy manual verification after an uncertain mutation retains the manual-refresh boundary', async (t) => {
  let reads = 0
  const h = await mount(t, {
    rpc: ({ operation }) => {
      if (operation === 'create') return failure('timeout')
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
  assert.equal(h.calls.filter((call) => call.operation === 'create').length, 1)
  assert.doesNotMatch(h.text, /Check worktree state|Lookup failed/)
})

await test('successful mutation followed by a busy describe retries only the read', async (t) => {
  let reads = 0
  const h = await mount(t, {
    rpc: ({ operation }) => {
      if (operation === 'create') return success(linkedView())
      return ++reads === 2 ? failure('busy') : success(reads > 1 ? linkedView() : view())
    },
  })
  await h.select('create')
  assert.equal(h.calls.length, 3)
  assert.match(h.text, /feature\/worktree/)
  assert.doesNotMatch(h.text, /Lookup failed|Check worktree state/)
  await h.focus()
  assert.equal(h.calls.length, 4)
  assert.equal(h.calls.at(-1).operation, 'describe')
  assert.equal(h.calls.filter((call) => call.operation === 'create').length, 1)
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('keyed navigation aborts an in-flight lookup and ignores its late busy response', async (t) => {
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

await test('deferred lookup waits until every readiness condition is clear', async (t) => {
  const h = await mount(t, {
    initial: { running: true, openState: 'opening', pendingSubmissions: [{}] },
  })
  assert.equal(h.calls.length, 0)
  await h.update({ running: false })
  await h.focus()
  assert.equal(h.calls.length, 0)
  await h.update({ openState: 'open' })
  await h.focus()
  assert.equal(h.calls.length, 0)
  await h.update({ pendingSubmissions: [] })
  assert.equal(h.calls.length, 1)
  assert.equal(h.menu.anchor.props.disabled, false)
})

await test('manual refresh of a sticky error also defers while the session is running', async (t) => {
  let reads = 0
  const h = await mount(t, { rpc: () => (reads++ === 0 ? failure('forbidden') : success()) })
  assert.match(h.text, /Lookup failed/)
  await h.update({ running: true })
  await h.retry()
  assert.equal(h.calls.length, 1, 'Explicit refresh must not bypass session readiness')
  await h.update({ running: false })
  assert.equal(h.calls.length, 1, 'The original real error still requires manual refresh')
  await h.retry()
  assert.equal(h.calls.length, 2)
  assert.doesNotMatch(h.text, /Lookup failed/)
})

await test('busy verification of a real lookup error does not clear its manual-refresh requirement', async (t) => {
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
