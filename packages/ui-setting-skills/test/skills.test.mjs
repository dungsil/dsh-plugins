import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { canOpenNativePath } from '@deepseek-ai/dsh-native-command'
import Skills from '@deepseek-ai/dsh-skill'
import * as Filesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as plugin from '../dist/index.js'

const method = 'dungsil-ui-setting-skills/list'
const url = `http://localhost/api/${method}`
const owner = { principal: { kind: 'owner' }, interactions: 'answer' }

async function fixture(t, withRegistry = false) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-skills-test-'))
  const dsh = join(home, 'dsh')
  const agents = join(home, 'agents')
  const previousEnv = Object.fromEntries(
    ['DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_BUNDLED_SKILL_DIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'PATH'].map((key) => [
      key,
      process.env[key],
    ])
  )
  process.env.DSH_HOME = dsh
  process.env.DSH_AGENTS_HOME = agents
  delete process.env.DSH_BUNDLED_SKILL_DIR
  let ctx
  t.after(async () => {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const dir = join(dsh, 'profiles', 'web')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}')
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
          {
            id: 'skills-settings',
            name: '@dungsil/dsh-plugin-ui-setting-skills',
            config: { disabled: ['not-installed'] },
          },
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
    home: dsh,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
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
      root.loader.internal = { version: 'v2', import: async () => plugin }
      await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
      await root.plugin(Connection)
      if (withRegistry) {
        await root.plugin(Skills)
        await root.plugin(Filesystem, { watch: false })
      }
    })
  }
  await start()
  const fetch = (body, peer = owner) =>
    ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request(
        body?.method?.startsWith('dungsil-ui-setting-skills/') ? `http://localhost/api/${body.method}` : url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        }
      ),
      peer
    )
  const request = { type: 'client-request', rpcId: 'skills-test', method, payload: {} }
  const skill = async (root, name, description, extra = '') => {
    const path = join(root, 'skills', name, 'SKILL.md')
    await mkdir(join(root, 'skills', name), { recursive: true })
    await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nPrivate body\n`)
    return path
  }
  return {
    home,
    dsh,
    agents,
    skill,
    profile,
    get ctx() {
      return ctx
    },
    get skills() {
      return ctx.get('skills')
    },
    get fiber() {
      return ctx.configEditor.entries().find((entry) => entry.options.id === 'skills-settings').fiber
    },
    restart: async () => {
      await ctx.fiber.dispose()
      await start()
    },
    fetch,
    request,
    rpc: async () => (await (await fetch(request)).json()).result,
  }
}

await test('discovers both user roots without a global skill registry, including duplicates and symlinked skills', async (t) => {
  const h = await fixture(t)
  const dshPath = await h.skill(h.dsh, 'planning-work', 'DSH entry')
  const sharedPath = await h.skill(
    h.agents,
    'planning-work',
    'Shared entry',
    'disable-model-invocation: true\nuser-invocable: false\n'
  )
  const linkedPath = await h.skill(h.home, 'reviewing-code', 'Linked entry')
  await symlink(join(h.home, 'skills', 'reviewing-code'), join(h.agents, 'skills', 'reviewing-code'), 'junction')
  // These files must follow the same exclusions and YAML validation as DSH.
  await h.skill(join(h.home, '.agents'), 'project-only', 'Must not be listed')
  await h.skill(join(h.dsh, 'skills', '.system'), 'system-only', 'Must not be listed')
  await writeFile(join(h.agents, 'skills', 'invalid.md'), 'No frontmatter')
  const response = await h.fetch(h.request)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), {
    type: 'server-response',
    rpcId: 'skills-test',
    result: {
      ok: true,
      value: {
        translationAvailable: false,
        folderOpenAvailable: canOpenNativePath(),
        disabled: ['not-installed'],
        complete: true,
        skills: [
          {
            name: 'planning-work',
            source: 'user-dsh',
            description: 'DSH entry',
            path: dshPath,
          },
          {
            name: 'planning-work',
            source: 'user-agents',
            description: 'Shared entry',
            path: sharedPath,
          },
          {
            name: 'reviewing-code',
            source: 'user-agents',
            description: 'Linked entry',
            path: linkedPath,
          },
        ],
      },
    },
  })
})

await test('returns empty missing roots and rereads additions and removals on the next request', async (t) => {
  const h = await fixture(t)
  const empty = {
    translationAvailable: false,
    folderOpenAvailable: canOpenNativePath(),
    disabled: ['not-installed'],
    complete: true,
    skills: [],
  }
  assert.deepEqual(await h.rpc(), { ok: true, value: empty })
  const path = await h.skill(h.dsh, 'planning-work', 'New entry')
  assert.deepEqual((await h.rpc()).value.skills, [
    { name: 'planning-work', description: 'New entry', source: 'user-dsh', path },
  ])
  await rm(path)
  assert.deepEqual(await h.rpc(), { ok: true, value: empty })
})

await test(
  'opens only discovered user skill folders for the owner and reports native failures',
  { skip: process.platform !== 'linux' },
  async (t) => {
    const h = await fixture(t)
    const paths = [
      await h.skill(h.agents, 'shared-skill', 'Shared entry'),
      await h.skill(h.dsh, 'dsh-skill', 'DSH entry'),
    ]
    const projectPath = await h.skill(join(h.home, '.agents'), 'project-only', 'Not a user skill')
    const bin = join(h.home, 'bin')
    const capture = join(bin, 'opened')
    await mkdir(bin)
    await writeFile(join(bin, 'xdg-open'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$(dirname "$0")/opened"\n', {
      mode: 0o755,
    })
    process.env.PATH = `${bin}:${process.env.PATH}`
    process.env.DISPLAY = ':test'
    const request = (payload) => ({ ...h.request, method: 'dungsil-ui-setting-skills/open-folder', payload })
    const open = async (payload) => (await (await h.fetch(request(payload))).json()).result
    assert.equal((await h.rpc()).value.folderOpenAvailable, true)
    for (const path of paths) {
      assert.equal((await open({ path })).ok, true)
      assert.equal(await readFile(capture, 'utf8'), `${path.slice(0, -'/SKILL.md'.length)}\n`)
      await rm(capture)
    }
    for (const path of ['/unknown/SKILL.md', projectPath, join(h.agents, 'skills')]) {
      assert.equal((await open({ path })).ok, false)
    }
    for (const payload of [null, {}, { path: 42 }]) {
      assert.equal((await h.fetch(request(payload))).status, 400)
    }
    for (const principal of [{ kind: 'anonymous' }, { kind: 'session', sessionId: 'shared' }]) {
      assert.equal((await h.fetch(request({ path: paths[0] }), { principal, interactions: 'deny' })).status, 403)
    }
    await assert.rejects(readFile(capture), { code: 'ENOENT' })
    await writeFile(join(bin, 'xdg-open'), '#!/bin/sh\nexit 1\n')
    assert.deepEqual(await open({ path: paths[0] }), {
      ok: false,
      error: { code: 'open_folder_failed', message: 'Could not open skill folder.', details: {} },
    })
    await writeFile(join(bin, 'xdg-open'), '#!/bin/sh\ntouch "$(dirname "$0")/opened"\n')
    await rm(paths[1])
    assert.equal((await open({ path: paths[1] })).ok, false)
    delete process.env.DISPLAY
    delete process.env.WAYLAND_DISPLAY
    assert.equal((await h.rpc()).value.folderOpenAvailable, false)
    assert.equal((await open({ path: paths[0] })).ok, false)
    await assert.rejects(readFile(capture), { code: 'ENOENT' })
    await h.fiber.dispose()
    assert.equal((await h.fetch(request({ path: paths[0] }))).status, 404)
  }
)

await test('translates only discovered descriptions using accepted preferences without changing skills', async (t) => {
  const h = await fixture(t)
  const path = await h.skill(h.agents, 'planning-work', 'Plan the next task')
  const before = await readFile(path, 'utf8')
  const translate = async (payload, peer) => {
    const response = await h.fetch({ ...h.request, method: 'dungsil-ui-setting-skills/translate', payload }, peer)
    return response.status === 200 ? (await response.json()).result : response.status
  }
  assert.equal((await translate({ path, language: 'ko' })).ok, false)
  let targetLanguage = 'auto'
  let selectedProvider = 'google'
  let fail = false
  const translator = {
    limits: async () => ({ preferences: { provider: selectedProvider, targetLanguage } }),
    translate: async (request, signal) => {
      signal.throwIfAborted()
      if (fail) throw new Error('Private provider error')
      assert.deepEqual(request, {
        text: 'Plan the next task',
        provider: selectedProvider,
        targetLanguage: targetLanguage === 'auto' ? 'ko' : targetLanguage,
      })
      return request.targetLanguage === 'ko' ? '다음 작업을 계획합니다' : '规划下一项任务'
    },
  }
  h.ctx.provide('cotTranslation', translator)
  assert.equal((await h.rpc()).value.translationAvailable, true)
  assert.deepEqual(await translate({ path, language: 'ko', text: 'Untrusted replacement' }), {
    ok: true,
    value: '다음 작업을 계획합니다',
  })
  // Persisted results remain usable even when the provider is offline, including after restart.
  fail = true
  assert.deepEqual(await translate({ path, language: 'ko' }), { ok: true, value: '다음 작업을 계획합니다' })
  await h.restart()
  h.ctx.provide('cotTranslation', translator)
  assert.deepEqual(await translate({ path, language: 'ko' }), { ok: true, value: '다음 작업을 계획합니다' })
  fail = false
  targetLanguage = 'zh'
  assert.deepEqual(await translate({ path, language: 'ko' }), { ok: true, value: '规划下一项任务' })
  assert.equal((await translate({ path: '/unknown', language: 'ko' })).ok, false)
  for (const payload of [null, {}, { path, language: 42 }]) assert.equal(await translate(payload), 400)
  for (const principal of [{ kind: 'anonymous' }, { kind: 'session', sessionId: 'shared' }]) {
    assert.equal(await translate({ path, language: 'ko' }, { principal, interactions: 'deny' }), 403)
  }
  fail = true
  targetLanguage = 'en'
  assert.deepEqual(await translate({ path, language: 'ko' }), {
    ok: false,
    error: { code: 'translation_failed', message: 'Could not translate skill description.', details: {} },
  })
  assert.equal(await readFile(path, 'utf8'), before)
  assert.equal((await h.rpc()).value.skills[0].description, 'Plan the next task')
  targetLanguage = 'auto'
  selectedProvider = 'bing'
  assert.equal((await translate({ path, language: 'ko' })).ok, false)
  selectedProvider = 'google'
  await h.skill(h.agents, 'planning-work', 'Changed description')
  assert.equal((await translate({ path, language: 'ko' })).ok, false)
  await h.skill(h.agents, 'planning-work', 'Plan the next task')
  assert.equal((await translate({ path, language: 'ko' })).ok, true)
  await h.fiber.dispose()
  assert.equal(await translate({ path, language: 'ko' }), 404)
})

await test('persists DSH-only disabling across reloads without changing skill files, and restores lookup on re-enable', async (t) => {
  const h = await fixture(t, true)
  const paths = [
    await h.skill(h.agents, 'planning-work', 'Shared entry'),
    await h.skill(h.dsh, 'planning-work', 'DSH entry'),
  ]
  await h.skill(h.agents, 'reviewing-code', 'Unaffected entry')
  const before = await Promise.all(paths.map((path) => readFile(path, 'utf8')))
  const skills = h.skills
  assert.ok(await skills.get('planning-work'))
  const save = async (name, disabled) =>
    (
      await (
        await h.fetch({ ...h.request, method: 'dungsil-ui-setting-skills/save', payload: { name, disabled } })
      ).json()
    ).result
  assert.equal((await save('planning-work', true)).ok, true)
  assert.equal((await save('planning-work', true)).ok, true)
  const isolated = new Context()
  t.after(() => isolated.fiber.dispose())
  await isolated.plugin(Skills)
  await isolated.plugin(Filesystem, { watch: false })
  assert.equal(await isolated.get('skills').get('planning-work'), undefined)
  assert.deepEqual(
    (await isolated.get('skills').list()).map((skill) => skill.name),
    ['reviewing-code']
  )
  assert.deepEqual((await h.rpc()).value.disabled, ['not-installed', 'planning-work'])
  assert.deepEqual(
    (await skills.list()).map((skill) => skill.name),
    ['reviewing-code']
  )
  assert.deepEqual(
    (await skills.snapshot()).skills.map((skill) => skill.name),
    ['reviewing-code']
  )
  assert.equal(await skills.get('planning-work'), undefined)
  assert.ok(await skills.get('reviewing-code'))
  assert.match(await readFile(h.profile.patchPath, 'utf8'), /disabled:\s*- not-installed\s*- planning-work/u)
  assert.equal((await h.rpc()).value.skills.filter((skill) => skill.name === 'planning-work').length, 2)
  await h.restart()
  assert.equal(await h.skills.get('planning-work'), undefined)
  assert.deepEqual((await h.rpc()).value.disabled, ['not-installed', 'planning-work'])
  assert.equal((await save('planning-work', false)).ok, true)
  assert.ok(await h.skills.get('planning-work'))
  assert.deepEqual((await h.rpc()).value.disabled, ['not-installed'])
  assert.deepEqual(await Promise.all(paths.map((path) => readFile(path, 'utf8'))), before)
  assert.equal((await save('unknown-skill', true)).ok, false)
  assert.equal((await save('planning-work', true)).ok, true)
  await h.fiber.dispose()
  assert.ok(await h.skills.get('planning-work'))
  assert.ok(await isolated.get('skills').get('planning-work'))
})

await test('rejects non-owner requests and malformed envelopes, and removes the route on unload', async (t) => {
  const h = await fixture(t)
  for (const principal of [{ kind: 'anonymous' }, { kind: 'session', sessionId: 'shared' }]) {
    assert.equal((await h.fetch(h.request, { principal, interactions: 'deny' })).status, 403)
    assert.equal(
      (
        await h.fetch(
          {
            ...h.request,
            method: 'dungsil-ui-setting-skills/save',
            payload: { name: 'planning-work', disabled: true },
          },
          { principal, interactions: 'deny' }
        )
      ).status,
      403
    )
  }
  for (const body of ['{', {}, { ...h.request, method: 'other' }]) {
    assert.equal((await h.fetch(body)).status, 400)
  }
  for (const payload of [{}, { name: 'planning-work', disabled: 'true' }, null]) {
    assert.equal((await h.fetch({ ...h.request, method: 'dungsil-ui-setting-skills/save', payload })).status, 400)
  }
  await h.fiber.dispose()
  assert.equal((await h.fetch(h.request)).status, 404)
})

await test('all UI strings have English, Korean and Chinese translations', async () => {
  const locales = await Promise.all(
    ['en', 'ko', 'zh'].map(async (language) =>
      JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    )
  )
  for (const locale of locales) {
    assert.deepEqual(Object.keys(locale.ui).sort(), Object.keys(locales[0].ui).sort())
    assert.ok(Object.values(locale.ui).every((value) => typeof value === 'string' && value.trim()))
  }
})
