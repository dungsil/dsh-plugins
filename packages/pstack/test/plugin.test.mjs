import assert from 'node:assert/strict'
import { readFile, readdir, stat } from 'node:fs/promises'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry, { isModelInvocable, isUserInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
import * as plugin from '../dist/index.js'

const root = new URL('../', import.meta.url)

async function resourceFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) files.push(...(await resourceFiles(path)))
    else files.push(path)
  }
  return files
}

await test('배포 지침에는 외부 하네스 전용 명령과 설정이 남지 않는다', async () => {
  const resources = [new URL('DSH.md', root), new URL('package.json', root)]
  for (const dir of ['skills/', 'agents/', 'locale/']) resources.push(...(await resourceFiles(new URL(dir, root))))
  const foreign =
    /\bcursor\b|\bclaude\b|\bgrok\b|bugbot|subagent_type|generalPurpose|run_in_background|pstack-models\.mdc|agent-transcripts|AskQuestion|TodoWrite|cursor-team-kit|control-ui|control-cli/i
  for (const path of resources) {
    if (!/\.(md|json|ya?ml)$/.test(path.pathname)) continue
    const text = await readFile(path, 'utf8')
    assert.doesNotMatch(text, foreign, path.pathname)
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split('#')[0]
      if (!target || /^(?:[a-z]+:|\/)/i.test(target) || /[<>*]/.test(target)) continue
      assert.ok(await stat(new URL(target, path)), `${path.pathname}: ${target}`)
    }
  }
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.ok(!pkg.files.includes('docs'))
  assert.ok(!pkg.files.includes('assets'))
})

await test('58개 스킬을 지연 로드하고 해제 및 재등록 시 다른 스킬을 보존한다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SkillRegistry)
  ctx.skills.register({ name: 'existing-skill', description: 'Existing skill', content: 'Keep me', source: 'runtime' })
  const mounted = ctx.plugin(plugin)
  await mounted
  const catalog = (await ctx.skills.list()).filter((skill) => skill.provider === 'dungsil-pstack')
  assert.equal(catalog.length, 58)
  assert.equal(catalog.filter(isUserInvocable).length, 58)
  assert.equal(isModelInvocable(catalog.find((skill) => skill.name === 'poteto-mode')), false)
  assert.equal(isModelInvocable(catalog.find((skill) => skill.name === 'setup-pstack')), true)
  for (const summary of catalog) {
    const skill = await ctx.skills.get(summary.name)
    assert.ok(skill.content.length > 100, summary.name)
    assert.equal(skill.source, 'bundled')
    assert.equal(skill.resourceBase.kind, 'directory')
    assert.match(skill.content, /\.\.\/\.\.\/DSH\.md/)
    assert.match(renderSkillContent(skill), /skill_instructions/)
    assert.equal((await stat(new URL('DSH.md', root))).isFile(), true)
  }
  const mode = await ctx.skills.get('poteto-mode')
  assert.match(mode.content, /playbooks\/prototype\.md/)
  assert.match(await readFile(new URL('skills/poteto-mode/playbooks/bug-fix.md', root), 'utf8'), /repro/i)
  await mounted.dispose()
  assert.deepEqual(
    (await ctx.skills.list()).map((skill) => skill.name),
    ['existing-skill']
  )
  assert.equal(await ctx.skills.get('poteto-mode'), undefined)
  const reloaded = ctx.plugin(plugin)
  await reloaded
  assert.equal((await ctx.skills.list()).length, 59)
  await reloaded.dispose()
  assert.equal((await ctx.skills.list()).length, 1)
})

await test('배포 메타데이터와 아이콘 및 원본 라이선스를 포함한다', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  for (const locale of ['en', 'ko', 'zh']) {
    const value = JSON.parse(await readFile(new URL(`locale/${locale}.json`, root), 'utf8'))
    assert.equal(value.meta.title, pkg.market.title[locale])
    assert.equal(value.meta.description, pkg.market.description[locale])
  }
  const icon = await readFile(new URL(pkg.exports['./icon'], root))
  assert.match(icon.toString('utf8'), /<svg[^>]+viewBox="0 0 24 24"/)
  assert.ok(icon.length <= 256 * 1024)
  assert.match(await readFile(new URL('LICENSE', root), 'utf8'), /Lauren Tan/)
  assert.match(await readFile(new URL('NOTICE', root), 'utf8'), /2776ddd2355d6d6c8747d3964600f28daf62f049/)
  assert.equal((await readdir(new URL('skills/poteto-mode/playbooks/', root))).length, 23)
  assert.deepEqual(plugin.inject, ['skills'])
})

await test('설정 스킬은 DSH 선호만 저장하고 권한과 미지원 도구 제약을 명시한다', async () => {
  const setup = await readFile(new URL('skills/setup-pstack/SKILL.md', root), 'utf8')
  assert.match(setup, /\.dsh\/pstack-models\.json/)
  assert.match(setup, /obtain confirmation/)
  const adapter = await readFile(new URL('DSH.md', root), 'utf8')
  assert.match(adapter, /System\/developer instructions/)
  assert.match(adapter, /No scheduled tasks without an explicit user request/)
  assert.match(adapter, /not multi-model/)
  assert.match(adapter, /Do not invent persistent settings/)
})
