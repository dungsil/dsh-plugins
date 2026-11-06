import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import ja from '../locale/ja.json' with { type: 'json' }
import es from '../locale/es.json' with { type: 'json' }
import fr from '../locale/fr.json' with { type: 'json' }
import de from '../locale/de.json' with { type: 'json' }
import ru from '../locale/ru.json' with { type: 'json' }
import pt from '../locale/pt.json' with { type: 'json' }

export const copy = {
  en: en.ui,
  ko: ko.ui,
  zh: zh.ui,
  ja: ja.ui,
  es: es.ui,
  fr: fr.ui,
  de: de.ui,
  ru: ru.ui,
  pt: pt.ui,
} as const
