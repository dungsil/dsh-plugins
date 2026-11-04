import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import dictionaries from './ko.json' with { type: 'json' }
import { installPluginMetadataTranslation } from './plugin-metadata.js'
import regular from '../assets/fonts/Jetendard-Regular.woff2'
import medium from '../assets/fonts/Jetendard-Medium.woff2'
import bold from '../assets/fonts/Jetendard-Bold.woff2'

export const name = 'dungsil-locale-ko'
export const inject = ['locale']

export function apply(ctx: Context) {
  ctx.effect(() => ctx.locale.addLanguage({ id: 'ko', label: '한국어', fallback: 'en' }), 'locale-ko: language')
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => ctx.locale.register(namespace, 'ko', dictionary), `locale-ko: ${namespace}`)
  }
  ctx.effect(() => installPluginMetadataTranslation(ctx.locale), 'locale-ko: official plugin metadata')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = name
    style.textContent = [
      ...[
        [400, regular],
        [500, medium],
        [700, bold],
      ].map(
        ([weight, data]) => `@font-face {
          font-family: 'Jetendard';
          font-style: normal;
          font-weight: ${weight};
          font-display: swap;
          src: url('data:font/woff2;base64,${data}') format('woff2');
        }`
      ),
      `html[lang="ko"] body {
        --dsw-font-family: var(--dsh-font-family-text, 'Jetendard'), var(--dsh-font-family-text-default);
      }`,
    ].join('\n')
    document.head.append(style)
    return () => style.remove()
  }, 'locale-ko: Jetendard font')
}
