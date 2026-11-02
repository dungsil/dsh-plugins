import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { parse } from 'yaml'

export const name = 'i-have-adhd'
export const inject = ['skills']

export function apply(ctx: Context): void {
  const path = fileURLToPath(new URL('../skills/i-have-adhd/SKILL.md', import.meta.url))
  const raw = readFileSync(path, 'utf8')
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (!frontmatter) throw new Error(`i-have-adhd: missing frontmatter in ${path}`)
  const metadata = parse(frontmatter[1]) as {
    name: string
    description: string
    'disable-model-invocation'?: boolean
  }

  ctx.skills.register({
    name: metadata.name,
    description: metadata.description,
    content: raw.slice(frontmatter[0].length).trim(),
    path,
    source: 'bundled',
    invocation: {
      modelInvocable: metadata['disable-model-invocation'] !== true,
      userInvocable: true,
    },
  })
}
