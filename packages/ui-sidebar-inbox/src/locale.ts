import ja from '../locale/ja.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import de from '../locale/de.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }

/** Dictionary namespace owned by this plugin, registered into the DSH locale service. */
export const NS = 'dungsil-sidebar-inbox'

/** Copy rendered by the sidebar patch: the two footer labels and the sort row. */
export type SidebarInboxKey = 'heading.working' | 'heading.archived' | 'sort.agentActivity'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dungsil-sidebar-inbox': SidebarInboxKey
  }
}

/** English copy; also the fallback every other language resolves against. */
export const en: Record<SidebarInboxKey, string> = {
  'heading.working': 'Working',
  'heading.archived': 'Archived',
  'sort.agentActivity': 'Agent activity',
}

/** Korean copy, shipped with the plugin so the Korean UI language pack is optional. */
export const ko: Record<SidebarInboxKey, string> = {
  'heading.working': '작업 중',
  'heading.archived': '보관됨',
  'sort.agentActivity': '에이전트 활동',
}

export const dictionaries = { en, ko, ja: ja.ui, es: es.ui, fr: fr.ui, de: de.ui, ru: ru.ui, pt: pt.ui }
