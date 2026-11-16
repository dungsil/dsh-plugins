import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { canOpenNativePath } from '@deepseek-ai/dsh-native-command'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import Skills from '@deepseek-ai/dsh-skill'
import * as Filesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as plugin from '../dist/index.js'

const method = 'dungsil-ui-setting-skills/list'
const url = `http://localhost/api/${method}`
const owner = { principal: { kind: 'owner' }, interactions: 'answer' }

async function fixture(t, withRegistry = false) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-skills-test-')))
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
  const fetch = (body, peer = owner, signal) =>
    ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request(
        body?.method?.startsWith('dungsil-ui-setting-skills/') ? `http://localhost/api/${body.method}` : url,
        {
          method: 'POST',
          signal,
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

await test('전역 스킬 레지스트리 없이 중복과 심볼릭 링크된 스킬을 포함해 두 사용자 루트를 모두 찾아낸다', async (t) => {
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

await test('없는 루트는 빈 결과를 반환하고 다음 요청에서 추가와 제거를 다시 읽는다', async (t) => {
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
  '소유자에 대해서만 발견된 사용자 스킬 폴더를 열고 네이티브 실패를 보고한다',
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

await test('스킬을 변경하지 않고 승인된 기본 설정을 사용해 발견된 설명만 번역한다', async (t) => {
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
  targetLanguage = 'ja'
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

await test('번역은 클라이언트 텍스트가 아닌 재발견한 표시 설명을 사용한다', async (t) => {
  const h = await fixture(t)
  const path = await h.skill(h.agents, 'display-skill', 'Raw routing description')
  const dir = join(dirname(path), 'agents')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'openai.yaml'), 'interface:\n  short_description: Visible description\n')
  const calls = []
  h.ctx.provide('cotTranslation', {
    limits: async () => ({ preferences: { provider: 'google', targetLanguage: 'ko' } }),
    translate: async (request) => {
      calls.push(request)
      return '표시 설명'
    },
  })
  const response = await h.fetch({
    ...h.request,
    method: 'dungsil-ui-setting-skills/translate',
    payload: { path, language: 'ko', text: 'Untrusted' },
  })
  assert.equal((await response.json()).result.value, '표시 설명')
  assert.equal(calls[0].text, 'Visible description')
})

await test('원문과 실제 대상 언어가 같으면 공급자 요청 없이 원문을 반환한다', async (t) => {
  const h = await fixture(t)
  let targetLanguage = 'auto'
  const calls = []
  h.ctx.provide('cotTranslation', {
    limits: async () => ({ preferences: { provider: 'google', targetLanguage } }),
    translate: async (request) => {
      calls.push(request)
      return 'Translated description'
    },
  })
  const samples = [
    ['en-US', 'Plan the next task'],
    ['ko-KR', '스킬의 내용을 확인하고 필요한 작업을 수행합니다'],
    ['zh', '使用此技能来检查用户请求并完成任务'],
    ['fr-FR', 'Ce guide explique comment utiliser les outils pour travailler avec les fichiers et les projets.'],
  ]
  for (const [language, description] of samples) {
    const path = await h.skill(h.agents, `skill-${language.toLowerCase()}`, description)
    const cacheDir = dshCachePath('dungsil-ui-setting-skills', 'translations-v1')
    const key = createHash('sha256')
      .update(JSON.stringify(['google', language, description]))
      .digest('hex')
    await mkdir(cacheDir, { recursive: true })
    await writeFile(join(cacheDir, `${key}.json`), JSON.stringify('Outdated same-language translation'))
    const request = async () =>
      (
        await (
          await h.fetch({ ...h.request, method: 'dungsil-ui-setting-skills/translate', payload: { path, language } })
        ).json()
      ).result
    assert.deepEqual(await request(), { ok: true, value: description })
    targetLanguage = language
    assert.deepEqual(await request(), { ok: true, value: description })
    targetLanguage = 'auto'
  }
  assert.equal(calls.length, 0)
  const path = await h.skill(h.agents, 'explicit-target', 'Plan the next task')
  const request = async (language) =>
    (
      await (
        await h.fetch({ ...h.request, method: 'dungsil-ui-setting-skills/translate', payload: { path, language } })
      ).json()
    ).result
  targetLanguage = 'ko'
  assert.deepEqual(await request('en'), { ok: true, value: 'Translated description' })
  assert.equal(calls.length, 1)
  targetLanguage = 'en'
  assert.deepEqual(await request('ko'), { ok: true, value: 'Plan the next task' })
  assert.equal(calls.length, 1)
})

await test('짧거나 불확실한 원문과 문자 체계가 지정된 대상은 번역을 생략하지 않는다', async (t) => {
  const h = await fixture(t)
  let calls = 0
  h.ctx.provide('cotTranslation', {
    limits: async () => ({ preferences: { provider: 'google', targetLanguage: 'auto' } }),
    translate: async () => {
      calls++
      return 'Translated description'
    },
  })
  for (const [language, description] of [
    ['en', 'API'],
    ['en', '1234567890'],
    ['fr', 'Cette compétence permet de vérifier les demandes et de réaliser les tâches nécessaires.'],
    ['zh-Hant', '使用此技能来检查用户请求并完成任务'],
    ['zh-TW', '使用此技能来检查用户请求并完成任务'],
    ['invalid locale!', 'Plan the next task'],
  ]) {
    const path = await h.skill(h.agents, `uncertain-${calls}`, JSON.stringify(description))
    const response = await h.fetch({
      ...h.request,
      method: 'dungsil-ui-setting-skills/translate',
      payload: { path, language },
    })
    assert.deepEqual((await response.json()).result, { ok: true, value: 'Translated description' })
  }
  assert.equal(calls, 6)
})

await test('스킬 파일을 변경하지 않고 재로드 후에도 DSH 전용 비활성화를 유지하며 다시 활성화하면 조회를 복원한다', async (t) => {
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

await test('소유자가 아닌 요청과 형식이 잘못된 봉투를 거부하고 언로드 시 라우트를 제거한다', async (t) => {
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

await test('사용자 스킬 전문은 비활성화되어도 소유자만 재발견하여 읽고 임의 경로는 거부한다', async (t) => {
  const h = await fixture(t, true)
  const path = await h.skill(h.agents, 'planning-work', 'Plan')
  const project = await h.skill(join(h.home, '.agents'), 'project-only', 'Project')
  const request = (payload) => ({ ...h.request, method: 'dungsil-ui-setting-skills/source', payload })
  const source = async (path) => (await (await h.fetch(request({ path }))).json()).result
  const saved = await h.fetch({
    ...h.request,
    method: 'dungsil-ui-setting-skills/save',
    payload: { name: 'planning-work', disabled: true },
  })
  assert.deepEqual((await saved.json()).result, { ok: true, value: { disabled: ['not-installed', 'planning-work'] } })
  assert.deepEqual(await source(path), { ok: true, value: 'Private body' })
  assert.equal((await source(project)).ok, false)
  assert.equal((await source(join(h.home, 'package.json'))).ok, false)
  for (const payload of [null, {}, { path: 42 }]) assert.equal((await h.fetch(request(payload))).status, 400)
  for (const principal of [{ kind: 'anonymous' }, { kind: 'session', sessionId: 'shared' }]) {
    assert.equal((await h.fetch(request({ path }), { principal, interactions: 'deny' })).status, 403)
  }
  await rm(path)
  assert.equal((await source(path)).ok, false)
  await h.fiber.dispose()
  assert.equal((await h.fetch(request({ path }))).status, 404)
})

await test('선택 메타데이터가 없거나 손상되어도 스킬 목록은 유지되고 유효한 표시 값만 사용한다', async (t) => {
  const h = await fixture(t)
  const path = await h.skill(h.agents, 'planning-work', 'Original description')
  const dir = join(h.agents, 'skills', 'planning-work', 'agents')
  const file = join(dir, 'openai.yaml')
  await mkdir(dir)
  const skill = async () => (await h.rpc()).value.skills.find((entry) => entry.path === path)
  assert.equal((await skill()).display, undefined)
  await writeFile(file, 'interface:\n  display_name: " Display name "\n  short_description: " Short description "\n')
  assert.deepEqual((await skill()).display, { name: 'Display name', description: 'Short description' })
  assert.equal((await skill()).name, 'planning-work')
  assert.equal((await skill()).description, 'Original description')
  for (const content of [
    'interface: [',
    'interface: []',
    'interface:\n  display_name: 123\n  short_description: " "',
    'interface:\n  display_name: "\\u200b"',
    `interface:\n  display_name: ${'x'.repeat(65_536)}`,
  ]) {
    await writeFile(file, content)
    assert.equal((await skill()).display, undefined)
  }
})

await test('서버의 워크스페이스와 프리셋 범위로 카탈로그를 읽고 오래된 원본 선택을 거부한다', async (t) => {
  const h = await fixture(t, true)
  const other = join(h.home, 'other')
  const firstPath = await h.skill(join(h.home, '.agents'), 'project-one', 'First project')
  const secondPath = await h.skill(join(other, '.agents'), 'project-two', 'Second project')
  await h.skill(h.agents, 'not-installed', 'Disabled but inspectable')
  let leases = 0
  let released = 0
  let broken = false
  class Workspace {
    constructor(id, title, path) {
      this.values = { id, title, path }
    }
    get id() {
      return this.values.id
    }
    get title() {
      return this.values.title
    }
    get path() {
      return this.values.path
    }
    async status() {
      try {
        return (await import('node:fs/promises')).stat(this.path).then(
          (info) => (info.isDirectory() ? 'ok' : 'missing-dir'),
          () => 'missing-dir'
        )
      } catch {
        return 'missing-dir'
      }
    }
  }
  const workspaces = [new Workspace('one', 'One', h.home), new Workspace('two', 'Two', other)]
  h.ctx.provide('workingDirectory', { defaultDirectory: h.home })
  h.ctx.provide('workspaceRegistry', { list: () => workspaces })
  h.ctx.provide('agentPresets', {
    defaultId: 'standard',
    async list() {
      return [{ id: 'standard', ...(broken && { broken: 'broken' }) }]
    },
    async acquireScope(id) {
      assert.equal(id, 'standard')
      if (broken) throw new Error('broken preset')
      leases++
      return {
        key: undefined,
        async [Symbol.asyncDispose]() {
          released++
        },
      }
    },
  })
  const call = async (endpoint, payload, peer = owner) => {
    const response = await h.fetch({ ...h.request, method: `dungsil-ui-setting-skills/${endpoint}`, payload }, peer)
    return response.status === 200 ? (await response.json()).result : response.status
  }
  const first = await call('list', { workspaceId: 'one', presetId: 'standard' })
  assert.equal(first.value.contexts.cwd, h.home)
  assert.deepEqual(first.value.contexts.workspaces[0], { id: 'one', title: 'One', path: h.home })
  assert.equal(first.value.catalog.complete, true)
  assert.ok(first.value.skills.some((skill) => skill.name === 'not-installed'))
  assert.ok(!first.value.catalog.skills.some((skill) => skill.name === 'not-installed'))
  const picked = first.value.catalog.skills.find((skill) => skill.path === firstPath)
  assert.ok(picked)
  const selection = { ...picked, workspaceId: 'one', presetId: 'standard' }
  assert.equal((await call('source', { catalog: selection })).value.trim(), 'Private body')
  assert.equal((await call('source', { catalog: { ...selection, workspaceId: 'two' } })).ok, false)
  const second = await call('list', { workspaceId: 'two', presetId: 'standard' })
  assert.equal(second.value.contexts.cwd, other)
  const secondPicked = second.value.catalog.skills.find((skill) => skill.path === secondPath)
  assert.ok(secondPicked)
  await rm(other, { recursive: true })
  const deleted = await call('list', { workspaceId: 'two', presetId: 'standard' })
  assert.equal(deleted.value.catalogError, true)
  assert.equal(deleted.value.catalog.complete, false)
  assert.equal(deleted.value.contexts.workspaces.length, 2)
  const recovered = await call('list', { workspaceId: 'one', presetId: 'standard' })
  assert.equal(recovered.value.catalog.complete, true)
  assert.ok(recovered.value.catalog.skills.some((skill) => skill.path === firstPath))
  assert.ok(deleted.value.skills.some((skill) => skill.name === 'not-installed'))
  assert.equal(
    (await call('source', { catalog: { ...secondPicked, workspaceId: 'two', presetId: 'standard' } })).ok,
    false
  )
  const missing = await call('list', { workspaceId: 'missing', presetId: 'standard' })
  assert.equal(missing.value.catalogError, true)
  assert.ok(missing.value.skills.some((skill) => skill.name === 'not-installed'))
  assert.equal(missing.value.contexts.workspaces.length, 2)
  assert.equal(missing.value.catalog.complete, false)
  assert.equal(
    await call('source', { catalog: selection }, { principal: { kind: 'anonymous' }, interactions: 'deny' }),
    403
  )
  broken = true
  const incomplete = await call('list', { workspaceId: 'one', presetId: 'standard' })
  assert.equal(incomplete.value.catalog.complete, false)
  assert.equal((await call('source', { catalog: selection })).ok, false)
  assert.equal(leases, released)
})

await test('경로 없는 가상 공급자의 원본을 읽고 숨겨지거나 바뀐 승자를 거부한다', async (t) => {
  const h = await fixture(t)
  h.ctx.provide('workingDirectory', { defaultDirectory: h.home })
  h.ctx.provide('workspaceRegistry', { list: () => [] })
  const scope = Symbol('preset')
  let released = 0
  h.ctx.provide('agentPresets', {
    defaultId: 'standard',
    list: async () => [{ id: 'standard' }],
    acquireScope: async () => ({
      key: scope,
      async [Symbol.asyncDispose]() {
        released++
      },
    }),
  })
  let winner = { name: 'virtual', description: 'Virtual skill', provider: 'remote', source: 'plugin' }
  h.ctx.provide('skills', {
    snapshot: async (options) => {
      assert.equal(options.scope, scope)
      return { complete: true, skills: winner ? [winner] : [] }
    },
    get: async (_name, options) => {
      assert.equal(options.scope, scope)
      return winner && { ...winner, content: 'Remote body' }
    },
  })
  const call = async (endpoint, payload) =>
    (await (await h.fetch({ ...h.request, method: `dungsil-ui-setting-skills/${endpoint}`, payload })).json()).result
  const list = await call('list', {})
  const selected = { ...list.value.catalog.skills[0], workspaceId: '', presetId: 'standard' }
  assert.equal(selected.path, undefined)
  assert.equal((await call('source', { catalog: selected })).value, 'Remote body')
  winner = null
  assert.equal((await call('source', { catalog: selected })).ok, false)
  winner = {
    name: 'virtual',
    description: 'Replaced',
    provider: 'filesystem',
    source: 'project-agents',
    path: '/new/SKILL.md',
  }
  assert.equal((await call('source', { catalog: selected })).ok, false)
  assert.equal(released, 4)
})

await test('범위 획득 중 요청이 취소되면 즉시 응답하고 늦게 도착한 리스를 해제한다', async (t) => {
  const h = await fixture(t, true)
  h.ctx.provide('workingDirectory', { defaultDirectory: h.home })
  h.ctx.provide('workspaceRegistry', { list: () => [] })
  let acquired
  let started
  let disposed = 0
  const startedPromise = new Promise((resolve) => {
    started = resolve
  })
  const leasePromise = new Promise((resolve) => {
    acquired = resolve
  })
  h.ctx.provide('agentPresets', {
    defaultId: 'standard',
    async list() {
      return [{ id: 'standard' }]
    },
    acquireScope() {
      started()
      return leasePromise
    },
  })
  const controller = new AbortController()
  const pending = h.fetch(h.request, owner, controller.signal)
  await startedPromise
  controller.abort()
  const response = await pending
  assert.equal((await response.json()).result.ok, false)
  acquired({
    key: undefined,
    async [Symbol.asyncDispose]() {
      disposed++
    },
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(disposed, 1)
})

await test('프리셋 목록 시작 중 취소된 요청은 늦은 거절도 처리한다', async (t) => {
  const h = await fixture(t, true)
  h.ctx.provide('workingDirectory', { defaultDirectory: h.home })
  h.ctx.provide('workspaceRegistry', { list: () => [] })
  const controller = new AbortController()
  let rejectList
  const pendingList = new Promise((_resolve, reject) => {
    rejectList = reject
  })
  h.ctx.provide('agentPresets', {
    defaultId: 'standard',
    list() {
      controller.abort()
      return pendingList
    },
    acquireScope() {
      throw new Error('unexpected scope acquisition')
    },
  })
  const result = (await (await h.fetch(h.request, owner, controller.signal)).json()).result
  assert.equal(result.ok, false)
  rejectList(new Error('late failure'))
  await new Promise((resolve) => setImmediate(resolve))
})

await test('프리셋 목록이 지연되어 시간 초과되면 사용자 목록을 유지하고 원본을 거부한다', async (t) => {
  const h = await fixture(t, true)
  await h.skill(h.agents, 'raw-inventory', 'Raw fixture')
  h.ctx.provide('workingDirectory', { defaultDirectory: h.home })
  h.ctx.provide('workspaceRegistry', { list: () => [] })
  h.ctx.provide('agentPresets', {
    defaultId: 'standard',
    list: () => new Promise(() => {}),
    acquireScope: () => {
      throw new Error('unexpected scope acquisition')
    },
  })
  const original = AbortSignal.timeout.bind(AbortSignal)
  AbortSignal.timeout = () => original(20)
  t.after(() => {
    AbortSignal.timeout = original
  })
  // Keep the event loop alive while the platform's unref'ed timeout is pending.
  const keepAlive = setTimeout(() => {}, 1000)
  try {
    const result = (await (await h.fetch(h.request)).json()).result
    assert.equal(result.ok, true)
    assert.equal(result.value.catalogError, true)
    assert.ok(result.value.skills.some((skill) => skill.name === 'raw-inventory'))
    const source = await h.fetch({
      ...h.request,
      method: 'dungsil-ui-setting-skills/source',
      payload: {
        catalog: {
          name: 'raw-inventory',
          source: 'user-agents',
          provider: 'filesystem',
          workspaceId: '',
          presetId: 'standard',
        },
      },
    })
    assert.equal((await source.json()).result.ok, false)
  } finally {
    clearTimeout(keepAlive)
  }
})

await test('모든 UI 문자열에 지원하는 아홉 언어의 번역이 있고 보간 변수를 유지한다', async () => {
  const locales = await Promise.all(
    ['en', 'ko', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'].map(async (language) =>
      JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    )
  )
  for (const locale of locales) {
    assert.deepEqual(Object.keys(locale.ui).sort(), Object.keys(locales[0].ui).sort())
    assert.ok(Object.values(locale.ui).every((value) => typeof value === 'string' && value.trim()))
    for (const [key, value] of Object.entries(locale.ui)) {
      assert.deepEqual(value.match(/\{\w+\}/g)?.sort(), locales[0].ui[key].match(/\{\w+\}/g)?.sort())
    }
  }
})
