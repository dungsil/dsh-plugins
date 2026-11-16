import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as plugin from '../dist/index.js'

await test('실제 configEditor로 기본값을 저장하고 owner만 읽으며 재시작 후에도 유지한다', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'checkout-profile-'))
  const dir = join(home, 'profiles', 'web')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"checkout-test"}')
  await writeFile(
    join(bundle, 'package.json'),
    JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } })
  )
  await writeFile(
    join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'editor', name: 'cordis:editor' },
          { id: 'picker', name: '@dungsil/dsh-plugin-ui-forge-worktree', config: { other: 'preserved' } },
        ],
      },
    ])
  )
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  await writeFile(join(dir, 'cordis.patch.yml'), '# unrelated comment\n[]\n')
  const profile = {
    name: 'web',
    startedBundles: ['test-bundle'],
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  let ctx
  t.after(async () => {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const start = async () => {
    ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
      root.provide('sessionProjections', { register: async () => ({}) })
      root.provide('profileContext', profile)
      root.provide('appReady', {
        onReady(listener) {
          listener()
          return () => {}
        },
      })
      root.loader.builtins.editor = ConfigEditor
      root.loader.internal = {
        version: 'v2',
        import: async (name) => (name === '@dungsil/dsh-plugin-ui-forge-worktree' ? plugin : { apply() {} }),
      }
      await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yml'), watch: false })
      await root.plugin(Connection)
    })
  }
  await start()
  const fetch = (method, payload = {}, principal = { kind: 'owner' }) =>
    ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'integration', method, payload }),
      }),
      { principal, interactions: 'answer' }
    )
  const rpc = async (method, payload) => (await (await fetch(method, payload)).json()).result
  const read = 'dungsil-worktree-preference/read'
  const save = 'dungsil-worktree-preference/save'
  assert.equal((await rpc(read)).value.defaultCheckout, 'current')
  for (const principal of [{ kind: 'anonymous' }, { kind: 'session', sessionId: 'shared' }])
    for (const method of [read, save]) assert.equal((await fetch(method, {}, principal)).status, 403)
  assert.equal((await fetch(read)).headers.get('Cache-Control'), 'no-store')
  const saved = await rpc(save, { defaultCheckout: 'worktree' })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal((await rpc(read)).value.defaultCheckout, 'worktree')
  const persisted = await readFile(profile.patchPath, 'utf8')
  assert.match(persisted, /# unrelated comment/)
  assert.match(persisted, /other: preserved/)
  await ctx.fiber.dispose()
  await start()
  assert.equal((await rpc(read)).value.defaultCheckout, 'worktree')
})
