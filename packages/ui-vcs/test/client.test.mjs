import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

async function mount(operation, language = 'en', options = {}) {
  const hooks = []
  const effects = []
  const calls = []
  const messages = []
  const openedTabs = []
  const listeners = new Map()
  const sidebar = options.sidebar === true
  let requestResult = { ok: true, value: { request: options.request ?? null } }
  let gitContext = { operation, headSha: 'head', dirty: false }
  let cursor = 0
  let mountingSidebar = false
  let registered, plugin
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], (value) => (hooks[index] = typeof value === 'function' ? value(hooks[index]) : value)]
    },
    useRef(initial) {
      const [ref] = react.useState({ current: initial })
      return ref
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
    useId: () => 'status',
    useMemo: (create) => create(),
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
      addEventListener: (event, listener) => listeners.set(event, listener),
      removeEventListener: (event, listener) => {
        if (listeners.get(event) === listener) listeners.delete(event)
      },
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
            if (sidebar) return operation(channel, method, payload)
            if (method === 'dungsil-vcs/describe') return { ok: true, value: gitContext }
            if (method === 'dungsil-vcs/pull-requests/list') return requestResult
            assert.equal(method, 'dungsil-vcs/execute')
            if (options.execute) return options.execute(payload)
            return {
              ok: true,
              value: { operation: payload.operation, branch: 'feat/test', commit: 'a'.repeat(40), checks: [] },
            }
          },
        },
      }
    },
    sidebarRight: { openTab: (kind) => openedTabs.push(kind) },
    locale: { getSnapshot: () => ({ active: language }) },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (registration, render) => {
        if (!sidebar || registration.name === 'sidebar.right.pane.tab') registered = render
      },
    },
    sidebarRightTabs: { register() {} },
    plugin(module) {
      if (sidebar) {
        mountingSidebar = true
        module.apply(this)
        mountingSidebar = false
      }
    },
    effect(setup) {
      if (mountingSidebar) setup()
    },
  })
  const session = { openState: 'open', pendingSubmissions: [], ...options.session }
  const tab = {
    signal: new AbortController().signal,
    visible: true,
    navigation: { revision: 1 },
    actions: { bindCommands: () => () => {} },
  }
  const render = async (sessionId = 'session') => {
    cursor = 0
    const element = registered({
      sessionId,
      useTabInfo: () => ({ tab }),
      useSession: (select) => select(session),
      useAccess: () => options.canPrompt !== false,
      useProjection: () => (options.cwd === null ? undefined : '/repo'),
    })
    const tree = sidebar ? element : element.type(element.props)
    const conversation = { getAttribute: () => sessionId, querySelector: () => ({}) }
    for (const hook of sidebar ? [] : hooks) {
      if (hook && typeof hook === 'object' && 'current' in hook && hook.current === null)
        hook.current = { closest: () => conversation }
    }
    for (const effect of effects.splice(0)) effect()
    await new Promise((resolve) => setImmediate(resolve))
    return tree
  }
  const common = {
    calls,
    messages,
    openedTabs,
    session,
    render,
    setRequestResult: (result) => (requestResult = result),
    setGitContext: (value) => (gitContext = { ...gitContext, ...value }),
    focus: () => listeners.get('focus')?.(),
    unmount() {
      for (const hook of hooks) hook?.cleanup?.()
      hooks.length = 0
    },
  }
  if (sidebar) return common
  await render()
  await render()
  let actions = (await render()).props.children[0].props.children
  return {
    ...common,
    get primary() {
      return actions[0].props
    },
    get menu() {
      return actions[1]?.props
    },
    async refresh() {
      await render()
      actions = (await render()).props.children[0].props.children
      return actions[0].props
    },
  }
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
      assert.equal(view.messages.length, 0)
    }
  }
})

await test('rapid repeated clicks cannot submit a duplicate command', async () => {
  const waiting = Promise.withResolvers()
  const view = await mount('pr', 'en', { execute: () => waiting.promise })
  view.menu.onSelect('commit')
  view.menu.onSelect('commit')
  assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 1)
  waiting.resolve({ ok: true, value: { operation: 'commit', branch: 'feat/test', checks: [] } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(view.messages.length, 0)
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
    assert.equal(view.messages.length, 0)
  }
})

await test('busy, read-only viewers and missing directories disable Git actions', async () => {
  for (const options of [{ session: { running: true } }, { canPrompt: false }, { cwd: null }]) {
    const view = await mount('pr', 'en', options)
    assert.equal(view.menu.anchor.props.disabled, true)
    view.menu.onSelect('commit')
    assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 0)
    assert.equal(view.messages.length, 0)
  }
})

await test('PR creation changes immediately to a sidebar view action after execute RPC succeeds in every locale', async () => {
  for (const [language, createLabel, viewLabel] of [
    ['en', 'Create PR', 'View PR'],
    ['ko', 'PR 생성', 'PR 보기'],
    ['zh', '创建 PR', '查看 PR'],
  ]) {
    const executed = Promise.withResolvers()
    const mounted = await mount('pr', language, { execute: () => executed.promise })
    assert.equal(mounted.primary.children[1], createLabel)
    assert.ok(mounted.menu)
    mounted.primary.onClick()
    assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 1)
    executed.resolve({
      ok: true,
      value: { operation: 'pr', branch: 'feat/test', url: 'https://github.com/team/project/pull/42', checks: [] },
    })
    await new Promise((resolve) => setImmediate(resolve))
    const primary = await mounted.refresh()
    assert.equal(mounted.session.running, undefined)
    assert.equal(primary.children[1], viewLabel)
    assert.equal(primary.disabled, false)
    assert.equal(mounted.menu, undefined)
    primary.onClick()
    assert.deepEqual(mounted.openedTabs, ['dungsil-vcs-pull-requests'])
    assert.equal(mounted.messages.length, 0)
    assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 1)
  }
})

await test('existing PRs open the sidebar and refresh on focus without disabling creation on lookup errors', async () => {
  const mounted = await mount('pr', 'ko', { request: { number: 42, headSha: 'head' } })
  assert.equal(mounted.primary.children[1], 'PR 보기')
  assert.equal(mounted.menu, undefined)
  mounted.primary.onClick()
  assert.deepEqual(mounted.openedTabs, ['dungsil-vcs-pull-requests'])
  assert.equal(mounted.messages.length, 0)
  assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 0)
  const beforeFocus = mounted.calls.filter((call) => call.method === 'dungsil-vcs/pull-requests/list').length
  assert.ok(beforeFocus > 0)
  mounted.setRequestResult({ ok: true, value: { request: null } })
  await mounted.focus()
  assert.equal((await mounted.refresh()).children[1], 'PR 생성')
  assert.ok(mounted.menu)
  assert.ok(mounted.calls.filter((call) => call.method === 'dungsil-vcs/pull-requests/list').length > beforeFocus)
  mounted.setRequestResult({ ok: false, error: { code: 'cli_missing' } })
  await mounted.focus()
  const primary = await mounted.refresh()
  assert.equal(primary.children[1], 'PR 생성')
  assert.equal(primary.disabled, false)
})

await test('sidebar shows an overview before details, reopens from cache, and keeps cached actions disabled while refreshing', async () => {
  const overview = Promise.withResolvers()
  const details = Promise.withResolvers()
  const calls = []
  const item = {
    number: 17,
    title: 'Fast overview',
    url: 'https://github.com/team/project/pull/17',
    source: 'topic',
    target: 'main',
    state: 'open',
    headSha: '',
    body: 'Description',
    checks: [],
    files: [],
    comments: [],
    reviews: [],
    diff: '',
  }
  const view = { provider: 'github', repository: 'github.com/team/project', branch: 'topic', request: item }
  const f = await mount(
    (_channel, _method, payload) => {
      calls.push(payload)
      return payload.summary ? overview.promise : details.promise
    },
    'en',
    { sidebar: true }
  )
  const initial = await f.render()
  assert.equal(initial.props.children[2].props.children[0].type, 'div')
  overview.resolve({ ok: true, value: view })
  await f.render()
  const partial = await f.render()
  assert.ok(JSON.stringify(partial).includes('Fast overview'))
  assert.equal(partial.props.children[2].props['aria-busy'], true)
  assert.equal(partial.props.children[2].props.children[0], false)
  assert.equal(partial.props.children[3].props.children[0], undefined)
  assert.equal(partial.props.children[1].props.children[1].props['aria-busy'], true)
  assert.deepEqual(
    calls.map((call) => call.summary),
    [true, false]
  )
  details.resolve({ ok: true, value: { ...view, request: { ...item, headSha: 'a'.repeat(40) } } })
  await f.render()
  assert.equal((await f.render()).props.children[2].props['aria-busy'], false)
  f.unmount()
  const cached = await f.render()
  assert.ok(JSON.stringify(cached).includes('Fast overview'))
  assert.equal(cached.props.children[2].props['aria-busy'], true)
  assert.equal(cached.props.children[2].props.children[0], false)
  assert.equal(cached.props.children[3].props.children[0], undefined)
  const merge = cached.props.children[3].props.children[1].props.anchor.props.children[0]
  assert.equal(merge.props.disabled, true)
  f.unmount()
  const otherSession = await f.render('other')
  assert.ok(!JSON.stringify(otherSession).includes('Fast overview'))
  f.unmount()
})

await test('existing PRs offer updates for dirty files or unpublished commits and keep viewing in the menu', async () => {
  for (const [language, updateLabel, viewLabel] of [
    ['en', 'Update PR', 'View PR'],
    ['ko', 'PR 업데이트', 'PR 보기'],
    ['zh', '更新 PR', '查看 PR'],
  ]) {
    for (const context of [{ dirty: true }, { headSha: 'unpublished' }]) {
      const executed = Promise.withResolvers()
      const mounted = await mount('pr', language, {
        request: { number: 42, headSha: 'head' },
        execute: () => executed.promise,
      })
      mounted.setGitContext(context)
      await mounted.focus()
      const primary = await mounted.refresh()
      assert.equal(primary.children[1], updateLabel)
      assert.equal(primary.disabled, false)
      assert.equal(mounted.menu.items.find((item) => item.id === 'view').label, viewLabel)
      mounted.menu.onSelect('view')
      assert.deepEqual(mounted.openedTabs, ['dungsil-vcs-pull-requests'])
      assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 0)
      assert.equal(mounted.messages.length, 0)
      primary.onClick()
      const commands = mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute')
      assert.equal(commands.length, 1)
      assert.equal(commands[0].payload.operation, 'pr')
      assert.equal((await mounted.refresh()).disabled, true)
      executed.resolve({
        ok: true,
        value: { operation: 'pr', branch: 'feat/test', url: 'https://github.com/team/project/pull/42', checks: [] },
      })
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal((await mounted.refresh()).children[1], viewLabel)
      assert.equal(mounted.menu, undefined)
      assert.equal(mounted.session.running, undefined)
      assert.equal(mounted.messages.length, 0)
      assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 1)
    }
  }
})

await test('Git action menus use a compact portaled bubble above the composer', async () => {
  for (const operation of ['push', 'pr']) {
    const mounted = await mount(operation)
    assert.equal(mounted.menu.side, 'top')
    assert.equal(mounted.menu.portal, true)
    assert.equal(mounted.menu.compact, true)
    assert.equal(mounted.messages.length, 0)
    assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 0)
  }
})
