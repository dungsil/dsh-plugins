import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import { STYLES } from './styles.js'

export const name = 'dungsil-turn-rail-left'
export const inject = ['slots']

function RailStyles() {
  return createElement('style', { 'data-dungsil-turn-rail-left': '', children: STYLES })
}

export function apply(ctx: Context) {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: name }, RailStyles))
}
