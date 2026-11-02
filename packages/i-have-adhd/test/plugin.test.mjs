import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { isModelInvocable, isUserInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../dist/index.js'

await test('automatically includes the unmodified rules in every prompt and unloads cleanly', async () => {
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SkillFilesystem, { includeDefaultRoots: false, watch: false })
  await ctx.plugin(SystemPrompt, { personaPrefix: 'Existing deployment instructions.' })
  assert.deepEqual(await ctx.skills.list(), [])
  const baseline = renderPrompt(await ctx.systemPrompt.assemble())
  assert.ok(!baseline.includes('# i-have-adhd'))

  const fork = ctx.plugin(plugin)
  await fork
  try {
    // No skill invocation or conversation history is needed, including after compaction.
    const firstPrompt = renderPrompt(await ctx.systemPrompt.assemble())
    assert.ok(firstPrompt.includes('Existing deployment instructions.'))
    assert.match(firstPrompt, /### 1\. Lead with the next action/)
    assert.match(firstPrompt, /"stop adhd mode" or "normal mode"/)
    assert.equal(renderPrompt(await ctx.systemPrompt.assemble()), firstPrompt)
    assert.equal(firstPrompt.split('# i-have-adhd').length - 1, 1)

    const catalog = await ctx.skills.list()
    assert.deepEqual(
      catalog.filter(isUserInvocable).map((skill) => skill.name),
      ['i-have-adhd']
    )
    assert.deepEqual(catalog.filter(isModelInvocable), [])

    const skill = await ctx.skills.get('i-have-adhd')
    assert.ok(skill)
    assert.equal(skill.provider, 'dungsil-i-have-adhd')
    assert.equal(skill.source, 'bundled')
    assert.equal(skill.metadata.category, 'productivity')
    assert.match(skill.description, /ADHD/)
    const raw = await readFile(skill.path, 'utf8')
    // Pin the source independently of DSH's frontmatter parser.
    assert.equal(
      createHash('sha256').update(raw).digest('hex'),
      '88955c019bbb1419ff4b49dbb1f80a867467de6233d7865af2e06a7d7b76c7d3'
    )
    assert.equal(skill.content, raw.slice(raw.indexOf('# i-have-adhd')).trim())
    assert.ok(firstPrompt.endsWith(skill.content))
    const rendered = renderSkillContent(skill)
    assert.ok(rendered.includes(`<skill_instructions>\n${skill.content}\n</skill_instructions>`))
    assert.ok(!rendered.includes('disable-model-invocation:'))
  } finally {
    await fork.dispose()
  }

  assert.deepEqual(await ctx.skills.list(), [])
  assert.equal(await ctx.skills.get('i-have-adhd'), undefined)
  assert.equal(renderPrompt(await ctx.systemPrompt.assemble()), baseline)
})
