/** Dictionary namespace owned by this plugin, registered into the DSH locale service. */
export const NS = 'dungsil-sidebar-inbox'

/** Copy rendered by the sidebar patch: two section headings and three menu entries. */
export type SidebarInboxKey =
  | 'heading.working'
  | 'heading.settled'
  | 'menu.settle'
  | 'menu.unsettle'
  | 'menu.unpinToSettle'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dungsil-sidebar-inbox': SidebarInboxKey
  }
}

/** English copy; also the fallback every other language resolves against. */
export const en: Record<SidebarInboxKey, string> = {
  'heading.working': 'Working',
  'heading.settled': 'Settled',
  'menu.settle': 'Settle',
  'menu.unsettle': 'Unsettle',
  'menu.unpinToSettle': 'Unpin to settle',
}

/** Korean copy, shipped with the plugin so the Korean UI language pack is optional. */
export const ko: Record<SidebarInboxKey, string> = {
  'heading.working': '작업 중',
  'heading.settled': '정리됨',
  'menu.settle': '정리',
  'menu.unsettle': '정리 취소',
  'menu.unpinToSettle': '고정을 풀고 정리',
}
