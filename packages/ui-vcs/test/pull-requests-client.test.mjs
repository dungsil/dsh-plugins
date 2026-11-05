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
      if (!(index in hooks)) hooks[index] = initial
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
    document: { createElement: () => ({}) },
    window: {
      addEventListener() {},
      removeEventListener() {},
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id === 'react') return react
            if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
            if (id === '@deepseek-ai/dsh-client-ui-primitives') return {}
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
          new Promise((resolve) => {
            calls.push({ method, payload, signal, resolve })
          }),
      },
    }),
    locale: { getSnapshot: () => ({ active: language }), subscribe: () => () => {} },
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, body) => registrations.set(`${options.name}:${options.id ?? options.key}`, body),
    },
    sidebarRight: {
      mounted: { getSnapshot: () => mounted },
      openTab: (kind, options) => opens.push({ kind, options }),
    },
    sidebarRightTabs: { register: () => () => {} },
    effect: (effect, label) => {
      if (!label) cleanups.push(effect())
    },
    plugin(sub) {
      sub.apply(ctx)
    },
  }
  plugin.apply(ctx)
  const tab = {
    visible: true,
    signal: new AbortController().signal,
    navigation: { revision: 1, params: { requestUrl: 'https://github.com/team/repo/pull/42#discussion' } },
    actions: { bindCommands: () => () => {} },
  }
  const render = () => {
    cursor = 0
    const tree = registrations.get('sidebar.right.pane.tab:dungsil-vcs-pull-requests')({
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
    const tree = registrations.get('conversation.input.dock:dungsil-vcs-pull-requests-links')({ sessionId: 'session' })
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

await test('the shipped client routes conversation PR links into its sidebar only for the mounted session', () => {
  const fixture = mount()
  try {
    fixture.renderLinks()
    const event = fixture.click('https://github.com/team/repo/pull/42/files#discussion')
    assert.equal(event.defaultPrevented, true)
    assert.equal(event.stopped, true)
    assert.equal(fixture.opens.length, 1)
    assert.equal(fixture.opens[0].kind, 'dungsil-vcs-pull-requests')
    assert.equal(fixture.opens[0].options.params.requestUrl, 'https://github.com/team/repo/pull/42')
    fixture.setMounted('different-session')
    assert.equal(fixture.click('https://github.com/team/repo/pull/43').defaultPrevented, undefined)
    assert.equal(fixture.opens.length, 1)
  } finally {
    fixture.dispose()
  }
})

await test('sidebar navigations fetch the clicked PR and discard an older response after another link opens', async () => {
  const fixture = mount()
  try {
    fixture.render()
    assert.equal(fixture.calls.length, 1)
    assert.equal(fixture.calls[0].payload.requestUrl, 'https://github.com/team/repo/pull/42')
    fixture.tab.navigation = { revision: 2, params: { requestUrl: 'https://github.com/team/repo/pull/43/files' } }
    fixture.render()
    assert.equal(fixture.calls[0].signal.aborted, true)
    assert.equal(fixture.calls[1].payload.requestUrl, 'https://github.com/team/repo/pull/43')
    fixture.calls[1].resolve({ ok: true, value: request(43) })
    await settle()
    fixture.calls[0].resolve({ ok: true, value: request(42) })
    await settle()
    const tree = fixture.render()
    assert.ok(texts(tree).includes('Request 43'))
    assert.ok(!texts(tree).includes('Request 42'))
    fixture.tab.navigation = { revision: 3, params: undefined }
    fixture.render()
    assert.equal(fixture.calls[2].payload.requestUrl, undefined)
    fixture.calls[2].resolve({ ok: true, value: request(44) })
    await settle()
    assert.ok(texts(fixture.render()).includes('Request 44'))
  } finally {
    fixture.dispose()
  }
})

await test('unsupported linked requests show localized feedback and retain the original external link', async () => {
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
