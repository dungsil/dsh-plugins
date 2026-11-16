import ja from '../locale/ja.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import de from '../locale/de.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }

/** Dictionary namespace owned by this plugin, registered into the DSH locale service. */
export const NS = 'dungsil-sidebar-inbox'

/** Copy rendered by the sidebar patch: the two footer labels and the sort row. */
export type SidebarInboxKey =
  | 'heading.working'
  | 'heading.archived'
  | 'heading.snoozed'
  | 'sort.agentActivity'
  | 'snooze.action'
  | 'snooze.agent'
  | 'snooze.wake'
  | 'snooze.30m'
  | 'snooze.1h'
  | 'snooze.3h'
  | 'snooze.tomorrow'

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
  'heading.snoozed': 'Snoozed',
  'snooze.action': 'Snooze',
  'snooze.agent': 'Let the agent decide',
  'snooze.wake': 'Unsnooze',
  'snooze.30m': '30 minutes',
  'snooze.1h': '1 hour',
  'snooze.3h': '3 hours',
  'snooze.tomorrow': 'Until tomorrow morning',
}

/** Korean copy, shipped with the plugin so the Korean UI language pack is optional. */
export const ko: Record<SidebarInboxKey, string> = {
  'heading.working': '작업 중',
  'heading.archived': '보관됨',
  'sort.agentActivity': '에이전트 활동',
  'heading.snoozed': '잠시 숨김',
  'snooze.action': '잠시 숨기기',
  'snooze.agent': '에이전트가 정하기',
  'snooze.wake': '다시 표시',
  'snooze.30m': '30분 동안',
  'snooze.1h': '1시간 동안',
  'snooze.3h': '3시간 동안',
  'snooze.tomorrow': '내일 아침까지',
}

export const zh: Record<SidebarInboxKey, string> = {
  'heading.working': '进行中',
  'heading.archived': '已归档',
  'heading.snoozed': '已暂时隐藏',
  'sort.agentActivity': '智能体活动',
  'snooze.action': '暂时隐藏',
  'snooze.agent': '由智能体决定',
  'snooze.wake': '重新显示',
  'snooze.30m': '30分钟',
  'snooze.1h': '1小时',
  'snooze.3h': '3小时',
  'snooze.tomorrow': '直到明天早上',
}

export const dictionaries = { en, ko, zh, ja: ja.ui, es: es.ui, fr: fr.ui, de: de.ui, ru: ru.ui, pt: pt.ui }
