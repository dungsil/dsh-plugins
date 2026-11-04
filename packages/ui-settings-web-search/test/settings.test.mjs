import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }
const prefix = 'dungsil-ui-settings-web-search/'
const web = { id: 'web', name: '@deepseek-ai/dsh-tool-web', config: { searchTimeoutMs: 61000 } }
const preset = (id, plugins) => ({
  id: `preset-${id}`,
  name: '@deepseek-ai/dsh-agent-preset',
  config: { id, plugins, description: 'Keep this' },
})

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-web-tool-settings-'))
  const dir = join(home, 'profiles', 'web')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}')
  await writeFile(
    join(bundle, 'package.json'),
    JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } })
  )
  const rows = [
    { id: 'editor', name: 'cordis:editor' },
    { id: 'settings', name: '@dungsil/dsh-plugin-ui-settings-web-search' },
    { id: 'inactive-global', name: '@deepseek-ai/dsh-tool-web', disabled: true },
    preset('standard', [{ id: 'unrelated', name: 'cordis:noop', config: { keep: 7 } }, web]),
    preset('nested', [{ id: 'group', name: 'cordis:group', group: true, config: [web] }]),
    preset('minimal', []),
    { ...preset('disabled', [web]), disabled: true },
  ]
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
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
  const start = async () => {
    ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
      root.provide('profileContext', profile)
      root.provide('appReady', {
        onReady(listener) {
          listener()
          return () => {}
        },
      })
      root.loader.builtins.editor = ConfigEditor
      // The preset declaration is inert here; persistence still uses the real Loader and ConfigEditor.
      root.loader.internal = {
        version: 'v2',
        import: async (name) => (name === '@dungsil/dsh-plugin-ui-settings-web-search' ? plugin : { apply() {} }),
      }
      await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
      await root.plugin(Connection)
    })
  }
  t.after(async () => {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  await start()
  const fetch = (action, payload = {}, peer = owner) =>
    ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request(`http://localhost/api/${prefix}${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'web-test', method: `${prefix}${action}`, payload }),
      }),
      peer
    )
  return {
    fetch,
    rpc: async (action = 'describe', payload = {}) => (await (await fetch(action, payload)).json()).result,
    restart: async () => {
      await ctx.fiber.dispose()
      await start()
    },
    patch: async () => readFile(profile.patchPath, 'utf8'),
    config: (id) => ctx.configEditor.entries().find((entry) => entry.options.id === id).options.config,
  }
}

await test('persists only the selected preset and retains sibling plugins, defaults, and nested tool settings across restart', async (t) => {
  const h = await fixture(t)
  const initial = await h.rpc()
  assert.equal(initial.ok, true)
  assert.deepEqual(
    initial.value.map((target) => target.label),
    ['standard', 'nested']
  )
  const [standard, nested] = initial.value
  assert.deepEqual(standard.settings, {
    search: true,
    fetch: true,
    searchMaxResults: 8,
    searchMaxQueries: 4,
    searchTimeoutMs: 61000,
    fetchTimeoutMs: 30000,
    fetchMaxOutputChars: 200000,
  })
  const unrelated = structuredClone(h.config('preset-standard').plugins[0])
  const changed = {
    ...standard.settings,
    search: false,
    searchMaxResults: 3,
    searchMaxQueries: 2,
    fetchTimeoutMs: 12345,
  }
  assert.equal((await h.rpc('save', { ...standard, settings: changed })).ok, true)
  assert.deepEqual(h.config('preset-standard').plugins[0], unrelated)
  assert.equal(h.config('preset-standard').description, 'Keep this')
  assert.deepEqual(h.config('preset-nested').plugins[0].config[0].config, { searchTimeoutMs: 61000 })
  assert.match(await h.patch(), /search: false/)
  await h.restart()
  assert.deepEqual((await h.rpc()).value[0].settings, changed)
  const next = await h.rpc('save', { ...nested, settings: { ...nested.settings, fetch: false } })
  assert.equal(next.ok, true)
  assert.equal(h.config('preset-nested').plugins[0].config[0].config.fetch, false)
})

await test('rejects stale revisions, invalid values, unknown targets, and non-owner access without overwriting settings', async (t) => {
  const h = await fixture(t)
  const target = (await h.rpc()).value[0]
  assert.equal((await h.rpc('save', { ...target, settings: { ...target.settings, searchMaxResults: 1 } })).ok, true)
  const before = await h.patch()
  assert.equal((await h.rpc('save', target)).error.code, 'conflict')
  assert.equal((await h.rpc('save', { ...target, id: 'missing' })).ok, false)
  for (const value of [0, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(
      (await h.fetch('save', { ...target, settings: { ...target.settings, searchMaxResults: value } })).status,
      400
    )
  }
  assert.equal((await h.fetch('save', { ...target, settings: { ...target.settings, search: 'false' } })).status, 400)
  for (const principal of [{ kind: 'anonymous' }, { kind: 'session', sessionId: 'shared' }]) {
    for (const action of ['describe', 'save'])
      assert.equal((await h.fetch(action, target, { principal, interactions: 'deny' })).status, 403)
  }
  assert.equal(await h.patch(), before)
})
