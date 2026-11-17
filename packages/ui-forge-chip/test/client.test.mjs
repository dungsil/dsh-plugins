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
  const rpcs = []
  const calls = []
  const listeners = new Map()
  const events = new Map()
  const openedTabs = []
  const opened = []
  const commands = new Map()
  const session = { openState: 'open', pendingSubmissions: [], ...options.session }
  let cursor = 0
  let registered, plugin, tree, integration
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
      if (!previous || !deps || deps.some((value, index) => value !== previous.deps[index])) {
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
  const timers = []
  runInNewContext(bundle, {
    AbortController,
    Promise,
    setInterval: (callback) => (timers.push(callback), timers.length),
    clearInterval: () => {},
    document: {
      head: { append() {} },
      createElement: () => ({ remove() {} }),
      visibilityState: 'visible',
      addEventListener() {},
      removeEventListener() {},
    },
    window: {
      open: (url) => opened.push(url),
      addEventListener: (event, listener) => {
        if (!listeners.has(event)) listeners.set(event, new Set())
        listeners.get(event).add(listener)
      },
      removeEventListener: (event, listener) => listeners.get(event)?.delete(listener),
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
    effect: (effect) => effect(),
    shortcuts: {
      register(command) {
        commands.set(command.id, command)
        return () => commands.delete(command.id)
      },
    },
    sidebarRight: { openTab: (tab) => openedTabs.push(tab) },
    get(name) {
      assert.equal(name, 'connection')
      return {
        rpc: {
          async call(channel, method, payload) {
            assert.equal(channel, '/api')
            rpcs.push([method, JSON.parse(JSON.stringify(payload))])
            if (method === 'dungsil-forge-chip/settings')
              return { ok: true, value: { defaultAction: options.defaultAction ?? 'commit' } }
            return (await options.rpc?.(method, payload)) ?? { ok: true, value: {} }
          },
        },
      }
    },
    remote: {
      forgePanel: {
        follow(id, signal) {
          const value = stream()
          streams.push({ value, signal, sessionId: id })
          return value
        },
        async refresh(id) {
          calls.push(['refresh', id])
        },
        localDiff(id, spec, signal) {
          calls.push(['localDiff', id, spec, signal])
          return localDiff(id, spec, signal)
        },
      },
    },
  }
  plugin.apply(
    new Proxy(context, {
      get(target, key) {
        if (['locale', 'slots', 'sidebarRight', 'remote', 'shortcuts'].includes(key)) {
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
    // Stand in for the mounted, visible chip row the shortcuts look for.
    if (tree?.props.ref)
      tree.props.ref.current = { isConnected: true, getClientRects: () => [{}], querySelectorAll: () => [] }
    const child = tree?.props.children.at(-1)
    integration = child && typeof child.type === 'function' ? child.type(child.props) : undefined
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
    rpcs,
    get actions() {
      return rpcs.filter(([method]) => method !== 'dungsil-forge-chip/settings')
    },
    streams,
    session,
    openedTabs,
    opened,
    commands,
    render,
    refresh,
    get integration() {
      return integration
    },
    setPanel(value) {
      streams.at(-1).value.emit(value)
    },
    get tree() {
      return tree
    },
    get pills() {
      const found = []
      const walk = (node) => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) return node.forEach(walk)
        if (node.type === 'Pill') found.push(node.props)
        if (node.type === 'Menu') found.push({ menu: node.props })
        walk(node.props?.children)
      }
      walk(tree)
      return found
    },
    pill(className) {
      return this.pills.find((props) => props.className?.split(' ').includes(className))
    },
    get primary() {
      return this.pill('dsh-forge-chip-commit')
    },
    get menu() {
      return this.pills.find((props) => props.menu)?.menu
    },
    get alert() {
      const find = (node) => {
        if (!node || typeof node !== 'object') return undefined
        if (Array.isArray(node)) return node.map(find).find(Boolean)
        if (node.props?.role === 'alert') return node.props.children
        return find(node.props?.children)
      }
      return find(tree)
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
      for (const listener of listeners.get('focus') ?? []) listener()
    },
    reset() {
      events.get('connection/reset')?.()
    },
    unmount() {
      for (const hook of hooks) hook?.cleanup?.()
    },
  }
}

const COMMIT = 'dungsil-forge-chip/commit'
const PR = 'dungsil-forge-chip/pr'
const DEFAULT = 'dungsil-forge-chip/default'
const label = (props) => (Array.isArray(props.children) ? props.children.at(-1) : props.children)

await test('변경이 있으면 split 칩의 기본 버튼은 저장된 기본 동작을 대상 세션에서 실행한다', async () => {
  for (const [defaultAction, key, push] of [
    ['commit', 'commit', false],
    ['push', 'commitPush', true],
  ]) {
    const view = await mount({ defaultAction, localDiff: dirty })
    try {
      assert.equal(label(view.primary), locales.en[key])
      assert.equal(view.menu.selectedId, `default-${defaultAction}`)
      view.primary.onClick()
      await tick()
      assert.deepEqual(view.actions, [[COMMIT, { sessionId: 'target-session', push }]])
      await view.refresh()
      assert.ok(view.calls.some(([name, id]) => name === 'refresh' && id === 'target-session'))
    } finally {
      view.unmount()
    }
  }
})

await test('메뉴의 실행 항목은 이번 실행에만 적용하고 기본 동작 항목만 기본값을 저장한다', async () => {
  const view = await mount({ localDiff: dirty })
  try {
    view.menu.onSelect('push')
    await tick()
    await view.refresh()
    assert.deepEqual(view.actions, [[COMMIT, { sessionId: 'target-session', push: true }]])
    assert.equal(label(view.primary), locales.en.commit)
    view.menu.onSelect('default-push')
    await tick()
    await view.refresh()
    assert.deepEqual(view.actions.at(-1), [DEFAULT, { defaultAction: 'push' }])
    assert.equal(view.actions.filter(([method]) => method === COMMIT).length, 1)
    assert.equal(label(view.primary), locales.en.commitPush)
    assert.equal(view.menu.selectedId, 'default-push')
  } finally {
    view.unmount()
  }
})

await test('변경이 없으면 커밋 칩을 숨기고 기능 브랜치에서만 PR 생성을 별도 작업으로 요청한다', async () => {
  const main = await mount({
    panel: panel({ local: { base: 'origin/main' }, checkout: { state: 'ready', checkout: { branch: 'main' } } }),
  })
  try {
    assert.equal(main.tree, null)
  } finally {
    main.unmount()
  }
  const view = await mount({ panel: panel({ local: { base: 'origin/main' } }) })
  try {
    assert.equal(view.primary, undefined)
    const create = view.pill('dsh-forge-chip-create')
    assert.equal(label(create), locales.en.pr)
    create.onClick()
    await tick()
    assert.deepEqual(view.actions, [[PR, { sessionId: 'target-session' }]])
  } finally {
    view.unmount()
  }
})

await test('PR 보기는 현재 브랜치의 열린 PR에만 표시하고 세션 실행 중에도 열 수 있다', async () => {
  const unrelated = await mount({ localDiff: dirty, panel: panel({ changeRequests: [request('other')] }) })
  try {
    assert.equal(unrelated.pill('dsh-forge-chip-view'), undefined)
  } finally {
    unrelated.unmount()
  }
  const view = await mount({
    session: { running: true },
    localDiff: dirty,
    panel: panel({ changeRequests: [request()] }),
  })
  try {
    const open = view.pill('dsh-forge-chip-view')
    assert.equal(label(open), locales.en.viewPr)
    assert.equal(open.disabled, undefined)
    open.onClick()
    assert.deepEqual(view.openedTabs, ['forge-panel'])
    assert.equal(view.actions.length, 0)
  } finally {
    view.unmount()
  }
})

await test('실행 중이거나 제출 대기 중이거나 프롬프트 권한이 없으면 직접 호출해도 Git 작업을 요청하지 않는다', async () => {
  const running = await mount({ localDiff: dirty })
  try {
    running.session.running = true
    await running.refresh()
    // The last read stays visible during a turn but cannot run.
    assert.equal(running.primary.disabled, true)
    assert.equal(running.menu.anchor.props.disabled, true)
    running.primary.onClick()
    running.menu.onSelect('commit')
    await tick()
    assert.equal(running.actions.length, 0)
  } finally {
    running.unmount()
  }
  const pending = await mount({ session: { pendingSubmissions: [{}] }, localDiff: dirty })
  try {
    assert.equal(pending.primary, undefined)
    assert.equal(pending.calls.filter(([name]) => name === 'localDiff').length, 0)
  } finally {
    pending.unmount()
  }
  const denied = await mount({ canPrompt: false, localDiff: dirty })
  try {
    assert.equal(denied.primary.disabled, true)
    denied.primary.onClick()
    await tick()
    assert.equal(denied.actions.length, 0)
  } finally {
    denied.unmount()
  }
})

await test('완료 전 반복 호출해도 한 번만 요청하고 진행 문구를 표시한다', async () => {
  const pending = Promise.withResolvers()
  const view = await mount({ localDiff: dirty, rpc: () => pending.promise })
  try {
    view.primary.onClick()
    view.menu.onSelect('push')
    view.primary.onClick()
    assert.equal(view.actions.length, 1)
    await view.refresh()
    assert.equal(view.primary['aria-busy'], true)
    assert.equal(view.primary.disabled, true)
    assert.equal(label(view.primary), locales.en.committing)
    pending.resolve({ ok: true, value: {} })
    await view.refresh()
    assert.equal(view.primary['aria-busy'], false)
  } finally {
    pending.resolve()
    view.unmount()
  }
})

await test('모든 로케일에서 호스트 오류 코드를 해당 안내 문구로 표시한다', async () => {
  const codes = {
    unavailable: 'errorUnavailable',
    'nothing-to-commit': 'errorNothingToCommit',
    'message-failed': 'errorMessageFailed',
    'commit-failed': 'errorCommitFailed',
    'no-remote': 'errorNoRemote',
    'push-failed': 'errorPushFailed',
    'not-pushed': 'errorNotPushed',
    unsupported: 'errorUnsupported',
    'pr-failed': 'errorPrFailed',
  }
  for (const language of Object.keys(locales)) {
    for (const [code, key] of Object.entries(codes)) {
      const view = await mount({ language, localDiff: dirty, rpc: () => ({ ok: false, error: { code } }) })
      try {
        view.primary.onClick()
        await tick()
        await view.refresh()
        assert.equal(view.alert, locales[language][key])
      } finally {
        view.unmount()
      }
    }
  }
})

await test('연결 초기화와 디렉터리 변경은 이전 스트림을 중단하고 새 프레임 전까지 쓰기를 막는다', async () => {
  const view = await mount({ localDiff: dirty })
  try {
    const initial = view.streams[0]
    view.reset()
    await view.refresh()
    assert.equal(initial.signal.aborted, true)
    assert.ok(initial.value.disposed > 0)
    assert.equal(view.streams.length, 2)
    assert.equal(view.primary.disabled, true)
    initial.value.emit(panel({ changeRequests: [request()] }))
    await view.refresh()
    assert.equal(view.pill('dsh-forge-chip-view'), undefined)
    assert.equal(view.primary.disabled, true)
    view.streams[1].value.emit(panel())
    await view.refresh()
    assert.equal(label(view.primary), locales.en.commit)
    view.setCwd('/other')
    await view.refresh()
    assert.equal(view.streams[1].signal.aborted, true)
    assert.equal(view.streams.length, 3)
  } finally {
    view.unmount()
    assert.ok(view.streams.every(({ signal, value }) => signal.aborted && value.disposed > 0))
  }
})

await test('조회 실패는 Git 작업을 차단하고 포커스로 다시 조회하면 복구한다', async () => {
  const view = await mount({ localDiff: () => ({ ok: false, error: { code: 'unavailable' } }) })
  try {
    assert.equal(label(view.pills[0]), locales.en.lookupError)
    view.setLocalDiff(dirty)
    view.focus()
    await view.refresh()
    assert.equal(view.primary.disabled, false)
  } finally {
    view.unmount()
  }
})

const linked = (overrides = {}) =>
  panel({ checkout: { state: 'ready', checkout: { branch: 'topic', linked: true } }, ...overrides })
const proposal = (overrides = {}) => ({
  source: { root: '/worktree', branch: 'topic', head: 'source-head' },
  target: { root: '/repo', branch: 'main', head: 'target-head' },
  method: 'ff',
  methods: ['ff', 'merge', 'rebase', 'squash'],
  commits: 1,
  blocker: null,
  paths: [],
  ...overrides,
})
const integrationActions = (view) => view.integration?.props.children[0]?.props.children

await test('연결된 워크트리가 아니면 통합 제안을 조회하거나 표시하지 않는다', async () => {
  const view = await mount({ rpc: () => ({ ok: true, value: proposal() }) })
  try {
    assert.equal(view.integration ?? null, null)
    assert.equal(view.rpcs.filter(([method]) => method.startsWith('dungsil-forge-integration/')).length, 0)
  } finally {
    view.unmount()
  }
})

await test('Host가 제안한 통합 칩 하나를 표시하고 실행 요청에 대상 브랜치와 양쪽 HEAD를 그대로 보낸다', async () => {
  const view = await mount({
    panel: linked(),
    rpc: (method) =>
      method.endsWith('/inspect') ? { ok: true, value: proposal() } : { ok: true, value: { method: 'rebase' } },
  })
  try {
    await view.refresh()
    const [primary, menu] = integrationActions(view)
    assert.equal(primary.props.children[1], 'Fast-forward main')
    assert.equal(primary.props.disabled, false)
    assert.deepEqual(
      menu.props.items.map(({ label }) => label),
      ['Fast-forward main', 'Merge into main', 'Rebase onto main', 'Squash into main']
    )
    const integrationRpcs = () => view.rpcs.filter(([method]) => method.startsWith('dungsil-forge-integration/'))
    assert.deepEqual(integrationRpcs(), [['dungsil-forge-integration/inspect', { sessionId: 'target-session' }]])
    menu.props.onSelect('rebase')
    await view.refresh()
    assert.deepEqual(
      integrationRpcs()
        .filter(([method]) => method.endsWith('/run'))
        .at(-1)[1],
      {
        sessionId: 'target-session',
        method: 'rebase',
        targetBranch: 'main',
        targetHead: 'target-head',
        sourceHead: 'source-head',
      }
    )
    assert.equal(view.integration.props.children[2].props.children, 'Integrated into main.')
    assert.equal(view.actions.filter(([method]) => !method.startsWith('dungsil-forge-integration/')).length, 0)
  } finally {
    view.unmount()
  }
})

await test('통합을 실행할 수 없으면 칩을 비활성 상태로 유지하고 모든 로케일에서 이유를 표시한다', async () => {
  for (const language of Object.keys(locales)) {
    const view = await mount({
      language,
      panel: linked(),
      rpc: (method) =>
        method.endsWith('/inspect')
          ? { ok: true, value: proposal({ blocker: 'overlap', paths: ['a.txt', 'b.txt'] }) }
          : assert.fail('A blocked integration must not run'),
    })
    try {
      await view.refresh()
      const [primary, menu] = integrationActions(view)
      assert.equal(primary.props.disabled, true)
      assert.equal(menu.props.anchor.props.disabled, true)
      primary.props.onClick()
      menu.props.onSelect('merge')
      assert.equal(
        view.integration.props.children[1].props.children,
        locales[language].blockedOverlap.replace('{paths}', 'a.txt, b.txt')
      )
    } finally {
      view.unmount()
    }
  }
})

await test('통합 실패 응답의 진단을 경고와 함께 보여준다', async () => {
  const view = await mount({
    panel: linked(),
    rpc: (method) =>
      method.endsWith('/inspect')
        ? { ok: true, value: proposal() }
        : { ok: false, error: { code: 'cleanup-refused', message: '', details: { diagnostic: 'MERGE_HEAD' } } },
  })
  try {
    await view.refresh()
    integrationActions(view)[0].props.onClick()
    await view.refresh()
    const notice = view.integration.props.children[2].props
    assert.equal(notice.role, 'alert')
    assert.equal(notice.children, locales.en.integrationCleanupRefused)
    assert.equal(notice.title, 'MERGE_HEAD')
  } finally {
    view.unmount()
  }
})

const localReads = (view) => view.calls.filter(([name]) => name === 'localDiff').length

await test('세션을 다시 열면 캐시한 패널을 즉시 표시하고 같은 사실의 변경을 다시 조회하지 않는다', async () => {
  const view = await mount({ localDiff: dirty, panel: panel({ changeRequests: [request()] }) })
  try {
    assert.equal(localReads(view), 1)
    view.setSessionId('other-session')
    await view.refresh()
    view.setSessionId('target-session')
    await view.refresh()
    assert.equal(label(view.pill('dsh-forge-chip-view')), locales.en.viewPr)
    assert.equal(view.primary.disabled, true)
    view.setPanel(panel({ changeRequests: [request()] }))
    await view.refresh()
    assert.equal(view.primary.disabled, false)
    assert.equal(localReads(view), 1)
  } finally {
    view.unmount()
  }
})

await test('같은 사실의 패널 프레임이 반복되면 변경을 다시 조회하지 않고 포커스와 관찰한 턴 종료로만 갱신한다', async () => {
  const view = await mount({ localDiff: dirty })
  try {
    assert.equal(localReads(view), 1)
    view.setPanel(panel())
    await view.refresh()
    assert.equal(localReads(view), 1)
    view.focus()
    await view.refresh()
    assert.equal(localReads(view), 2)
    view.session.running = true
    await view.refresh()
    view.session.running = false
    await view.refresh()
    assert.equal(localReads(view), 3)
  } finally {
    view.unmount()
  }
})

await test('단축키는 표시된 순서의 칩을 실행하고 메뉴가 열려 있거나 비활성이면 실행하지 않는다', async () => {
  const view = await mount({ localDiff: dirty, panel: panel({ changeRequests: [request()] }) })
  try {
    const resolve = (n, secondary = false) =>
      view.commands.get(`dungsil.forge-chip.${secondary ? 'alternate' : 'action'}-${n}`).resolve()
    assert.equal(resolve(1, true).status, 'pass')
    assert.equal(resolve(5).status, 'pass')
    view.menu.anchor.props.onClick()
    await view.refresh()
    assert.equal(resolve(1).status, 'blocked')
    view.menu.onClose()
    await view.refresh()
    resolve(1).run()
    await tick()
    assert.deepEqual(view.actions, [[COMMIT, { sessionId: 'target-session', push: false }]])
    await view.refresh()
    view.session.pendingSubmissions = [{}]
    await view.refresh()
    assert.equal(resolve(1).status, 'blocked')
    assert.equal(view.actions.length, 1)
  } finally {
    view.unmount()
  }
})

await test('PR 보기와 검사 칩은 보조 단축키와 Shift+클릭으로 브라우저에서 PR을 연다', async () => {
  const view = await mount({ panel: panel({ changeRequests: [request()] }) })
  try {
    const url = request().url
    view.pill('dsh-forge-chip-view').onClick({ shiftKey: true })
    view.commands.get('dungsil.forge-chip.alternate-2').resolve().run()
    assert.deepEqual(view.opened, [url, url])
    view.pill('dsh-forge-chip-checks').onClick({ shiftKey: false })
    assert.deepEqual(view.openedTabs, ['forge-panel'])
  } finally {
    view.unmount()
  }
})
