import type { Context } from '@deepseek-ai/cordis'
import { installStyles } from '@dungsil/dsh-ui/client'
import { STYLES } from './styles.js'

export const name = 'dungsil-turn-rail-left'
export const inject = [] as const

export function apply(ctx: Context) {
  ctx.effect(() => installStyles(STYLES), 'ui-turn-rail-left: styles')
}
