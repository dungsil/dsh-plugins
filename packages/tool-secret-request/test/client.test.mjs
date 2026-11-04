import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

await test('approval identifies the server-bound target separately from misleading agent text in every locale', async () => {
  for (const [locale, label] of [
    ['en', 'Credential storage reference'],
    ['ko', '비밀값 저장 참조'],
    ['zh', '凭据存储引用'],
  ]) {
    const request = {
      id: 'request-id',
      sessionId: 'session',
      callId: 'call',
      ref: 'PRODUCTION_TOKEN',
      label: '\u202eHarmless test token',
      reason: 'Save only a test token',
      configured: true,
    }
    let card, plugin
    const effects = []
    const jsx = (type, props) => (typeof type === 'function' ? type(props) : { type, props })
    runInNewContext(source, {
      AbortController,
      setTimeout: () => 1,
      clearTimeout: () => {},
      document: { createElement: () => ({ remove() {} }), head: { append() {} } },
      window: {
        __ModuleLoader__: {
          load({ factory }) {
            plugin = factory((name) => {
              if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
              if (name === 'react')
                return {
                  useCallback: (callback) => callback,
                  useRef: () => ({ current: null }),
                  useEffect: () => {},
                  useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
                  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
                }
              throw new Error(`Unexpected dependency: ${name}`)
            })
          },
        },
      },
    })
    const connection = { interactions: 'answer', rpc: { call: async () => ({ ok: true, value: [request] }) } }
    plugin.apply({
      get: () => connection,
      locale: { getSnapshot: () => ({ active: locale }), subscribe: () => () => {} },
      slots: {
        inject: (_name, callback) => callback(),
        register: (_spec, component) => {
          card = component
        },
      },
      effect: (effect) => effects.push(effect()),
    })
    await new Promise(setImmediate)
    const tree = card({
      sessionId: 'session',
      callId: 'call',
      phase: 'running',
      block: { args: { text: () => 'DECEPTIVE_TARGET' } },
    })
    const nodes = []
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(visit)
      nodes.push(node)
      visit(node.props?.children)
    }
    visit(tree)
    const refs = nodes.filter((node) => node.type === 'bdi')
    assert.equal(refs.length, 2, 'both target and replacement warning identify the immutable ref')
    for (const node of refs) {
      assert.equal(node.props.dir, 'ltr')
      assert.equal(node.props.children, request.ref)
    }
    assert.ok(JSON.stringify(tree).includes(label))
    assert.ok(!JSON.stringify(tree).includes('DECEPTIVE_TARGET'))
    assert.equal(
      nodes.find((node) => node.type === 'input').props['aria-describedby'],
      'secret-target-request-id secret-privacy-request-id'
    )
    assert.ok(
      nodes.some((node) => node.props?.className === 'dsh-secret-context' && node.props.children === request.label)
    )
    effects.forEach((dispose) => dispose?.())
  }
})
