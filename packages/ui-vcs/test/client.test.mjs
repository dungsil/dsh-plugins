import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

// Exercise the shipped client entry point without a browser or a live agent.
async function mount(operation, language = 'en', request = null, sidebar = false) {
  const hooks = []
  const effects = []
  const messages = []
  const openedTabs = []
  const listeners = new Map()
  let requestResult = { ok: true, value: { request } }
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
    // The sidebar's Markdown decoder initializes a DOM node on module load;
    // these composer tests do not invoke that decoder or mount the sidebar.
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
    get: (name) =>
      name === 'connection'
        ? {
            rpc: {
              call: sidebar
                ? operation
                : async (_channel, method) =>
                    method === 'dungsil-vcs/describe' ? { ok: true, value: gitContext } : requestResult,
            },
          }
        : { scope: () => ({ get: () => ({ send: async (message) => messages.push(message) }) }) },
    sidebarRight: { openTab: (kind) => openedTabs.push(kind) },
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
        for (const hook of hooks) hook?.cleanup?.()
        hooks.length = 0
      },
    }
  await render()
  await render()
  const tree = await render()
  let actions = tree.props.children[0].props.children
  return {
    primary: actions[0].props,
    get menu() {
      return actions[1]?.props
    },
    messages,
    openedTabs,
    session,
    setRequestResult: (result) => (requestResult = result),
    setGitContext: (value) => (gitContext = { ...gitContext, ...value }),
    focus: () => listeners.get('focus')?.(),
    async refresh() {
      await render()
      actions = (await render()).props.children[0].props.children
      return actions[0].props
    },
  }
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
    null,
    true
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

await test('PR creation changes to a sidebar view action after the agent finishes in every locale', async () => {
  for (const [language, createLabel, viewLabel] of [
    ['en', 'Create PR', 'View PR'],
    ['ko', 'PR 생성', 'PR 보기'],
    ['zh', '创建 PR', '查看 PR'],
  ]) {
    const mounted = await mount('pr', language)
    assert.equal(mounted.primary.children[1], createLabel)
    assert.ok(mounted.menu)
    mounted.primary.onClick()
    await new Promise((resolve) => setImmediate(resolve))
    mounted.session.running = true
    assert.equal((await mounted.refresh()).disabled, true)
    mounted.setRequestResult({ ok: true, value: { request: { number: 42, headSha: 'head' } } })
    mounted.session.running = false
    const primary = await mounted.refresh()
    assert.equal(primary.children[1], viewLabel)
    assert.equal(primary.disabled, false)
    assert.equal(mounted.menu, undefined)
    primary.onClick()
    assert.deepEqual(mounted.openedTabs, ['dungsil-vcs-pull-requests'])
    assert.equal(mounted.messages.length, 1) // Viewing never submits another agent request.
  }
})

await test('existing PRs open the sidebar and refresh on focus without disabling creation on lookup errors', async () => {
  const mounted = await mount('pr', 'ko', { number: 42, headSha: 'head' })
  assert.equal(mounted.primary.children[1], 'PR 보기')
  assert.equal(mounted.menu, undefined)
  mounted.primary.onClick()
  assert.deepEqual(mounted.openedTabs, ['dungsil-vcs-pull-requests'])
  assert.equal(mounted.messages.length, 0)
  mounted.setRequestResult({ ok: true, value: { request: null } })
  await mounted.focus()
  assert.equal((await mounted.refresh()).children[1], 'PR 생성')
  assert.ok(mounted.menu)
  mounted.setRequestResult({ ok: false, error: { code: 'cli_missing' } })
  await mounted.focus()
  const primary = await mounted.refresh()
  assert.equal(primary.children[1], 'PR 생성')
  assert.equal(primary.disabled, false)
})

await test('existing PRs offer updates for dirty files or unpublished commits and keep viewing in the menu', async () => {
  for (const [language, updateLabel, viewLabel] of [
    ['en', 'Update PR', 'View PR'],
    ['ko', 'PR 업데이트', 'PR 보기'],
    ['zh', '更新 PR', '查看 PR'],
  ]) {
    for (const context of [{ dirty: true }, { headSha: 'unpublished' }]) {
      const mounted = await mount('pr', language, { number: 42, headSha: 'head' })
      mounted.setGitContext(context)
      await mounted.focus()
      const primary = await mounted.refresh()
      assert.equal(primary.children[1], updateLabel)
      assert.equal(primary.disabled, false)
      assert.equal(mounted.menu.items.find((item) => item.id === 'view').label, viewLabel)
      mounted.menu.onSelect('view')
      assert.deepEqual(mounted.openedTabs, ['dungsil-vcs-pull-requests'])
      assert.equal(mounted.messages.length, 0)
      primary.onClick()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(mounted.messages.length, 1)
      assert.ok(mounted.messages[0].startsWith('Commit and push'))
      mounted.session.running = true
      assert.equal((await mounted.refresh()).disabled, true)
      mounted.setGitContext({ dirty: false, headSha: 'head' })
      mounted.session.running = false
      assert.equal((await mounted.refresh()).children[1], viewLabel)
      assert.equal(mounted.menu, undefined)
    }
  }
})
