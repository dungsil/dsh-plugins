import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

async function mount(operation, language = 'en', options = {}) {
  const hooks = []
  const effects = []
  const calls = []
  let cursor = 0
  let registered, plugin
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = initial
      return [hooks[index], (value) => (hooks[index] = typeof value === 'function' ? value(hooks[index]) : value)]
    },
    useRef(initial) {
      const [ref] = react.useState({ current: initial })
      return ref
    },
    useEffect(effect, deps) {
      const [previous, setPrevious] = react.useState()
      if (!previous || deps.some((value, index) => value !== previous[index])) {
        setPrevious(deps)
        effects.push(effect)
      }
    },
    useId: () => 'status',
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const jsx = (type, props) => ({ type, props })
  runInNewContext(bundle, {
    AbortController,
    AbortSignal,
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    document: { createElement: () => ({}) },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    window: {
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id === 'react') return react
            if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
            if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Pill: 'Pill', Menu: 'Menu' }
            throw new Error(`Unexpected dependency: ${id}`)
          })
        },
      },
    },
  })
  plugin.apply({
    get(name) {
      assert.equal(name, 'connection', 'UI must not access the current conversation or sessions service')
      return {
        rpc: {
          call: async (channel, method, payload) => {
            calls.push({ channel, method, payload })
            if (method === 'dungsil-vcs/describe') return { ok: true, value: operation }
            if (options.execute) return options.execute(payload)
            return {
              ok: true,
              value: { operation: payload.operation, branch: 'feat/test', commit: 'a'.repeat(40), checks: [] },
            }
          },
        },
      }
    },
    locale: { getSnapshot: () => ({ active: language }) },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (_options, render) => (registered = render),
    },
    plugin() {},
    effect() {},
  })
  const session = { openState: 'open', pendingSubmissions: [], ...options.session }
  const render = async () => {
    cursor = 0
    const element = registered({
      sessionId: 'session',
      useSession: (select) => select(session),
      useAccess: () => options.canPrompt !== false,
      useProjection: () => (options.cwd === null ? undefined : '/repo'),
    })
    const tree = element.type(element.props)
    const conversation = { getAttribute: () => 'session', querySelector: () => ({}) }
    for (const hook of hooks) {
      if (hook && typeof hook === 'object' && 'current' in hook && hook.current === null)
        hook.current = { closest: () => conversation }
    }
    for (const effect of effects.splice(0)) effect()
    await new Promise((resolve) => setImmediate(resolve))
    return tree
  }
  await render()
  await render()
  const tree = await render()
  const actions = tree.props.children[0].props.children
  return { primary: actions[0].props, menu: actions[1].props, calls, render }
}

await test('all Git actions use typed server RPC without sending conversation prompts in every locale', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    for (const operation of ['commit', 'push', 'pr']) {
      const view = await mount(operation === 'commit' ? 'pr' : operation, language)
      assert.equal(view.primary.disabled, false)
      if (operation === 'commit') view.menu.onSelect('commit')
      else view.primary.onClick()
      await new Promise((resolve) => setImmediate(resolve))
      const commands = view.calls.filter((call) => call.method === 'dungsil-vcs/execute')
      assert.equal(commands.length, 1)
      assert.deepEqual(JSON.parse(JSON.stringify(commands[0])), {
        channel: '/api',
        method: 'dungsil-vcs/execute',
        payload: { sessionId: 'session', cwd: '/repo', operation, requestId: '11111111-1111-4111-8111-111111111111' },
      })
      assert.ok(JSON.stringify((await view.render()).props.children).includes('aaaaaaaaaaaa'))
    }
  }
})

await test('rapid repeated clicks cannot submit a duplicate command', async () => {
  let release
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  const view = await mount('pr', 'en', { execute: () => waiting })
  view.menu.onSelect('commit')
  view.menu.onSelect('commit')
  assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 1)
  release({ ok: true, value: { operation: 'commit', branch: 'feat/test', checks: [] } })
  await new Promise((resolve) => setImmediate(resolve))
})

await test('server errors are localized and never retried automatically', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    const view = await mount('pr', language, { execute: () => ({ ok: false, error: { code: 'partial_stage' } }) })
    view.menu.onSelect('commit')
    await new Promise((resolve) => setImmediate(resolve))
    const status = (await view.render()).props.children[1]
    assert.equal(status.props.role, 'alert')
    assert.match(
      JSON.stringify(status.props.children),
      language === 'ko' ? /스테이징/ : language === 'zh' ? /暂存/ : /staged/
    )
    assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 1)
  }
})

await test('busy, read-only viewers and missing directories disable Git actions', async () => {
  for (const options of [{ session: { running: true } }, { canPrompt: false }, { cwd: null }]) {
    const view = await mount('pr', 'en', options)
    assert.equal(view.menu.anchor.props.disabled, true)
    view.menu.onSelect('commit')
    assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 0)
  }
})
