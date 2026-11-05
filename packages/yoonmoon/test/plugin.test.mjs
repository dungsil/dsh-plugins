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

await test('DSH discovers all six skills and replaces their registrations on in-place reload', async (t) => {
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

await test('bundled instructions do not shadow a higher-priority custom skill', async (t) => {
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

await test('writing tool uses only the selected model and input, includes pipeline resources and rejects incomplete output', async (t) => {
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

await test('pipeline skill names and local reference paths resolve within the bundle', async () => {
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
