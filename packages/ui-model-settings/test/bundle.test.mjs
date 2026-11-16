import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

await test('설정 UI 번들은 플랫폼 모듈만으로 실행되며 protocol을 별도로 요청하지 않는다', async () => {
  const code = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  const modules = new Map([
    ['react', {}],
    ['react/jsx-runtime', {}],
    ['@deepseek-ai/dsh-client-ui-primitives', {}],
  ])
  let registration
  runInNewContext(code, {
    window: {
      __ModuleLoader__: {
        load: (value) => {
          registration = value
        },
      },
    },
  })
  assert.equal(registration.id, '@dungsil/dsh-plugin-ui-model-settings')
  const exports = registration.factory((id) => {
    assert.ok(modules.has(id), `Unexpected browser dependency: ${id}`)
    return modules.get(id)
  })
  assert.equal(typeof exports.apply, 'function')
  assert.equal(exports.name, 'dungsil-ui-model-settings')
  assert.deepEqual(Array.from(exports.inject), ['connection', 'locale', 'slots'])
})
