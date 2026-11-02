import type { Context } from '@deepseek-ai/cordis'
import { installIMEEnter } from './ime-enter.js'

export const name = 'dungsil-korean-ime'

export function apply(ctx: Context) {
  installIMEEnter(ctx)
}
