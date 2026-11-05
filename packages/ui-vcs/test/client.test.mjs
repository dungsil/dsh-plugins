import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

// Exercise the shipped client entry point without a browser or a live agent.
async function mount(operation, language = 'en', sidebar = false) {
  const hooks = []
  const effects = []
  const cleanups = new Set()
  const messages = []
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
      if (!previous || deps.some((value, index) => value !== previous[index])) {
        setPrevious(deps)
        effects.push(() => {
          const cleanup = effect()
          if (cleanup) cleanups.add(cleanup)
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
    // The sidebar's Markdown decoder initializes a DOM node on module load;
    // these composer tests do not invoke that decoder or mount the sidebar.
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
    get: (name) =>
      name === 'connection'
        ? { rpc: { call: sidebar ? operation : async () => ({ ok: true, value: operation }) } }
        : { scope: () => ({ get: () => ({ send: async (message) => messages.push(message) }) }) },
    locale: { getSnapshot: () => ({ active: language }) },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, render) => {
        if (!sidebar || options.name === 'sidebar.right.pane.tab') registered = render
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
  const session = { openState: 'open', pendingSubmissions: [] }
  const tab = { signal: new AbortController().signal, visible: true, actions: { bindCommands: () => () => {} } }
  const render = async (sessionId = 'session') => {
    cursor = 0
    const element = registered({
      sessionId,
      useTabInfo: () => ({ tab }),
      useSession: (select) => select(session),
      useAccess: () => true,
      useProjection: () => '/repo',
    })
    const tree = sidebar ? element : element.type(element.props)
    // React attaches the anchor before running effects. A changed-files card is present.
    const conversation = { getAttribute: () => 'session', querySelector: () => ({}) }
    for (const hook of sidebar ? [] : hooks) {
      if (hook && typeof hook === 'object' && 'current' in hook && hook.current === null)
        hook.current = { closest: () => conversation }
    }
    for (const effect of effects.splice(0)) effect()
    await new Promise((resolve) => setImmediate(resolve))
    return tree
  }
  if (sidebar)
    return {
      render,
      unmount() {
        for (const cleanup of cleanups) cleanup()
        cleanups.clear()
        hooks.length = 0
      },
    }
  await render()
  await render()
  const tree = await render()
  const actions = tree.props.children[0].props.children
  return { primary: actions[0].props, menu: actions[1].props, messages }
}

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
    true
  )
  await f.render()
  overview.resolve({ ok: true, value: view })
  await f.render()
  const partial = await f.render()
  assert.ok(JSON.stringify(partial).includes('Fast overview'))
  assert.equal(partial.props.children[2].props['aria-busy'], true)
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
  // Merge remains disabled even though the cached SHA is present.
  const merge = cached.props.children[3].props.children[1].props.anchor.props.children[0]
  assert.equal(merge.props.disabled, true)
  f.unmount()
  const otherSession = await f.render('other')
  assert.ok(!JSON.stringify(otherSession).includes('Fast overview'))
  f.unmount()
})

await test('PR actions send a multi-forge, self-hosted review request in every supported locale', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    const { primary, messages } = await mount('pr', language)
    assert.equal(primary.disabled, false)
    primary.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(messages.length, 1)
    const [message] = messages
    for (const requirement of [
      'GitHub',
      'GitLab (including Self-Managed and Dedicated)',
      'Gitea',
      'Forgejo',
      'merge request (MR)',
      'gh for GitHub',
      'glab for GitLab',
      'tea CLI',
      'actual push remote',
      'SSH host aliases',
      'custom ports',
      'instance URL prefixes',
      'nested GitLab namespaces',
      'never fall back to a public host',
      'credentials already scoped to that instance',
      'source repository/branch and target repository/branch',
      'Read the current title and body',
      'create a new PR/MR only if no matching one exists',
      'report the resulting PR/MR URL',
      'report the specific blocker',
      'Do not force-push',
    ])
      assert.ok(message.includes(requirement), `Missing request contract: ${requirement}`)
  }
})

await test('push and commit-only actions do not request hosting API access or review creation', async () => {
  const { primary, messages } = await mount('push')
  primary.onClick()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(messages.length, 1)
  assert.ok(messages[0].startsWith('Commit the work completed in this session if needed, then push'))
  assert.ok(messages[0].includes('Do not create or update a PR/MR or switch branches.'))
  assert.ok(!messages[0].includes('tea CLI'))
  const commit = await mount('pr')
  commit.menu.onSelect('commit')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(commit.messages.length, 1)
  assert.ok(commit.messages[0].startsWith('Commit only the work completed in this session. Do not push'))
  assert.ok(!commit.messages[0].includes('tea CLI'))
})
