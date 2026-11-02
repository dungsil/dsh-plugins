import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { isModelInvocable, isUserInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import * as plugin from '../dist/index.js'

await test('exposes the unmodified upstream rules only to explicit user invocation and unloads cleanly', async () => {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  assert.deepEqual(await ctx.skills.list(), [])

  const fork = ctx.plugin(plugin)
  await fork
  try {
    const catalog = await ctx.skills.list()
    assert.deepEqual(
      catalog.filter(isUserInvocable).map((skill) => skill.name),
      ['i-have-adhd']
    )
    assert.deepEqual(catalog.filter(isModelInvocable), [])

    const skill = await ctx.skills.get('i-have-adhd')
    assert.ok(skill)
    assert.match(skill.description, /ADHD/)
    const raw = await readFile(skill.path, 'utf8')
    // Pin the source independently of the adapter's frontmatter parser.
    assert.equal(
      createHash('sha256').update(raw).digest('hex'),
      '88955c019bbb1419ff4b49dbb1f80a867467de6233d7865af2e06a7d7b76c7d3'
    )
    assert.equal(skill.content, raw.slice(raw.indexOf('# i-have-adhd')).trim())
    assert.match(skill.content, /"stop adhd mode" or "normal mode"/)
    const rendered = renderSkillContent(skill)
    assert.ok(rendered.includes(`<skill_instructions>\n${skill.content}\n</skill_instructions>`))
    assert.ok(!rendered.includes('disable-model-invocation:'))
  } finally {
    await fork.dispose()
  }

  assert.deepEqual(await ctx.skills.list(), [])
  assert.equal(await ctx.skills.get('i-have-adhd'), undefined)
})
