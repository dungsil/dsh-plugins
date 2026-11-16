import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session-projection'
import { eligibilityProjection } from './eligibility.js'
import { installPreference, type Config } from './preference.js'
export { Config } from './preference.js'
export { eligibilityProjection } from './eligibility.js'
export const name = 'dungsil-ui-forge-worktree'
export const inject = ['connection', 'configEditor', 'sessionProjections']
export async function apply(ctx: Context, config: Config) {
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  await ctx.sessionProjections.register(eligibilityProjection)
  installPreference(ctx, config)
}
