import { useCallback, useSyncExternalStore } from 'react'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'

export function useLocaleSnapshot(locale: Pick<LocaleRuntime, 'subscribe' | 'getSnapshot'>) {
  // LocaleRuntime methods need their receiver; keep subscriptions stable across renders.
  const subscribe = useCallback((listener: () => void) => locale.subscribe(listener), [locale])
  const getSnapshot = useCallback(() => locale.getSnapshot(), [locale])
  return useSyncExternalStore(subscribe, getSnapshot)
}

/** Each effect owns its sheet, even when another plugin installs the same defaults. */
export function installStyles(css: string) {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  return () => style.remove()
}
