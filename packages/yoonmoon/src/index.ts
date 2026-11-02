import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillProvider } from '@deepseek-ai/dsh-skill'
import { parse } from 'yaml'

export const name = 'yoonmoon'
export const inject = ['skills']

const skillNames = [
  'polishing-korean',
  'humanizing-korean',
  'polishing-korean-translations',
  'proofreading-korean',
  'restyling-korean',
  'detecting-korean-ai',
] as const

function parseSkill(raw: string, skillName: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (!frontmatter) throw new Error(`yoonmoon: missing frontmatter in ${skillName}`)
  const metadata = parse(frontmatter[1]) as { name: string; description: string }
  if (metadata.name !== skillName || !metadata.description?.trim()) {
    throw new Error(`yoonmoon: invalid metadata in ${skillName}`)
  }
  return { description: metadata.description, content: raw.slice(frontmatter[0].length).trim() }
}

export function apply(ctx: Context): void {
  const candidates: SkillCandidate[] = skillNames.map((skillName) => {
    const directory = new URL(`../skills/${skillName}/`, import.meta.url)
    const path = fileURLToPath(new URL('SKILL.md', directory))
    const { description } = parseSkill(readFileSync(path, 'utf8'), skillName)
    return {
      name: skillName,
      description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dungsil-yoonmoon',
      source: 'bundled',
      rank: BUNDLED_SKILL_RANK,
      resourceBase: { kind: 'directory', path: fileURLToPath(directory).split(sep).join('/') },
      path,
      locator: path,
    }
  })
  const provider: SkillProvider = {
    name: 'dungsil-yoonmoon',
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const raw = await readFile(locator as string, { encoding: 'utf8', signal: options.signal })
      return { ...summary, content: parseSkill(raw, candidate.name).content }
    },
  }
  ctx.skills.registerProvider(() => provider)
}
