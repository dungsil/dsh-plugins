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
  const page = {
    createElement: () => ({
      style: {},
      remove() {
        this.removed = true
      },
    }),
  }
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
  assert.ok(!plugin.inject.includes('sessions'))
  plugin.apply(ctx)
  assert.equal(registrations.has('conversation.input.dock:dungsil-forge-pulls'), false)
  // The official Forge panel owns Session list request glyphs.
  assert.equal(registrations.has('sidebar.workspaces.session.row.action:dungsil-forge-pulls-status'), false)
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
    focus: () => listeners.get('focus')?.(),
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
    body: '',
    comments: [],
    reviews: [],
  },
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

function findByType(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => findByType(child, type))
  if (!node?.props) return []
  return [...(node.type === type ? [node.props] : []), ...findByType(node.props.children, type)]
}

async function openReview(fixture, fields = {}) {
  const view = request(42)
  Object.assign(view.request, fields)
  fixture.render()
  fixture.calls[0].resolve({ ok: true, value: view })
  await settle()
  fixture.calls[1].resolve({ ok: true, value: view })
  await settle()
  findByClass(fixture.render(), 'dsh-forge-pulls-tabs')[0].children.props.onChange('conversation')
  return view
}

const submitReview = (tree) => {
  let prevented = false
  findByType(tree, 'form')[0].onSubmit({
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
}

await test('리뷰 폼은 모든 로케일에서 추가 확인 없이 댓글과 표시된 SHA를 즉시 한 번 전송한다', async () => {
  for (const [language, label] of [
    ['en', 'Submit review'],
    ['ko', '리뷰 제출'],
    ['zh', '提交审查'],
  ]) {
    const fixture = mount(language)
    try {
      const view = await openReview(fixture)
      findByType(fixture.render(), 'textarea')[0].onChange({ target: { value: '  확인한 내용입니다  ' } })
      const tree = fixture.render()
      assert.ok(texts(tree).includes(label), language)
      const before = fixture.calls.length
      submitReview(tree)
      assert.equal(fixture.calls.length, before + 1)
      const action = fixture.calls.at(-1)
      assert.deepEqual(JSON.parse(JSON.stringify(action.payload)), {
        sessionId: 'session',
        requestUrl: view.request.url,
        headSha: view.request.headSha,
        action: 'comment',
        body: '확인한 내용입니다',
      })
      assert.equal(findByClass(fixture.render(), 'dsh-forge-pulls-confirm').length, 0)
      action.resolve({ ok: true })
      await settle()
      assert.equal(findByType(fixture.render(), 'textarea')[0].value, '')
      assert.equal(fixture.calls.length, before + 1)
    } finally {
      fixture.dispose()
    }
  }
})

await test('리뷰 제출 중 연속 제출을 차단하고 실패 응답이나 연결 오류 후에는 자동 재시도하지 않는다', async () => {
  for (const reject of [false, true]) {
    const fixture = mount()
    try {
      await openReview(fixture)
      findByType(fixture.render(), 'textarea')[0].onChange({ target: { value: '검토 의견' } })
      const tree = fixture.render()
      const before = fixture.calls.length
      submitReview(tree)
      const action = fixture.calls.at(-1)
      submitReview(tree)
      submitReview(fixture.render())
      fixture.focus()
      assert.equal(findByType(fixture.render(), 'textarea')[0].disabled, true)
      assert.equal(fixture.calls.length, before + 1)
      if (reject) action.reject(new Error('connection lost'))
      else action.resolve({ ok: false, error: { code: 'command_failed' } })
      await settle()
      const failed = fixture.render()
      assert.ok(texts(failed).includes('The action could not be confirmed'))
      assert.equal(findByType(failed, 'textarea')[0].value, '검토 의견')
      submitReview(failed)
      await settle()
      fixture.render()
      assert.equal(fixture.calls.length, before + 1)
      assert.equal(findByClass(fixture.render(), 'dsh-forge-pulls-confirm').length, 0)
    } finally {
      fixture.dispose()
    }
  }
})

await test('초안 PR의 승인은 선택 항목과 제출 버튼에서 차단하고 폼을 직접 제출해도 전송하지 않는다', async () => {
  const fixture = mount()
  try {
    await openReview(fixture, { draft: true })
    const picker = findByClass(fixture.render(), 'dsh-forge-pulls-picker')[0]
    assert.equal(picker.items.find((item) => item.id === 'approve').disabled, true)
    picker.onChange('approve')
    const tree = fixture.render()
    const form = findByType(tree, 'form')[0]
    assert.equal(form.children.at(-1).props.children.at(-1).props.disabled, true)
    const before = fixture.calls.length
    submitReview(tree)
    assert.equal(fixture.calls.length, before)
    assert.equal(findByClass(fixture.render(), 'dsh-forge-pulls-confirm').length, 0)
  } finally {
    fixture.dispose()
  }
})

await test('빈 댓글과 공백뿐인 댓글은 제출 버튼에서 차단하고 폼을 직접 제출해도 전송하지 않는다', async () => {
  const fixture = mount()
  try {
    await openReview(fixture)
    for (const body of ['', ' \n\t ']) {
      findByType(fixture.render(), 'textarea')[0].onChange({ target: { value: body } })
      const tree = fixture.render()
      const form = findByType(tree, 'form')[0]
      assert.equal(form.children.at(-1).props.children.at(-1).props.disabled, true)
      const before = fixture.calls.length
      submitReview(tree)
      assert.equal(fixture.calls.length, before)
    }
  } finally {
    fixture.dispose()
  }
})

await test('개요와 댓글·리뷰 탭만 제공하고 CI, 변경 내용, 병합 UI는 표시하지 않는다', async () => {
  const fixture = mount()
  try {
    await openReview(fixture)
    const tree = fixture.render()
    const tabs = findByClass(tree, 'dsh-forge-pulls-tabs')[0].children.props.items
    assert.deepEqual(
      Array.from(tabs, (item) => item.value),
      ['overview', 'conversation']
    )
    for (const className of [
      'dsh-forge-pulls-ci-trigger',
      'dsh-forge-pulls-merge-footer',
      'dsh-forge-pulls-merge-menu',
    ])
      assert.equal(findByClass(tree, className).length, 0, className)
    assert.ok(!fixture.calls.some((call) => call.payload.action === 'merge'))
  } finally {
    fixture.dispose()
  }
})
