import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const bundle = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

function mount(language = 'en') {
  const hooks = [],
    effects = [],
    calls = [],
    registrations = new Map(),
    cleanups = []
  const opens = []
  const listeners = new Map()
  const visibilityListeners = new Map()
  const intervals = new Set()
  const page = {
    visibilityState: 'visible',
    addEventListener: (name, listener) => visibilityListeners.set(name, listener),
    removeEventListener: (name, listener) => {
      if (visibilityListeners.get(name) === listener) visibilityListeners.delete(name)
    },
    createElement: () => ({
      style: {},
      remove() {
        this.removed = true
      },
    }),
  }
  const session = { running: false, cwd: '/repo' }
  const hosts = []
  let cursor = 0,
    plugin,
    mounted = 'session',
    listener
  class Element {
    closest() {
      return this
    }
    getAttribute() {
      return this.href
    }
    hasAttribute() {
      return false
    }
  }
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
    useMemo: (compute) => compute(),
    useId: () => 'requests',
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useEffect(effect, deps) {
      const index = cursor++
      const previous = hooks[index]
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        effects.push(() => {
          previous?.cleanup?.()
          hooks[index] = { deps, cleanup: effect() }
        })
      }
    },
  }
  const jsx = (type, props) => ({ type, props })
  runInNewContext(bundle, {
    AbortController,
    AbortSignal,
    URL,
    Element,
    document: page,
    window: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: (name, listener) => {
        if (listeners.get(name) === listener) listeners.delete(name)
      },
      setInterval: (callback) => {
        intervals.add(callback)
        return callback
      },
      clearInterval: (callback) => intervals.delete(callback),
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id === 'react') return react
            if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
            if (id === 'react-dom') return { createPortal: (children) => children }
            if (id === '@deepseek-ai/dsh-client-ui-primitives')
              return {
                IconBranchOutlineRegular: 'branch',
              }
            throw new Error(`Unexpected dependency: ${id}`)
          })
        },
      },
    },
  })
  const ctx = {
    get: () => ({
      list: { getSnapshot: () => ({ byId: { session, other: session } }), subscribe: () => () => {} },
      rpc: {
        call: (_channel, method, payload, signal) =>
          new Promise((resolve, reject) => {
            calls.push({ method, payload, signal, resolve, reject })
          }),
      },
    }),
    locale: { getSnapshot: () => ({ active: language }), subscribe: () => () => {} },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, body) => registrations.set(`${options.name}:${options.id ?? options.key}`, body),
    },
    sidebarRight: {
      mounted: { getSnapshot: () => mounted, subscribe: () => () => {} },
      openTab: (kind, options) => opens.push({ kind, options }),
    },
    sidebarRightTabs: { register: () => () => {} },
    effect: (effect, label) => {
      if (!label) cleanups.push(effect())
    },
  }
  assert.deepEqual(Object.keys(plugin).sort(), ['apply', 'inject', 'name'])
  assert.equal(plugin.name, 'dungsil-forge-pulls')
  assert.ok(plugin.inject.includes('sessions'))
  plugin.apply(ctx)
  assert.equal(registrations.has('conversation.input.dock:dungsil-forge-pulls'), false)
  const tab = {
    visible: true,
    signal: new AbortController().signal,
    navigation: { revision: 1, params: { requestUrl: 'https://github.com/team/repo/pull/42#discussion' } },
    actions: { bindCommands: () => () => {} },
  }
  const render = () => {
    cursor = 0
    const tree = registrations.get('sidebar.right.pane.tab:dungsil-forge-pulls')({
      sessionId: 'session',
      useTabInfo: () => ({ tab }),
      useSession: () => false,
    })
    for (const effect of effects.splice(0)) effect()
    return tree
  }
  const dispose = () => {
    for (const hook of hooks) hook?.cleanup?.()
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup()
  }
  const renderLinks = () => {
    cursor = 0
    const tree = registrations.get('conversation.input.dock:dungsil-forge-pulls-links')({ sessionId: 'session' })
    tree.props.ref.current = {
      closest: () => ({
        getAttribute: () => 'session',
        contains: () => true,
        addEventListener: (_name, callback) => {
          listener = callback
        },
        removeEventListener: () => {
          listener = undefined
        },
      }),
    }
    for (const effect of effects.splice(0)) effect()
  }
  const renderBadge = (sessionId = 'session') => {
    cursor = 0
    const tree = registrations.get('sidebar.workspaces.session.row.action:dungsil-forge-pulls-status')({
      sessionId,
    })
    tree.props.children[0].props.ref.current = {
      closest: () => ({
        getAttribute: () => `session:${sessionId}`,
        lastElementChild: {},
        insertBefore: (host) => hosts.push(host),
      }),
    }
    for (const effect of effects.splice(0)) effect()
    return tree.props.children[1] || null
  }
  const click = (href) => {
    const target = new Element()
    target.href = href
    const event = {
      target,
      button: 0,
      preventDefault() {
        this.defaultPrevented = true
      },
      stopPropagation() {
        this.stopped = true
      },
    }
    listener(event)
    return event
  }
  return {
    calls,
    tab,
    render,
    dispose,
    renderLinks,
    renderBadge,
    session,
    hosts,
    intervals,
    visibilityListeners,
    focus: () => listeners.get('focus')?.(),
    setVisibility: (value) => {
      page.visibilityState = value
      visibilityListeners.get('visibilitychange')?.()
    },
    setLanguage: (value) => {
      language = value
    },
    click,
    opens,
    setMounted: (value) => {
      mounted = value
    },
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))
const request = (number) => ({
  provider: 'github',
  repository: 'github.com/team/repo',
  branch: 'feature',
  request: {
    number,
    title: `Request ${number}`,
    url: `https://github.com/team/repo/pull/${number}`,
    source: 'feature',
    target: 'main',
    state: 'open',
    headSha: 'a'.repeat(40),
    mergeable: 'MERGEABLE',
    reviewDecision: '',
    body: '',
    diff: '',
    checks: [],
    files: [],
    comments: [],
    reviews: [],
  },
})

await test('세션 배지는 모든 로케일에서 MR 상태를 구분하고, 없거나 실패한 연결은 숨긴다', async () => {
  const fixture = mount()
  const icons = new Set()
  try {
    assert.equal(fixture.renderBadge(), null)
    for (const [state, draft, labels] of [
      ['open', false, ['Open', '열림', '开放']],
      ['open', true, ['Draft', '초안', '草稿']],
      ['merged', true, ['Merged', '병합됨', '已合并']],
      ['closed', true, ['Closed', '닫힘', '已关闭']],
    ]) {
      const view = request(17)
      view.provider = 'gitlab'
      Object.assign(view.request, { state, draft })
      fixture.calls.at(-1).resolve({ ok: true, value: view })
      await settle()
      for (const [index, language] of ['en', 'ko', 'zh'].entries()) {
        fixture.setLanguage(language)
        const badge = fixture.renderBadge()
        assert.equal(badge.props.role, 'img')
        assert.equal(badge.props['data-state'], state === 'open' && draft ? 'draft' : state)
        assert.ok(badge.props['aria-label'].includes(`!17: ${labels[index]}`), badge.props['aria-label'])
        const svg = badge.props.dangerouslySetInnerHTML.__html
        assert.match(svg, /^<svg /)
        icons.add(svg)
      }
      fixture.focus()
    }
    assert.equal(icons.size, 4)
    fixture.calls.at(-1).resolve({ ok: true, value: { ...request(17), request: null } })
    await settle()
    assert.equal(fixture.renderBadge(), null)
    fixture.focus()
    fixture.calls.at(-1).resolve({ ok: false, error: { code: 'cli_missing' } })
    await settle()
    assert.equal(fixture.renderBadge(), null)
  } finally {
    fixture.dispose()
  }
  assert.equal(fixture.intervals.size, 0)
  assert.ok(fixture.hosts.every((host) => host.removed))
})

await test('현재 화면의 세션만 조회하고 다른 세션이나 전역 화면으로 이동하면 이전 조회를 취소한다', async () => {
  const fixture = mount()
  try {
    fixture.renderBadge('other')
    fixture.focus()
    assert.equal(fixture.calls.length, 0)
    assert.equal(fixture.intervals.size, 0)
    fixture.renderBadge()
    assert.equal(fixture.calls.length, 1)
    const previous = fixture.calls[0]
    fixture.setMounted('other')
    assert.equal(fixture.renderBadge(), null)
    assert.equal(previous.signal.aborted, true)
    assert.equal(fixture.intervals.size, 0)
    fixture.focus()
    assert.equal(fixture.calls.length, 1)
    previous.resolve({ ok: true, value: request(42) })
    await settle()
    assert.equal(fixture.renderBadge(), null)
    fixture.renderBadge('other')
    assert.equal(fixture.calls.length, 2)
    assert.equal(fixture.calls[1].payload.sessionId, 'other')
    fixture.setMounted(undefined)
    fixture.renderBadge('other')
    assert.equal(fixture.calls[1].signal.aborted, true)
    assert.equal(fixture.intervals.size, 0)
  } finally {
    fixture.dispose()
  }
})

await test('세션 배지는 실행 중 기존 상태를 유지하고 조회를 멈추며 실행 종료와 디렉터리 변경 후 새로 고친다', async () => {
  const fixture = mount()
  try {
    fixture.renderBadge()
    fixture.calls[0].resolve({ ok: true, value: request(42) })
    await settle()
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#42'))
    fixture.session.running = true
    fixture.renderBadge()
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#42'))
    assert.equal(fixture.intervals.size, 0)
    fixture.focus()
    fixture.setVisibility('hidden')
    fixture.setVisibility('visible')
    assert.equal(fixture.calls.length, 1)
    fixture.session.running = false
    fixture.renderBadge()
    assert.equal(fixture.calls.length, 2)
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#42'))
    const old = fixture.calls.at(-1)
    fixture.session.cwd = '/different-repo'
    fixture.renderBadge()
    assert.equal(old.signal.aborted, true)
    fixture.calls.at(-1).resolve({ ok: true, value: request(43) })
    old.resolve({ ok: true, value: request(42) })
    await settle()
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#43'))
    for (const refresh of fixture.intervals) refresh()
    const periodic = fixture.calls.at(-1)
    fixture.setMounted('other')
    fixture.renderBadge('other')
    assert.equal(periodic.signal.aborted, true)
    periodic.resolve({ ok: true, value: request(44) })
    fixture.calls.at(-1).resolve({ ok: true, value: { ...request(45), request: null } })
    await settle()
    assert.equal(fixture.renderBadge('other'), null)
    assert.ok(fixture.calls.every((call) => call.payload.summary === true && !call.payload.requestUrl))
  } finally {
    fixture.dispose()
  }
})

await test('세션 배지는 조회 중 focus와 주기 갱신이 몰려도 요청을 중단하거나 중복하지 않는다', async () => {
  const fixture = mount()
  try {
    fixture.renderBadge()
    const first = fixture.calls[0]
    for (let index = 0; index < 5; index++) {
      fixture.focus()
      for (const refresh of fixture.intervals) refresh()
    }
    assert.equal(fixture.calls.length, 1)
    assert.equal(first.signal.aborted, false)
    first.resolve({ ok: true, value: request(42) })
    await settle()
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#42'))
    assert.equal(fixture.calls.length, 1)
    fixture.focus()
    const second = fixture.calls[1]
    fixture.focus()
    for (const refresh of fixture.intervals) refresh()
    assert.equal(fixture.calls.length, 2)
    assert.equal(second.signal.aborted, false)
    second.reject(new Error('unavailable'))
    await settle()
    assert.equal(fixture.renderBadge(), null)
    for (const refresh of fixture.intervals) refresh()
    assert.equal(fixture.calls.length, 3)
  } finally {
    fixture.dispose()
  }
  assert.equal(fixture.calls.at(-1).signal.aborted, true)
  assert.equal(fixture.intervals.size, 0)
  assert.equal(fixture.visibilityListeners.size, 0)
})

await test('세션 배지는 숨겨진 탭의 초기 조회와 자동 갱신을 미루고 다시 보일 때만 새로 고친다', async () => {
  const fixture = mount()
  try {
    fixture.setVisibility('hidden')
    fixture.renderBadge()
    fixture.focus()
    for (const refresh of fixture.intervals) refresh()
    assert.equal(fixture.calls.length, 0)
    fixture.setVisibility('visible')
    const first = fixture.calls[0]
    fixture.focus()
    for (const refresh of fixture.intervals) refresh()
    assert.equal(fixture.calls.length, 1)
    fixture.setVisibility('hidden')
    assert.equal(first.signal.aborted, false)
    first.resolve({ ok: true, value: request(42) })
    await settle()
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#42'))
    fixture.focus()
    for (const refresh of fixture.intervals) refresh()
    assert.equal(fixture.calls.length, 1)
    fixture.setVisibility('visible')
    assert.equal(fixture.calls.length, 2)
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#42'))
  } finally {
    fixture.dispose()
  }
  assert.equal(fixture.visibilityListeners.size, 0)
})

await test('세션 배지는 실행 중 처음 마운트되면 조회하지 않고 실행 시작이나 마운트 해제 뒤 도착한 이전 응답을 버린다', async () => {
  const fixture = mount()
  try {
    fixture.session.running = true
    fixture.renderBadge()
    fixture.focus()
    assert.equal(fixture.calls.length, 0)
    assert.equal(fixture.intervals.size, 0)
    fixture.session.running = false
    fixture.renderBadge()
    const first = fixture.calls[0]
    const refresh = [...fixture.intervals][0]
    fixture.session.running = true
    fixture.renderBadge()
    assert.equal(first.signal.aborted, true)
    first.resolve({ ok: true, value: request(41) })
    await settle()
    assert.equal(fixture.renderBadge(), null)
    refresh()
    fixture.focus()
    assert.equal(fixture.calls.length, 1)
    fixture.session.running = false
    fixture.renderBadge()
    fixture.calls[1].resolve({ ok: true, value: request(42) })
    await settle()
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#42'))
    fixture.focus()
    const last = fixture.calls.at(-1)
    const staleRefresh = [...fixture.intervals][0]
    fixture.dispose()
    assert.equal(last.signal.aborted, true)
    last.resolve({ ok: true, value: request(43) })
    await settle()
    staleRefresh()
    assert.equal(fixture.calls.length, 3)
    assert.ok(fixture.renderBadge().props['aria-label'].includes('#42'))
  } finally {
    fixture.dispose()
  }
})

function texts(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(texts).join(' ')
  return texts(node?.props?.children ?? '')
}
function links(node) {
  if (Array.isArray(node)) return node.flatMap(links)
  if (!node?.props) return []
  return [...(node.type === 'a' ? [node.props] : []), ...links(node.props.children)]
}

await test('배포된 클라이언트는 마운트된 세션에 대해서만 대화의 PR 링크를 사이드바로 라우팅한다', () => {
  const fixture = mount()
  try {
    fixture.renderLinks()
    const event = fixture.click('https://github.com/team/repo/pull/42/files#discussion')
    assert.equal(event.defaultPrevented, true)
    assert.equal(event.stopped, true)
    assert.equal(fixture.opens.length, 1)
    assert.equal(fixture.opens[0].kind, 'dungsil-forge-pulls')
    assert.equal(fixture.opens[0].options.params.requestUrl, 'https://github.com/team/repo/pull/42')
    fixture.setMounted('different-session')
    assert.equal(fixture.click('https://github.com/team/repo/pull/43').defaultPrevented, undefined)
    assert.equal(fixture.opens.length, 1)
  } finally {
    fixture.dispose()
  }
})

await test('사이드바 탐색은 클릭한 PR을 가져오고, 다른 링크가 열린 뒤 도착한 이전 응답은 버린다', async () => {
  const fixture = mount()
  try {
    fixture.render()
    assert.equal(fixture.calls.length, 1)
    assert.equal(fixture.calls[0].payload.requestUrl, 'https://github.com/team/repo/pull/42')
    assert.equal(fixture.calls[0].payload.summary, true)
    fixture.tab.navigation = { revision: 2, params: { requestUrl: 'https://github.com/team/repo/pull/43/files' } }
    fixture.render()
    assert.equal(fixture.calls[0].signal.aborted, true)
    assert.equal(fixture.calls[1].payload.requestUrl, 'https://github.com/team/repo/pull/43')
    fixture.calls[1].resolve({ ok: true, value: request(43) })
    await settle()
    assert.equal(fixture.calls[2].payload.requestUrl, 'https://github.com/team/repo/pull/43')
    assert.equal(fixture.calls[2].payload.summary, false)
    fixture.calls[0].resolve({ ok: true, value: request(42) })
    await settle()
    const tree = fixture.render()
    assert.ok(texts(tree).includes('Request 43'))
    assert.ok(!texts(tree).includes('Request 42'))
    fixture.tab.navigation = { revision: 3, params: undefined }
    fixture.render()
    assert.equal(fixture.calls[2].signal.aborted, true)
    assert.equal(fixture.calls[3].payload.requestUrl, undefined)
    assert.equal(fixture.calls[3].payload.summary, true)
    assert.ok(!texts(fixture.render()).includes('Request 43'))
    fixture.calls[2].resolve({ ok: true, value: request(44) })
    await settle()
    assert.ok(!texts(fixture.render()).includes('Request 44'))
    fixture.calls[3].resolve({ ok: true, value: request(44) })
    await settle()
    assert.ok(texts(fixture.render()).includes('Request 44'))
    fixture.tab.navigation = { revision: 4, params: { requestUrl: 'https://github.com/team/repo/pull/43' } }
    fixture.render()
    const cached = texts(fixture.render())
    assert.ok(cached.includes('Request 43'))
    assert.ok(!cached.includes('Request 44'))
    assert.equal(fixture.calls.at(-1).payload.requestUrl, 'https://github.com/team/repo/pull/43')
    assert.equal(fixture.calls.at(-1).payload.summary, false)
  } finally {
    fixture.dispose()
  }
})

await test('CI 탐색은 첫 로드에서 검사를 열고, 이미 마운트된 PR 패널에서 다시 연다', async () => {
  const fixture = mount()
  const find = (node, predicate) => {
    if (Array.isArray(node)) return node.flatMap((child) => find(child, predicate))
    if (!node?.props) return []
    return [...(predicate(node.props) ? [node.props] : []), ...find(node.props.children, predicate)]
  }
  try {
    fixture.tab.navigation = { revision: 1, params: { section: 'checks' } }
    fixture.render()
    fixture.calls[0].resolve({ ok: true, value: request(42) })
    await settle()
    fixture.calls[1].resolve({ ok: true, value: request(42) })
    await settle()
    let tree = fixture.render()
    assert.equal(find(tree, (props) => props.className === 'dsh-forge-pulls-ci-results').length, 1)
    find(tree, (props) => props.className === 'dsh-forge-pulls-ci-trigger')[0].onClick()
    tree = fixture.render()
    assert.equal(find(tree, (props) => props.className === 'dsh-forge-pulls-ci-results').length, 0)
    fixture.tab.navigation = { revision: 2, params: { section: 'checks' } }
    fixture.render()
    tree = fixture.render()
    assert.equal(find(tree, (props) => props.className === 'dsh-forge-pulls-ci-results').length, 1)
    assert.equal(find(tree, (props) => props.className === 'dsh-forge-pulls-ci-trigger')[0]['aria-expanded'], true)
  } finally {
    fixture.dispose()
  }
})

await test('지원하지 않는 링크 요청은 로케일에 맞는 피드백을 보여 주고 원래 외부 링크를 유지한다', async () => {
  for (const [language, expected] of [
    ['en', 'outside'],
    ['ko', '원격 저장소'],
    ['zh', '远程仓库'],
  ]) {
    const fixture = mount(language)
    try {
      fixture.render()
      fixture.calls[0].resolve({ ok: false, error: { code: 'unsupported' } })
      await settle()
      const tree = fixture.render()
      const text = texts(tree)
      assert.ok(text.includes(expected), language)
      const anchors = links(tree)
      assert.equal(anchors.length, 1, language)
      const [link] = anchors
      assert.equal(link.href, 'https://github.com/team/repo/pull/42', language)
      assert.equal(link.children, link.href, language)
      assert.equal(link.target, '_blank', language)
      assert.equal(link.rel, 'noopener noreferrer', language)
      assert.ok(!text.includes('Request 42'), language)
    } finally {
      fixture.dispose()
    }
  }
})

function findByClass(node, className) {
  if (Array.isArray(node)) return node.flatMap((child) => findByClass(child, className))
  if (!node?.props) return []
  return [...(node.props.className === className ? [node.props] : []), ...findByClass(node.props.children, className)]
}

await test('Forge가 squash를 허용하지 않으면 허용된 병합 방식을 선택하고 해당 방식만 제출한다', async () => {
  const fixture = mount()
  try {
    const view = request(42)
    Object.assign(view.request, { diff: '+change', mergeMethods: ['merge'], forgeMergeReady: true })
    fixture.render()
    fixture.calls[0].resolve({ ok: true, value: view })
    await settle()
    fixture.calls[1].resolve({ ok: true, value: view })
    await settle()
    const menu = findByClass(fixture.render(), 'dsh-forge-pulls-merge-menu')[0]
    assert.deepEqual(
      Array.from(menu.items, (item) => item.id),
      ['merge']
    )
    assert.equal(menu.selectedId, 'merge')
    assert.equal(menu.anchor.props.children[0].props.disabled, false)
    menu.anchor.props.children[0].props.onClick()
    const confirmation = findByClass(fixture.render(), 'dsh-forge-pulls-confirm')[0]
    confirmation.footer.props.children[1].props.onClick()
    assert.equal(fixture.calls.at(-1).payload.action, 'merge')
    assert.equal(fixture.calls.at(-1).payload.strategy, 'merge')
    fixture.calls.at(-1).resolve({ ok: true })
    await settle()
  } finally {
    fixture.dispose()
  }
})

await test('Forge가 병합을 차단하거나 허용된 병합 방식이 없으면 병합 버튼을 비활성화한다', async () => {
  for (const fields of [{ forgeMergeReady: false }, { mergeMethods: [] }]) {
    const fixture = mount()
    try {
      const view = request(42)
      Object.assign(view.request, { diff: '+change', ...fields })
      fixture.render()
      fixture.calls[0].resolve({ ok: true, value: view })
      await settle()
      fixture.calls[1].resolve({ ok: true, value: view })
      await settle()
      const menu = findByClass(fixture.render(), 'dsh-forge-pulls-merge-menu')[0]
      assert.equal(menu.anchor.props.children[0].props.disabled, true)
      assert.equal(menu.anchor.props.children[1].props.disabled, true)
    } finally {
      fixture.dispose()
    }
  }
})
