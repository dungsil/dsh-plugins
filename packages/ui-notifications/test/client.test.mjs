import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)

/** Load the built client bundle the way the host ModuleLoader does. */
function load() {
  let plugin
  const storage = new Map()
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        plugin = factory((id) => (id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id)))
      },
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener() {},
    removeEventListener() {},
  }
  runInNewContext(source, { window, document: { baseURI: 'http://localhost/' }, URL })
  return plugin
}

/** Stop install at its first host effect, which proves install started. */
class Installed extends Error {}

function context(uiSession) {
  const injected = []
  const ctx = {
    uiSession,
    effect() {
      throw new Installed()
    },
    inject(deps, callback) {
      injected.push({ deps, callback })
    },
  }
  return { ctx, injected }
}

await test('DSH 0.2.2처럼 uiSession에 세션 상태가 있으면 추가 주입 없이 즉시 설치한다', () => {
  const { ctx, injected } = context({ sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } })
  assert.throws(() => load().apply(ctx), Installed)
  assert.deepEqual(injected, [])
})

await test('DSH 0.2.3처럼 세션 상태가 별도 서비스이면 uiSession.sessionStatus가 주입된 뒤에만 설치한다', () => {
  const { ctx, injected } = context({})
  load().apply(ctx)
  assert.equal(injected.length, 1)
  // The bundle runs in its own realm, so copy the array before comparing.
  assert.deepEqual([...injected[0].deps], ['uiSession.sessionStatus'])
  assert.throws(() => injected[0].callback({ ...ctx, uiSession: { sessionStatus: {} } }), Installed)
})
