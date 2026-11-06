import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'

export const name = 'pstack'
export const inject = ['skills']

export async function apply(ctx: Context): Promise<void> {
  await ctx.plugin(SkillFilesystem, {
    providerName: 'dungsil-pstack',
    includeDefaultRoots: false,
    bundledSkillDir: fileURLToPath(new URL('../skills/', import.meta.url)),
    watch: false,
  })
}
