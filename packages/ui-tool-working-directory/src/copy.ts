import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }

export type CopyKey = keyof typeof en.ui
export const translations = { en, ko, zh }

export const directoryTitle = (path: string | null, t: (key: CopyKey) => string): string =>
  path === null ? t('read') : `${t('change')} · ${path}`
