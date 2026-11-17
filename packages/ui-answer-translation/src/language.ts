import { francAll } from 'franc-min'

type Script = 'hangul' | 'ja' | 'han' | 'cyrillic' | 'greek' | 'arabic' | 'hebrew' | 'thai' | 'devanagari' | 'latin'

const WORD_SCRIPTS: ReadonlyArray<readonly [Script, RegExp]> = [
  ['hangul', /\p{Script=Hangul}+/gu],
  ['cyrillic', /\p{Script=Cyrillic}+/gu],
  ['greek', /\p{Script=Greek}+/gu],
  ['arabic', /\p{Script=Arabic}+/gu],
  ['hebrew', /\p{Script=Hebrew}+/gu],
  // Thai has no spaces between words; count characters like other unspaced scripts.
  ['devanagari', /\p{Script=Devanagari}+/gu],
  ['latin', /\p{Script=Latin}+/gu],
]

const TARGET_SCRIPTS: Readonly<Record<string, Script>> = {
  ko: 'hangul',
  ja: 'ja',
  zh: 'han',
  ru: 'cyrillic',
  uk: 'cyrillic',
  be: 'cyrillic',
  bg: 'cyrillic',
  sr: 'cyrillic',
  mk: 'cyrillic',
  kk: 'cyrillic',
  ky: 'cyrillic',
  mn: 'cyrillic',
  tg: 'cyrillic',
  el: 'greek',
  ar: 'arabic',
  fa: 'arabic',
  ur: 'arabic',
  he: 'hebrew',
  yi: 'hebrew',
  th: 'thai',
  hi: 'devanagari',
  mr: 'devanagari',
  ne: 'devanagari',
}

// franc-min codes for languages written in the Latin or Cyrillic scripts.
const FRANC_LANGUAGES: Readonly<Record<string, string>> = {
  eng: 'en',
  fra: 'fr',
  deu: 'de',
  spa: 'es',
  por: 'pt',
  ita: 'it',
  nld: 'nl',
  pol: 'pl',
  tur: 'tr',
  vie: 'vi',
  ind: 'id',
  swe: 'sv',
  ces: 'cs',
  ron: 'ro',
  hun: 'hu',
  rus: 'ru',
  ukr: 'uk',
  bel: 'be',
  bul: 'bg',
  srp: 'sr',
  mkd: 'mk',
  kaz: 'kk',
}

function count(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0
}

/** Dominant writing system of a paragraph, weighted so CJK characters and spaced words compare fairly. */
function dominantScript(text: string): { script: Script | undefined; units: number } {
  const kana = count(text, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu)
  const han = count(text, /\p{Script=Han}/gu)
  // Two CJK characters carry roughly one spaced word; kana marks Han text as Japanese.
  const units = new Map<Script, number>([
    ['ja', kana > 0 ? (kana + han) / 2 : 0],
    ['han', kana > 0 ? 0 : han / 2],
    ['thai', count(text, /\p{Script=Thai}/gu) / 2],
  ])
  for (const [script, pattern] of WORD_SCRIPTS) units.set(script, count(text, pattern))
  let script: Script | undefined
  let best = 0
  for (const [candidate, value] of units) {
    if (value > best) {
      script = candidate
      best = value
    }
  }
  return { script, units: best }
}

function targetLanguage(tag: string) {
  try {
    return new Intl.Locale(tag.replaceAll('_', '-')).language
  } catch {
    return tag.toLowerCase().split(/[-_]/)[0] ?? ''
  }
}

/**
 * Decide locally whether a paragraph is in another language than the reader's target.
 * Nothing is sent anywhere; ambiguous paragraphs stay without a translation action.
 */
export function isForeign(text: string, target: string): boolean {
  const { script, units } = dominantScript(text)
  if (script === undefined || units < 2) return false
  const language = targetLanguage(target)
  if (script !== (TARGET_SCRIPTS[language] ?? 'latin')) return true
  if (script !== 'latin' && script !== 'cyrillic') return false
  // Same alphabet: only a clear statistical winner identifies another language.
  if (count(text, /\p{L}/gu) < 20) return false
  const [first, second] = francAll(text)
  if (!first || first[0] === 'und' || (second && first[1] - second[1] < 0.2)) return false
  return (FRANC_LANGUAGES[first[0]] ?? first[0]) !== language
}
