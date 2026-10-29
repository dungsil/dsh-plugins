import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import dictionaries from './ko.json' with { type: 'json' }

export const name = 'dungsil-locale-ko'
export const inject = ['locale']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }), 'locale-ko: language')
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => ctx.locale.register(namespace, 'ko', dictionary), `locale-ko: ${namespace}`)
  }
}
