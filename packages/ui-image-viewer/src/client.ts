import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { installStyles } from '@dungsil/dsh-ui/client'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { installLightboxNavigation } from './lightbox.js'
import { installImageLoading } from './loading.js'
import { STYLES } from './styles.js'

export const name = 'dungsil-ui-image-viewer'
export const inject = ['locale']

const NS = 'dungsil-ui-image-viewer'
type ImageViewerKey = keyof typeof en.ui

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dungsil-ui-image-viewer': ImageViewerKey
  }
}

const dictionaries = { en: en.ui, ko: ko.ui, zh: zh.ui }

export function apply(ctx: Context) {
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => ctx.locale.register(NS, language, dictionary), `ui-image-viewer: ${language} copy`)
  }
  const t = ctx.locale.bind(NS)
  ctx.effect(() => installStyles(STYLES), 'ui-image-viewer: styles')
  ctx.effect(() => installImageLoading(document), 'ui-image-viewer: download indicator')
  ctx.effect(() => {
    const navigation = installLightboxNavigation(document, () => ({ previous: t('previous'), next: t('next') }))
    const unsubscribe = ctx.locale.subscribe(navigation.refresh)
    return () => {
      unsubscribe()
      navigation.dispose()
    }
  }, 'ui-image-viewer: lightbox navigation')
}
