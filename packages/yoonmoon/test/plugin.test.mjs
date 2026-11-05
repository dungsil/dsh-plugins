import assert from 'node:assert/strict'
import { glob, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SkillRegistry, { isModelInvocable, isUserInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../dist/index.js'

const names = [
  'detecting-korean-ai',
  'humanizing-korean',
  'polishing-korean',
  'polishing-korean-translations',
  'proofreading-korean',
  'restyling-korean',
]

await test('DSH는 여섯 스킬을 모두 찾아내고 제자리 재로드 시 등록을 교체한다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Llm)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  const fork = ctx.plugin(plugin)
  await fork
  const contents = new Map()
  try {
    const catalog = await ctx.skills.list()
    assert.deepEqual(
      catalog.filter(isModelInvocable).map((skill) => skill.name),
      names
    )
    assert.deepEqual(
      catalog.filter(isUserInvocable).map((skill) => skill.name),
      names
    )

    for (const name of names) {
      const skill = await ctx.skills.get(name)
      assert.ok(skill, name)
      assert.equal(skill.provider, 'dungsil-yoonmoon')
      assert.equal(skill.source, 'bundled')
      assert.equal(skill.resourceBase.kind, 'directory')
      const raw = await readFile(resolve(skill.resourceBase.path, 'SKILL.md'), 'utf8')
      assert.ok(skill.content.endsWith(raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim()))
      assert.ok(skill.content.includes(`yoonmoon tool with skill="${name}"`))
      contents.set(name, skill.content)
      assert.ok(skill.description.length > 0)
      const rendered = renderSkillContent(skill)
      assert.ok(rendered.includes(skill.resourceBase.path))
      assert.ok(rendered.includes(skill.content))
      assert.doesNotMatch(rendered, /\nyoonmoon:|\nname:|\ndescription:/u)
    }
    assert.equal(await ctx.skills.get('missing-skill'), undefined)
  } finally {
    await fork.dispose()
  }
  assert.deepEqual(await ctx.skills.list(), [])
  assert.equal(await ctx.skills.get('polishing-korean'), undefined)

  // DSH loads a new module instance after disposing the installed version.
  const replacement = await import('../dist/index.js?in-place-update')
  const reloaded = ctx.plugin(replacement)
  await reloaded
  assert.deepEqual(
    (await ctx.skills.list()).map((skill) => skill.name),
    names
  )
  for (const name of names) {
    const skill = await ctx.skills.get(name)
    assert.equal(skill.provider, 'dungsil-yoonmoon')
    assert.equal(skill.content, contents.get(name))
  }
  await reloaded.dispose()
  assert.deepEqual(await ctx.skills.list(), [])
})

await test('번들 지침은 우선순위가 더 높은 사용자 지정 스킬을 가리지 않는다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Llm)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  const unregister = ctx.skills.register({
    name: 'humanizing-korean',
    description: 'Workspace-specific Korean writing rules.',
    content: 'Preserve this custom instruction.',
    source: 'custom',
  })
  const fork = ctx.plugin(plugin)
  await fork
  try {
    assert.equal((await ctx.skills.get('humanizing-korean')).content, 'Preserve this custom instruction.')
    unregister()
    assert.equal((await ctx.skills.get('humanizing-korean')).provider, 'dungsil-yoonmoon')
  } finally {
    await fork.dispose()
  }
})

await test('쓰기 도구는 선택된 모델과 입력만 사용하고 파이프라인 리소스를 포함하며 불완전한 출력을 거부한다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Llm)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  class WritingAdapter extends LlmAdapter {
    requests = []
    finish = 'stop'
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'high', name: 'High' },
          ],
          defaultEffort: 'high',
        },
      }
    }
    async *stream(request) {
      this.requests.push(request)
      yield { type: 'text-delta', index: 0, text: '문장을 ' }
      yield { type: 'text-delta', index: 0, text: '다듬었습니다.' }
      yield { type: 'finish', reason: { kind: this.finish } }
    }
  }
  const adapter = new WritingAdapter()
  ctx.llm.registerAdapter(['writing'], adapter)
  const fork = ctx.plugin(plugin, { provider: 'writing', model: 'editor' })
  await fork
  const run = (args, signal = new AbortController().signal) =>
    ctx.tools.execute({ name: 'yoonmoon', callId: 'writing', arguments: args, signal })
  for (const skill of names) {
    const result = await run({ skill, text: '원문입니다.', instructions: '해요체로 바꾸세요.' })
    assert.equal(result.isError, false)
    assert.equal(result.value, '문장을 다듬었습니다.')
    const request = adapter.requests.at(-1)
    assert.equal(request.provider, 'writing')
    assert.equal(request.model, 'editor')
    assert.equal(request.reasoningEffort, 'high')
    assert.equal(request.tools?.length ?? 0, 0)
    assert.equal(request.messages.length, 1)
    assert.deepEqual(JSON.parse(request.messages[0].content[0].text), {
      text: '원문입니다.',
      instructions: '해요체로 바꾸세요.',
    })
    assert.ok(request.system.includes(`# ${skill}\n`))
    if (skill === 'polishing-korean') for (const name of names) assert.ok(request.system.includes(`# ${name}\n`))
    assert.ok(request.system.includes('/references/'))
  }
  const count = adapter.requests.length
  for (const args of [
    { skill: '../../etc/passwd', text: '원문' },
    { skill: names[0], text: ' ' },
  ])
    assert.equal((await run(args)).isError, true)
  assert.equal((await run({ skill: names[0], text: '원문' }, AbortSignal.abort())).isError, true)
  assert.equal(adapter.requests.length, count)
  adapter.finish = 'max-tokens'
  assert.equal((await run({ skill: names[0], text: '원문' })).isError, true)
  t.mock.method(adapter, 'stream', async function* () {
    yield { type: 'text-delta', index: 0, text: 'Partial result' }
    await fork.dispose()
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  assert.equal((await run({ skill: names[0], text: '원문' })).isError, true)
  assert.equal(ctx.tools.get('yoonmoon'), undefined)
})

await test('파이프라인 스킬 이름과 로컬 참조 경로는 번들 안에서 확인된다', async () => {
  const root = fileURLToPath(new URL('../skills/', import.meta.url))
  for await (const path of glob('**/*.md', { cwd: root })) {
    const absolute = resolve(root, path)
    const text = await readFile(absolute, 'utf8')
    assert.doesNotMatch(text, /yoonmoon:|plugin:skill|`Skill`/u, path)
    const references = [
      ...text.matchAll(/`((?:\.\.?\/|references\/)[^`]+\.md)`/gu),
      ...text.matchAll(/\]\(([^)]+\.md)\)/gu),
    ]
    for (const [, reference] of references) {
      if (/^https?:/u.test(reference)) continue
      assert.ok((await readFile(resolve(dirname(absolute), reference), 'utf8')).length > 0, `${path}: ${reference}`)
    }
  }
  const pipeline = await readFile(resolve(root, 'polishing-korean/SKILL.md'), 'utf8')
  const guide = await readFile(resolve(root, 'polishing-korean/references/pipeline-guide.md'), 'utf8')
  for (const name of names.filter((name) => name !== 'polishing-korean')) {
    assert.ok(pipeline.includes(`\`${name}\``), name)
    assert.ok(guide.includes(`\`${name}\``), name)
  }
  assert.match(pipeline, /skill\(\{ name:/u)
})

await test('모델 설정 코덱은 관련 없는 설정을 보존하고 모든 쓰기에 마이그레이션 완료 상태를 기록한다', () => {
  const definition = plugin.modelSettingsDefinition
  assert.equal(definition.key, 'writing')
  for (const locale of ['en', 'ko', 'zh']) {
    for (const field of ['label', 'description', 'automaticReasoningLabel', 'instructionsHint'])
      assert.ok(definition[field][locale])
  }
  const legacy = { provider: 'writing', model: 'editor', reasoningEffort: 'high', unrelated: { keep: true } }
  assert.deepEqual(definition.read(legacy), {
    selection: { mode: 'model', route: { provider: 'writing', model: 'editor' }, reasoningEffort: 'high' },
    instructions: null,
  })
  for (const mode of ['auxiliary', 'conversation']) {
    const saved = definition.write(legacy, { selection: { mode }, instructions: 'Local instructions.' })
    assert.deepEqual(saved, {
      unrelated: { keep: true },
      modelSettings: { inherit: mode, instructions: 'Local instructions.' },
    })
    assert.deepEqual(definition.read(saved), { selection: { mode }, instructions: 'Local instructions.' })
  }
  const automatic = definition.write(legacy, {
    selection: { mode: 'model', route: { provider: 'writing', model: 'other' }, reasoningEffort: null },
    instructions: null,
  })
  assert.deepEqual(automatic, {
    provider: 'writing',
    model: 'other',
    unrelated: { keep: true },
    modelSettings: { inherit: 'auxiliary' },
  })
  assert.deepEqual(definition.read({ provider: 'partial', reasoningEffort: 'stale' }), {
    selection: { mode: 'auxiliary' },
    instructions: null,
  })
  assert.deepEqual(definition.read({ modelSettings: { inherit: 'conversation' } }), {
    selection: { mode: 'conversation' },
    instructions: null,
  })
  assert.ok(definition.defaultInstructions({}).includes('{{resources}}'))
  assert.equal(legacy.reasoningEffort, 'high')
})

await test('선택적 모델 설정 서비스는 나중에 연결되고 해제되면 로컬 모델과 지침으로 돌아간다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(Llm)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  class RecordingAdapter extends LlmAdapter {
    requests = []
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        reasoning: { efforts: ['low', 'high'].map((id) => ({ id, name: id })), defaultEffort: 'high' },
      }
    }
    async *stream(request) {
      this.requests.push(request)
      yield { type: 'text-delta', index: 0, text: '완성된 문장' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const adapter = new RecordingAdapter()
  ctx.llm.registerAdapter(['local', 'shared'], adapter)
  const fork = ctx.plugin(plugin, {
    provider: 'local',
    model: 'editor',
    reasoningEffort: 'low',
    modelSettings: { inherit: 'conversation', instructions: 'Local {{skill}}.' },
  })
  await fork
  const run = async () => {
    const result = await ctx.tools.execute({
      name: 'yoonmoon',
      callId: 'optional-service',
      arguments: { skill: 'proofreading-korean', text: '안되요.' },
      signal: new AbortController().signal,
    })
    assert.equal(result.isError, false)
    return adapter.requests.at(-1)
  }
  assert.equal((await run()).system, 'Local proofreading-korean.')
  assert.equal(adapter.requests.at(-1).reasoningEffort, 'low')
  let registered = 0
  let disposed = 0
  const service = {
    apply(child) {
      child.provide('dungsilModelSettings', {
        register(owner, definition) {
          registered++
          assert.equal(owner, fork.ctx)
          assert.equal(definition.key, 'writing')
          return {
            resolve(conversation) {
              assert.deepEqual(conversation, { provider: '', model: '' })
              return {
                route: { provider: 'shared', model: 'writer' },
                reasoningEffort: 'low',
                instructions: 'Shared {{skill}}.\n{{resources}}',
                additionalInstructions: 'Additional {{skill}}.',
              }
            },
            dispose() {
              disposed++
            },
          }
        },
      })
    },
  }
  const shared = ctx.plugin(service)
  await shared
  await new Promise((resolve) => setImmediate(resolve))
  const request = await run()
  assert.equal(registered, 1)
  assert.equal(request.provider, 'shared')
  assert.equal(request.model, 'writer')
  assert.equal(request.reasoningEffort, 'low')
  assert.ok(request.system.startsWith('Shared proofreading-korean.\n# proofreading-korean\n'))
  assert.ok(request.system.endsWith('\n\nAdditional {{skill}}.'))
  await shared.dispose()
  await new Promise((resolve) => setImmediate(resolve))
  const local = await run()
  assert.equal(disposed, 1)
  assert.equal(local.provider, 'local')
  assert.equal(local.system, 'Local proofreading-korean.')
  const reloaded = ctx.plugin(service)
  await reloaded
  await new Promise((resolve) => setImmediate(resolve))
  await run()
  assert.equal(registered, 2)
  await fork.dispose()
  assert.equal(disposed, 2)
  assert.equal(ctx.tools.get('yoonmoon'), undefined)
})
