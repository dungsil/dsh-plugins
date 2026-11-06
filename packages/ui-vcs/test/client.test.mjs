import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

function assertButtonsOnly(node) {
  if (Array.isArray(node)) return node.forEach(assertButtonsOnly)
  assert.notEqual(typeof node, 'string', 'Text must remain inside a button or its action menu')
  if (!node || node.type === 'Pill' || node.type === 'Menu') return
  if (node.props) assertButtonsOnly(node.props.children)
}

async function mount(operation, language = 'en', options = {}) {
  const hooks = []
  const effects = []
  const calls = []
  const messages = []
  const openedTabs = []
  const listeners = new Map()
  const sidebar = options.sidebar === true
  const settings = options.settings === true
  let requestResult = { ok: true, value: { request: options.request ?? null } }
  let gitContext = { operation, headSha: 'head', dirty: false }
  let cursor = 0
  let mountingSidebar = false
  let registered, registeredProps, plugin
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
    useCallback: (callback) => callback,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  }
  const jsx = (type, props) => ({ type, props })
  runInNewContext(bundle, {
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    document: { head: { append() {} }, createElement: () => ({ remove() {} }) },
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
            if (id === 'react-dom') return { createPortal: (children) => children }
            if (id === '@deepseek-ai/dsh-client-ui-primitives') return { Pill: 'Pill', Menu: 'Menu' }
            throw new Error(`Unexpected dependency: ${id}`)
          })
        },
      },
    },
  })
  plugin.apply({
    get(name) {
      // The PR plugin also registers session badges; this fixture renders only its sidebar pane.
      if (mountingSidebar && name === 'sessions') return {}
      assert.equal(name, 'connection', 'UI must not access the current conversation or sessions service')
      return {
        rpc: {
          call: async (channel, method, payload) => {
            calls.push({ channel, method, payload })
            if (sidebar || settings) return operation(channel, method, payload)
            if (method === 'dungsil-vcs/describe')
              return options.describe
                ? options.describe(gitContext)
                : { ok: true, value: { ...gitContext, request: requestResult.ok ? requestResult.value.request : null } }
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
    sidebarRight: {
      openTab: (kind, options) => openedTabs.push(options ? { kind, options } : kind),
      mounted: { subscribe: () => () => {}, getSnapshot: () => 'session' },
    },
    locale: { getSnapshot: () => ({ active: language }) },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (registration, render) => {
        if (
          settings
            ? registration.name === 'settings.section' && registration.id === 'dungsil-ui-vcs'
            : !sidebar || registration.name === 'sidebar.right.pane.tab'
        ) {
          registered = render
          registeredProps = registration.inject?.()
        }
      },
    },
    sidebarRightTabs: { register() {} },
    plugin(module) {
      if (sidebar || settings) {
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
    const element = registered(
      settings
        ? registeredProps
        : {
            sessionId,
            useTabInfo: () => ({ tab }),
            useSession: (select) => select(session),
            useAccess: () => options.canPrompt !== false,
            useProjection: () => (options.cwd === null ? undefined : '/repo'),
          }
    )
    let tree = sidebar || settings ? element : element.type(element.props)
    if (sidebar && typeof tree.type === 'function') tree = tree.type(tree.props)
    if (!sidebar && !settings && tree.type === 'div' && !Array.isArray(tree.props.children))
      tree.props.children = [tree.props.children]
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
  if (sidebar || settings) return common
  await render()
  await render()
  let tree = await render()
  let actions = tree.props.children?.[0]?.props.children ?? []
  return {
    ...common,
    get ci() {
      return tree.props.children?.[1]?.props
    },
    get primary() {
      return actions[0]?.props
    },
    get menu() {
      return actions[1]?.props
    },
    async refresh() {
      await render()
      tree = await render()
      actions = tree.props.children?.[0]?.props.children ?? []
      return actions[0]?.props
    },
  }
}

await test('모든 로케일에서 브랜치 조회 중이거나 실패하면 버튼과 외부 안내를 숨기고 재조회 성공 후 표시한다', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    const waiting = Promise.withResolvers()
    let describe = () => waiting.promise
    const view = await mount('pr', language, { describe: (context) => describe(context) })
    const assertHidden = async () => {
      await view.refresh()
      const tree = await view.render()
      assert.equal(tree.type, 'span')
      assert.equal(tree.props.hidden, true)
      assert.equal(tree.props.children, undefined)
      assert.equal(view.primary, undefined)
      assert.equal(view.menu, undefined)
    }
    await assertHidden()
    waiting.resolve({ ok: false, error: { code: 'default_branch_unknown' } })
    await assertHidden()
    describe = (context) => ({ ok: true, value: context })
    await view.focus()
    await view.refresh()
    assert.equal(view.primary.disabled, false)
    assert.ok(view.menu)
    describe = () => {
      throw new Error('Connection unavailable')
    }
    await view.focus()
    await assertHidden()
    assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 0)
  }
})

await test('설정 화면은 모든 로케일에서 열린 세션 없이 CLI 인증 상태를 표시한다', async () => {
  const texts = (node) =>
    Array.isArray(node)
      ? node.flatMap(texts)
      : typeof node === 'string'
        ? [node]
        : node?.props
          ? texts(node.props.children)
          : []
  for (const [language, label] of [
    ['ko', '인증됨'],
    ['en', 'Authenticated'],
    ['zh', '已认证'],
  ]) {
    const mounted = await mount(
      async (_channel, method) => ({
        ok: true,
        value:
          method === 'dungsil-vcs/cli-status'
            ? [{ cli: 'gh', status: 'authenticated', accounts: [{ host: 'github.com', login: 'alice' }] }]
            : { revision: 'initial', settings: { authorName: '', authorEmail: '', noSign: false } },
      }),
      language,
      { settings: true }
    )
    try {
      await mounted.render()
      const rendered = texts(await mounted.render())
      for (const expected of [label, 'github.com', 'alice']) {
        assert.ok(rendered.some((text) => text === expected))
      }
      assert.deepEqual(
        JSON.parse(JSON.stringify(mounted.calls.find((call) => call.method === 'dungsil-vcs/cli-status').payload)),
        {}
      )
    } finally {
      mounted.unmount()
    }
  }
})

await test('설정은 유효한 변경만 자동 저장하고 저장 중에 입력한 값을 이전 응답으로 덮어쓰지 않는다', async () => {
  let stored = { revision: 'initial', settings: { authorName: '', authorEmail: '', noSign: false } }
  let finishSave
  const mounted = await mount(
    async (_channel, method, payload) => {
      if (method === 'dungsil-vcs/settings') return { ok: true, value: stored }
      if (method === 'dungsil-vcs/cli-status') return { ok: true, value: [] }
      assert.equal(method, 'dungsil-vcs/save-settings')
      assert.equal(payload.revision, stored.revision)
      return new Promise((resolve) => {
        finishSave = () => {
          stored = { revision: `${stored.revision}-next`, settings: payload.settings }
          resolve({ ok: true, value: stored })
        }
      })
    },
    'ko',
    { settings: true }
  )
  const nodes = (node) =>
    Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : []
  const input = (tree, suffix) => nodes(tree).find((node) => node.props.id?.endsWith(suffix)).props
  const saves = () => mounted.calls.filter((call) => call.method === 'dungsil-vcs/save-settings')
  try {
    await mounted.render()
    let tree = await mounted.render()
    assert.equal(nodes(tree).filter((node) => node.props.type === 'submit').length, 0)
    input(tree, '-name').onChange({ target: { value: 'UI Author' } })
    tree = await mounted.render()
    await new Promise((resolve) => setTimeout(resolve, 650))
    assert.equal(saves().length, 0)
    input(tree, '-email').onChange({ target: { value: 'ui@example.invalid' } })
    tree = await mounted.render()
    await new Promise((resolve) => setTimeout(resolve, 650))
    assert.equal(saves().length, 1)
    tree = await mounted.render()
    input(tree, '-name').onChange({ target: { value: 'New Author' } })
    await mounted.render()
    finishSave()
    await mounted.render()
    tree = await mounted.render()
    assert.equal(input(tree, '-name').value, 'New Author')
    await new Promise((resolve) => setTimeout(resolve, 650))
    assert.equal(saves().length, 2)
    finishSave()
    await mounted.render()
    tree = await mounted.render()
    assert.equal(stored.settings.authorName, 'New Author')
    assert.equal(stored.settings.authorEmail, 'ui@example.invalid')
    assert.equal(nodes(tree).filter((node) => node.props.role === 'status').length, 0)
  } finally {
    mounted.unmount()
  }
})

await test('모든 로케일에서 Git 작업은 대화 프롬프트를 보내지 않고 타입이 지정된 서버 RPC를 사용한다', async () => {
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
      assertButtonsOnly(await view.render())
      assert.equal(view.messages.length, 0)
    }
  }
})

await test('빠르게 반복 클릭해도 중복 명령을 제출할 수 없다', async () => {
  const waiting = Promise.withResolvers()
  const view = await mount('pr', 'en', { execute: () => waiting.promise })
  view.menu.onSelect('commit')
  view.menu.onSelect('commit')
  assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 1)
  waiting.resolve({ ok: true, value: { operation: 'commit', branch: 'feat/test', checks: [] } })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(view.messages.length, 0)
})

await test('모든 로케일에서 서버 오류와 연결 실패는 버튼 밖에 텍스트를 출력하지 않고 자동으로 재시도하지 않는다', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    for (const code of ['partial_stage', 'read_only', 'conflict', 'busy', 'unknown', 'connection']) {
      const view = await mount('pr', language, {
        execute: () => {
          if (code === 'connection') throw new Error('Connection unavailable')
          return { ok: false, error: { code } }
        },
      })
      view.menu.onSelect('commit')
      await new Promise((resolve) => setImmediate(resolve))
      assertButtonsOnly(await view.render())
      await view.refresh()
      assert.equal(view.primary.disabled, false)
      assert.equal(view.primary['aria-busy'], false)
      assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 1)
      assert.equal(view.messages.length, 0)
    }
  }
})

await test('사용 중인 상태, 읽기 전용 뷰어, 없는 디렉터리는 Git 작업을 비활성화한다', async () => {
  for (const options of [{ session: { running: true } }, { canPrompt: false }, { cwd: null }]) {
    const view = await mount('pr', 'en', options)
    if (options.session?.running) {
      assert.equal(view.primary, undefined)
      assert.equal(view.menu, undefined)
      assert.equal(view.calls.length, 0)
      continue
    }
    assert.equal(view.menu.anchor.props.disabled, true)
    view.menu.onSelect('commit')
    assert.equal(view.calls.filter((call) => call.method.endsWith('/execute')).length, 0)
    assert.equal(view.messages.length, 0)
  }
})

await test('모든 로케일에서 execute RPC가 성공하면 PR 생성이 곧바로 사이드바 보기 작업으로 바뀐다', async () => {
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
      value: {
        operation: 'pr',
        branch: 'feat/test',
        commit: 'a'.repeat(40),
        url: 'https://github.com/team/project/pull/42',
        checks: [],
      },
    })
    await new Promise((resolve) => setImmediate(resolve))
    const primary = await mounted.refresh()
    assertButtonsOnly(await mounted.render())
    assert.equal(mounted.session.running, undefined)
    assert.equal(primary.children[1], viewLabel)
    assert.equal(primary.disabled, false)
    assert.ok(mounted.menu.items.some((item) => item.id === 'discussion'))
    assert.equal(
      mounted.menu.items.some((item) => item.id === 'commit'),
      false
    )
    primary.onClick()
    assert.deepEqual(mounted.openedTabs, ['forge-panel'])
    assert.equal(mounted.messages.length, 0)
    assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 1)
  }
})

await test('기존 PR은 사이드바를 열고 포커스 시 새로 고치며, 조회 오류가 있어도 생성을 비활성화하지 않는다', async () => {
  const mounted = await mount('pr', 'ko', { request: { number: 42, headSha: 'head', checks: [] } })
  assert.equal(mounted.primary.children[1], 'PR 보기')
  assert.ok(mounted.menu.items.some((item) => item.id === 'discussion'))
  assert.equal(
    mounted.menu.items.some((item) => item.id === 'commit'),
    false
  )
  mounted.primary.onClick()
  assert.deepEqual(mounted.openedTabs, ['forge-panel'])
  assert.equal(mounted.messages.length, 0)
  assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 0)
  const beforeFocus = mounted.calls.filter((call) => call.method === 'dungsil-vcs/describe').length
  assert.ok(beforeFocus > 0)
  mounted.setRequestResult({ ok: true, value: { request: null } })
  await mounted.focus()
  assert.equal((await mounted.refresh()).children[1], 'PR 생성')
  assert.ok(mounted.menu)
  assert.ok(mounted.calls.filter((call) => call.method === 'dungsil-vcs/describe').length > beforeFocus)
  mounted.setRequestResult({ ok: false, error: { code: 'cli_missing' } })
  await mounted.focus()
  const primary = await mounted.refresh()
  assert.equal(primary.children[1], 'PR 생성')
  assert.equal(primary.disabled, false)
})

await test('변경된 파일이나 게시되지 않은 커밋이 있으면 업데이트를 제공하고 메뉴에는 보기를 유지한다', async () => {
  for (const [language, updateLabel, viewLabel] of [
    ['en', 'Update PR', 'View PR'],
    ['ko', 'PR 업데이트', 'PR 보기'],
    ['zh', '更新 PR', '查看 PR'],
  ]) {
    for (const context of [{ dirty: true }, { headSha: 'unpublished' }]) {
      const executed = Promise.withResolvers()
      const mounted = await mount('pr', language, {
        request: { number: 42, headSha: 'head', checks: [] },
        execute: () => executed.promise,
      })
      mounted.setGitContext(context)
      await mounted.focus()
      const primary = await mounted.refresh()
      assert.equal(primary.children[1], updateLabel)
      assert.equal(primary.disabled, false)
      assert.equal(mounted.menu.items.find((item) => item.id === 'view').label, viewLabel)
      mounted.menu.onSelect('view')
      assert.deepEqual(mounted.openedTabs, ['forge-panel'])
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
      assert.ok(mounted.menu.items.some((item) => item.id === 'discussion'))
      assert.equal(
        mounted.menu.items.some((item) => item.id === 'commit'),
        false
      )
      assert.equal(mounted.session.running, undefined)
      assert.equal(mounted.messages.length, 0)
      assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 1)
    }
  }
})

await test('Git 작업 메뉴는 컴포저 위에 포털로 렌더링된 간결한 말풍선을 사용한다', async () => {
  for (const operation of ['push', 'pr']) {
    const mounted = await mount(operation)
    assert.equal(mounted.menu.side, 'top')
    assert.equal(mounted.menu.portal, true)
    assert.equal(mounted.menu.compact, true)
    assert.equal(mounted.messages.length, 0)
    assert.equal(mounted.calls.filter((call) => call.method === 'dungsil-vcs/execute').length, 0)
  }
})

test('모든 로케일에서 본문·대화 메뉴는 공식 상태 패널과 별도인 읽기 전용 보조 뷰를 연다', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    const mounted = await mount('pr', language, { request: { headSha: 'head' } })
    assert.ok(mounted.menu.items.some((item) => item.id === 'discussion'))
    mounted.menu.onSelect('discussion')
    assert.deepEqual(mounted.openedTabs, ['dungsil-vcs-discussion'])
    assert.equal(
      mounted.calls.some((call) => call.method === 'dungsil-vcs/discussion'),
      false
    )
  }
})

test('보조 본문·대화 뷰는 열거나 포커스할 때 조회하지 않고 새로고침할 때만 읽는다', async () => {
  const mounted = await mount(
    async (_channel, method) => {
      assert.equal(method, 'dungsil-vcs/discussion')
      return { ok: true, value: [{ url: 'https://github.com/team/repo/pull/3', body: '# Description', entries: [] }] }
    },
    'ko',
    { sidebar: true }
  )
  await mounted.render()
  let tree = await mounted.render()
  assert.equal(mounted.calls.length, 0)
  mounted.focus()
  assert.equal(mounted.calls.length, 0)
  tree.props.children[0].props.onClick()
  await mounted.render()
  tree = await mounted.render()
  assert.equal(mounted.calls.length, 1)
  assert.ok(JSON.stringify(tree).includes('# Description'))
  mounted.unmount()
})
