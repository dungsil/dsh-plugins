import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

await test('승인 화면은 모든 로케일에서 오해를 부르는 에이전트 텍스트와 서버에 바인딩된 대상을 구분해 식별한다', async () => {
  for (const [locale, label] of [
    ['en', 'Credential storage reference'],
    ['ko', '비밀값 저장 참조'],
    ['zh', '凭据存储引用'],
    ['ja-JP', '認証情報の保存先参照'],
    ['es-ES', 'Referencia de almacenamiento de credenciales'],
    ['fr-FR', 'Référence de stockage des identifiants'],
    ['de-DE', 'Speicherreferenz der Zugangsdaten'],
    ['ru-RU', 'Ссылка на хранилище учётных данных'],
    ['pt-BR', 'Referência de armazenamento de credenciais'],
    ['xx-XX', 'Credential storage reference'],
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

await test('모든 지원 로케일은 같은 메타데이터와 입력 카드 키 및 비어 있지 않은 번역을 제공한다', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const english = JSON.parse(await readFile(new URL('../locale/en.json', import.meta.url), 'utf8'))
  for (const language of ['en', 'ko', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
    const locale = JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(Object.keys(locale).sort(), Object.keys(english).sort())
    for (const section of ['meta', 'ui']) {
      assert.deepEqual(Object.keys(locale[section]).sort(), Object.keys(english[section]).sort())
      assert.ok(Object.values(locale[section]).every((value) => typeof value === 'string' && value.trim()))
    }
    assert.ok(manifest.market.title[language]?.trim())
    assert.ok(manifest.market.description[language]?.trim())
    if (!['en', 'ko', 'zh'].includes(language)) assert.equal(manifest.market.title[language], locale.meta.title)
  }
})
