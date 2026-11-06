import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import * as plugin from '../dist/index.js'

await test('소유자만 커밋 설정을 영속 저장하며 오래된 값과 잘못된 작성자는 기존 설정을 덮어쓰지 않는다', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-vcs-settings-'))
  const dir = join(home, 'profiles/web')
  let ctx
  t.after(async () => {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}')
  await writeFile(
    join(bundle, 'package.json'),
    JSON.stringify({
      name: 'test-bundle',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
  )
  await writeFile(
    join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'editor', name: 'cordis:editor' },
          { id: 'vcs', name: '@dungsil/dsh-plugin-ui-vcs', config: { provider: 'gitlab' } },
        ],
      },
    ])
  )
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
  const start = () =>
    boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
      root.provide('profileContext', profile)
      root.provide('forge', { register() {} })
      root.provide('forgeSession', { changeRequests: () => [] })
      root.loader.builtins.editor = ConfigEditor
      root.loader.internal = { version: 'v2', import: async () => plugin }
      await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
      await root.plugin(Connection)
      await root.plugin(SessionPersistenceJsonl, { root: join(home, 'sessions') })
      root.provide('sessionController', { resolveAgent: async () => ({ error: { code: 'not-found' } }) })
      root.provide('workingDirectory', {})
      await root.plugin(SubprocessLocal)
      const spawn = root.subprocess.spawn.bind(root.subprocess)
      root.subprocess.resolveExecutable = async (command) => {
        if (command === 'tea') {
          const error = new Error('not installed')
          error.name = 'SubprocessExecutableNotFoundError'
          throw error
        }
        return command
      }
      root.subprocess.spawn = (spec) =>
        spawn({
          ...spec,
          argv: [
            process.execPath,
            '--input-type=module',
            '-e',
            `if (process.cwd() !== ${JSON.stringify(homedir())}) process.exit(1);
             console.log(process.argv[1] === 'gh'
               ? JSON.stringify({ hosts: { 'github.com': [{ state: 'success', host: 'github.com', login: 'alice', tokenSource: 'keyring' }] } })
               : JSON.stringify({ hosts: [] }));`,
            spec.argv[0],
          ],
        })
      root.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: home }) })
      root.provide('sandbox', { confine: async (argv) => ({ argv }) })
    })
  ctx = await start()
  const rpc = async (endpoint, payload = {}, principal = { kind: 'owner' }) => {
    const method = `dungsil-vcs/${endpoint}`
    const response = await ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
      }),
      { principal, interactions: 'deny' }
    )
    return response.status === 200 ? (await response.json()).result : { status: response.status }
  }
  const initial = await rpc('settings')
  assert.equal(initial.ok, true)
  assert.deepEqual(initial.value.settings, { authorName: '', authorEmail: '', noSign: false })
  const settings = { authorName: 'UI 작성자', authorEmail: 'ui@example.invalid', noSign: true }
  const saved = await rpc('save-settings', { revision: initial.value.revision, settings })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.deepEqual(saved.value.settings, settings)
  assert.notEqual(saved.value.revision, initial.value.revision)
  assert.match(await readFile(profile.patchPath, 'utf8'), /ui@example\.invalid/)
  assert.equal(ctx.configEditor.entries().find((entry) => entry.options.id === 'vcs').options.config.provider, 'gitlab')
  assert.equal((await rpc('save-settings', { revision: initial.value.revision, settings })).error.code, 'conflict')
  for (const invalid of [
    { ...settings, authorEmail: '' },
    { ...settings, authorName: '' },
    { ...settings, authorName: 'Bad\nName' },
    { ...settings, authorEmail: 'not-an-email' },
    { ...settings, noSign: 'true' },
    { ...settings, provider: 'github' },
  ])
    assert.equal(
      (await rpc('save-settings', { revision: saved.value.revision, settings: invalid })).error.code,
      'invalid'
    )
  for (const endpoint of ['settings', 'save-settings', 'cli-status']) {
    assert.deepEqual(await rpc(endpoint, {}, { kind: 'anonymous' }), { status: 403 })
  }
  await t.test('열린 세션 없이 PC의 CLI 인증 상태와 미설치 상태를 조회한다', async () => {
    assert.deepEqual(await rpc('cli-status'), {
      ok: true,
      value: [
        { cli: 'gh', status: 'authenticated', accounts: [{ host: 'github.com', login: 'alice', method: 'keyring' }] },
        { cli: 'glab', status: 'unauthenticated', accounts: [] },
        { cli: 'tea', status: 'unavailable', accounts: [] },
      ],
    })
  })
  await ctx.fiber.dispose()
  ctx = await start()
  assert.deepEqual((await rpc('settings')).value.settings, settings)
  const reset = await rpc('save-settings', {
    revision: (await rpc('settings')).value.revision,
    settings: initial.value.settings,
  })
  assert.equal(reset.ok, true)
  assert.deepEqual((await rpc('settings')).value.settings, initial.value.settings)
})
