import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'i-have-adhd'
export const inject = ['skills', 'systemPrompt']

export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(SkillFilesystem, {
    providerName: 'dungsil-i-have-adhd',
    includeDefaultRoots: false,
    bundledSkillDir: fileURLToPath(new URL('../skills/', import.meta.url)),
    watch: false,
  })

  const skill = await ctx.skills.get(name)
  if (!skill) throw new Error('i-have-adhd: DSH could not load the bundled skill')

  ctx.systemPrompt.section({
    name: 'dungsil:i-have-adhd',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: skill.content,
    interpolate: false,
  })
}
