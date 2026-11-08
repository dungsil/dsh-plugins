import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { Window } from 'happy-dom'

await test('클라이언트는 실제 Cordis 서비스 접근 검사 아래에서 설정 슬롯에 등록한다', async (t) => {
  const window = new Window()
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await window.happyDOM.close()
  })
  const require = createRequire(import.meta.url)
  let plugin
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    document: window.document,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => (id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id)))
        },
      },
    },
  })
  let registered = false
  await ctx
    .plugin({
      name: '설정 서비스 제공자',
      apply(provider) {
        provider.provide('connection', { rpc: {} })
        provider.provide('locale', { getSnapshot: () => ({ active: 'en' }) })
        provider.provide('slots', {
          inject(name) {
            assert.equal(name, 'settings.section')
            registered = true
          },
        })
      },
    })
    .await()
  await ctx.plugin(plugin).await()
  assert.equal(registered, true)
  assert.deepEqual(Array.from(plugin.inject), ['connection', 'locale', 'slots'])
})
