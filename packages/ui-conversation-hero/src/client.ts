import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createElement, type ReactNode } from 'react'

export const inject = ['slots']

interface HeroFrameProps {
  readonly hero: boolean
  readonly children?: ReactNode
}

/**
 * Only the official empty standalone hero is width-limited. The same wrapper
 * and child element remain mounted after the first message is submitted.
 */
export function HeroFrame({ hero, children }: HeroFrameProps) {
  return createElement(
    'div',
    {
      'data-dungsil-conversation-hero-frame': hero ? '' : undefined,
      style: {
        display: 'contents',
        ...(hero ? { '--dsh-composer-card-max-width': '752px' } : {}),
      },
    },
    children
  )
}

export function apply(ctx: Context) {
  ctx.slots.inject('conversation.hero.frame', () =>
    ctx.slots.register({ id: 'dungsil-centered-hero', name: 'conversation.hero.frame' }, HeroFrame)
  )
}
