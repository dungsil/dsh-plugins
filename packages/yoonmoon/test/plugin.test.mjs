import assert from 'node:assert/strict'
import { glob, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { isModelInvocable, isUserInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
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
      assert.equal(skill.content, raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, '').trim())
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

await test('bundled instructions do not shadow a higher-priority custom skill', async () => {
  const ctx = new Context()
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
