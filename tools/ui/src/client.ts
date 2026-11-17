import { useCallback, useSyncExternalStore } from 'react'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

export function useLocaleSnapshot(locale: Pick<LocaleRuntime, 'subscribe' | 'getSnapshot'>) {
  // LocaleRuntime methods need their receiver; keep subscriptions stable across renders.
  const subscribe = useCallback((listener: () => void) => locale.subscribe(listener), [locale])
  const getSnapshot = useCallback(() => locale.getSnapshot(), [locale])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Key of a per-language record for the language's primary subtag, falling back to `fallback`. */
export function localizedLanguage<T extends Record<string, unknown>>(
  languages: T,
  language: string,
  fallback: keyof T & string = 'en'
): keyof T {
  const base = language.toLowerCase().split(/[-_]/)[0]!
  return (Object.hasOwn(languages, base) ? base : fallback) as keyof T
}

/** Entry of a per-language record for the language's primary subtag, falling back to `fallback`. */
export function localizedCopy<T extends Record<string, unknown>>(
  languages: T,
  language: string,
  fallback: keyof T & string = 'en'
): T[keyof T] {
  return languages[localizedLanguage(languages, language, fallback)]
}

/** Each effect owns its sheet, even when another plugin installs the same defaults. */
export function installStyles(css: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  return () => style.remove()
}
