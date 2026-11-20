import de from '../locale/de.json' with { type: 'json' }
import en from '../locale/en.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import ja from '../locale/ja.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }

export const translations = { en, ko, zh, ja, es, fr, de, pt, ru }
export type McpKey = keyof typeof en.ui
export type ResetKey = keyof typeof en.reset
export type McpTranslate = (key: McpKey, values?: Readonly<Record<string, string>>) => string
export type ResetTranslate = (key: ResetKey, values?: Readonly<Record<string, string>>) => string
export function formatCopy(value: string, params?: Readonly<Record<string, string>>): string {
  if (!params) return value
  return value.replace(/\{([A-Za-z0-9_]+)\}/gu, (all, key: string) => params[key] ?? all)
}
