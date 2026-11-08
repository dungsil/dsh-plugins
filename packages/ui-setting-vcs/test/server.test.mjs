import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as plugin from '../dist/index.js'

const channel = '/api'
const readMethod = 'dungsil-setting-vcs/read'
const saveMethod = 'dungsil-setting-vcs/save'
const worktree = '@deepseek-ai/dsh-experimental-worktree'
const panel = '@deepseek-ai/dsh-experimental-client-ui-forge'
const row = (id, name, inherited = {}, override = {}) => ({ entry: { options: { id, name } }, inherited, override })
async function fixture(
  t,
  initial = [row('worktree', worktree), row('forge-worktree', worktree), row('forge-panel', panel)]
) {
  const home = await mkdtemp(join(tmpdir(), 'vcs-settings-'))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yml'), watch: false })
  await ctx.plugin(Connection)
  let writes = 0
  let beforeEdit = () => {}
  const editor = {
    configuration: () => structuredClone(initial),
    async edit(entry, callback) {
      beforeEdit()
      const target = initial.find((value) => value.entry.options.id === entry.options.id)
      const current = Object.keys(target.override).length ? target.override : target.inherited
      const next = callback(structuredClone(current), structuredClone(target.inherited))
      target.override = next
      writes++
    },
  }
  ctx.provide('configEditor', editor)
  plugin.apply(ctx)
  const fetch = (method, payload = {}, principal = { kind: 'owner' }, raw) =>
    ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request(`http://localhost${channel}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw ?? JSON.stringify({ type: 'client-request', rpcId: 'vcs-test', method, payload }),
      }),
      { principal, interactions: 'answer' }
    )
  const rpc = async (method, payload) => (await (await fetch(method, payload)).json()).result
  return {
    initial,
    fetch,
    rpc,
    get writes() {
      return writes
    },
    beforeEdit(fn) {
      beforeEdit = fn
    },
  }
}

await test('전역과 isolated worktree 및 panel 설정을 각각 독립 엔트리로 읽는다', async (t) => {
  const h = await fixture(t)
  const result = await h.rpc(readMethod)
  assert.equal(result.ok, true)
  assert.deepEqual(
    result.value.entries.map(({ id, kind, settings }) => ({ id, kind, settings })),
    [
      { id: 'worktree', kind: 'worktree', settings: { directory: '.agents/worktrees', prefix: 'dsh-' } },
      { id: 'forge-worktree', kind: 'worktree', settings: { directory: '.agents/worktrees', prefix: 'dsh-' } },
      { id: 'forge-panel', kind: 'panel', settings: { prefix: 'dsh-' } },
    ]
  )
  for (const entry of result.value.entries) assert.match(entry.revision, /^[a-f0-9]{64}$/)
})

await test('상속과 현재 설정을 합쳐 읽고 선택 엔트리만 저장하며 알 수 없는 값과 표현식을 보존한다', async (t) => {
  const unknown = { __jsExpr: 'ctx.env.VALUE' }
  const h = await fixture(t, [
    row(
      'worktree',
      worktree,
      { directory: 'base/trees', namePrefix: 'base-', gitCommand: unknown, timeoutMs: 123 },
      { namePrefix: 'custom-' }
    ),
    row('forge-worktree', worktree, { namePrefix: 'isolated-' }),
  ])
  const before = (await h.rpc(readMethod)).value.entries[0]
  assert.deepEqual(before.settings, { directory: 'base/trees', prefix: 'custom-' })
  const result = await h.rpc(saveMethod, {
    id: before.id,
    revision: before.revision,
    settings: { directory: 'next/trees', prefix: '' },
  })
  assert.equal(result.ok, true)
  assert.deepEqual(h.initial[0].override, {
    directory: 'next/trees',
    namePrefix: '',
    gitCommand: unknown,
    timeoutMs: 123,
  })
  assert.deepEqual(h.initial[1].override, {})
  assert.notEqual(result.value.entries[0].revision, before.revision)
  assert.equal(h.writes, 1)
})

await test('상속만 있는 설정도 저장하고 panel 저장 시 worktree 설정을 변경하지 않는다', async (t) => {
  const h = await fixture(t, [
    row('worktree', worktree, { directory: 'inherited/trees', gitCommand: 'special-git' }),
    row('panel', panel, { maxBranches: 20 }),
  ])
  for (const entry of (await h.rpc(readMethod)).value.entries) {
    const result = await h.rpc(saveMethod, {
      id: entry.id,
      revision: entry.revision,
      settings: { ...entry.settings, prefix: 'updated-' },
    })
    assert.equal(result.ok, true)
  }
  assert.equal(h.initial[0].override.gitCommand, 'special-git')
  assert.deepEqual(h.initial[1].override, { maxBranches: 20, worktreePrefix: 'updated-' })
})

await test('저장 잠금 안에서 현재 또는 상속 설정이 달라지면 오래된 revision을 거부한다', async (t) => {
  for (const layer of ['inherited', 'override']) {
    const h = await fixture(t)
    const entry = (await h.rpc(readMethod)).value.entries[0]
    h.beforeEdit(() => {
      h.initial[0][layer].gitCommand = 'changed'
    })
    const result = await h.rpc(saveMethod, { id: entry.id, revision: entry.revision, settings: entry.settings })
    assert.equal(result.error.code, 'conflict')
    assert.equal(h.writes, 0)
  }
})

await test('지원 필드의 표현식과 비문자열 및 중복 식별자는 읽기와 저장을 허용하지 않는다', async (t) => {
  for (const value of [{ __jsExpr: 'ctx.env.PREFIX' }, 12, null]) {
    const h = await fixture(t, [row('worktree', worktree, { namePrefix: value })])
    assert.equal((await h.rpc(readMethod)).error.code, 'unavailable')
    const saved = await h.rpc(saveMethod, {
      id: 'worktree',
      revision: '0'.repeat(64),
      settings: { directory: 'trees', prefix: 'x-' },
    })
    assert.equal(saved.ok, false)
    assert.equal(h.writes, 0)
  }
  const h = await fixture(t, [row('same', worktree), row('same', panel)])
  assert.equal((await h.rpc(readMethod)).error.code, 'unavailable')
})

await test('잘못된 경로와 접두사 및 추가 키를 거부하고 어떠한 설정도 저장하지 않는다', async (t) => {
  const h = await fixture(t)
  const entry = (await h.rpc(readMethod)).value.entries[0]
  const invalid = [
    ...['', '   ', '/trees', 'a/../b', './trees', 'a//b', 'C:/trees', 'a\\b', 'a\u0000b', 'x'.repeat(4097)].map(
      (directory) => ({ directory, prefix: 'ok-' })
    ),
    ...['-bad', '../bad', 'bad/name', 'space name', 'ok-\n', 'ok-\r', '한글', 'x'.repeat(101)].map((prefix) => ({
      directory: 'trees',
      prefix,
    })),
    { directory: 'trees', prefix: 'ok-', extra: true },
    { prefix: 'ok-' },
    { directory: 42, prefix: 'ok-' },
  ]
  for (const settings of invalid)
    assert.equal(
      (await h.rpc(saveMethod, { id: entry.id, revision: entry.revision, settings })).error.code,
      'invalid_request'
    )
  for (const payload of [
    { id: entry.id, revision: entry.revision, settings: entry.settings, extra: true },
    { id: entry.id, revision: 4, settings: entry.settings },
    null,
  ])
    assert.equal((await h.rpc(saveMethod, payload)).error.code, 'invalid_request')
  assert.equal(h.writes, 0)
})

await test('없는 엔트리와 panel directory 필드를 거부한다', async (t) => {
  const h = await fixture(t)
  const entries = (await h.rpc(readMethod)).value.entries
  assert.equal(
    (await h.rpc(saveMethod, { id: 'unknown', revision: entries[0].revision, settings: entries[0].settings })).error
      .code,
    'unavailable'
  )
  assert.equal(
    (
      await h.rpc(saveMethod, {
        id: 'forge-panel',
        revision: entries[2].revision,
        settings: { directory: 'trees', prefix: 'x-' },
      })
    ).error.code,
    'invalid_request'
  )
  assert.equal(h.writes, 0)
})

await test('실제 configEditor로 선택 엔트리만 영속 저장하고 재시작 후 값을 읽는다', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'vcs-profile-'))
  const dir = join(home, 'profiles', 'web')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"vcs-test"}')
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
          { id: 'settings', name: '@dungsil/dsh-plugin-ui-setting-vcs' },
          {
            id: 'worktree',
            name: worktree,
            config: { directory: 'inherited/trees', gitCommand: { __jsExpr: "'custom-git'" } },
          },
          { id: 'forge-worktree', name: worktree, config: { namePrefix: 'isolated-' }, isolate: { worktrees: true } },
          { id: 'panel', name: panel, config: { maxBranches: 20 } },
        ],
      },
    ])
  )
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  await writeFile(join(dir, 'cordis.patch.yml'), '# unrelated comment\n- id: panel\n  config:\n    maxBranches: 30\n')
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
        import: async (name) => (name === '@dungsil/dsh-plugin-ui-setting-vcs' ? plugin : { apply() {} }),
      }
      await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yml'), watch: false })
      await root.plugin(Connection)
    })
  }
  await start()
  const rpc = async (method, payload = {}) =>
    (
      await (
        await ctx.connection.createSharedFetchHandler('/api').fetch(
          new Request(`http://localhost${channel}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId: 'integration', method, payload }),
          }),
          { principal: { kind: 'owner' }, interactions: 'answer' }
        )
      ).json()
    ).result
  const before = await rpc(readMethod)
  assert.equal(before.ok, true)
  const entry = before.value.entries.find((value) => value.id === 'worktree')
  const saved = await rpc(saveMethod, {
    id: entry.id,
    revision: entry.revision,
    settings: { directory: 'custom/trees', prefix: 'custom-' },
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const persisted = await readFile(profile.patchPath, 'utf8')
  assert.match(persisted, /# unrelated comment/)
  assert.match(persisted, /!!js/)
  assert.match(persisted, /maxBranches: 30/)
  assert.doesNotMatch(persisted, /id: forge-worktree/)
  await ctx.fiber.dispose()
  await start()
  const reloaded = await rpc(readMethod)
  assert.deepEqual(reloaded.value.entries.find((value) => value.id === 'worktree').settings, {
    directory: 'custom/trees',
    prefix: 'custom-',
  })
})

await test('Connection은 owner만 읽기와 저장을 허용하고 응답 캐시를 금지한다', async (t) => {
  const h = await fixture(t)
  const entry = (await h.rpc(readMethod)).value.entries[0]
  for (const principal of [{ kind: 'anonymous' }, { kind: 'session', sessionId: 'shared' }]) {
    for (const method of [readMethod, saveMethod])
      assert.equal(
        (await h.fetch(method, { id: entry.id, revision: entry.revision, settings: entry.settings }, principal)).status,
        403
      )
  }
  const response = await h.fetch(readMethod)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.equal(h.writes, 0)
  assert.equal((await h.fetch(readMethod, {}, undefined, '{')).status, 400)
})
