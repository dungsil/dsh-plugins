import { francAll } from 'franc-min'
import { iso6393 } from 'iso-639-3'

const languageCodes = new Map(iso6393.map((entry) => [entry.iso6393, entry.iso6391 ?? entry.iso6393]))
languageCodes.set('cmn', 'zh')

/** Only skip a provider request when local detection has a clear winner. */
export function matchesTargetLanguage(text: string, targetLanguage: string): boolean {
  let target: Intl.Locale
  try {
    target = new Intl.Locale(targetLanguage.replaceAll('_', '-'))
  } catch {
    return false
  }
  // Detection identifies a language, not a requested writing system or Chinese variant.
  if (target.script || (target.language === 'zh' && target.region)) return false
  if ((text.match(/\p{L}/gu)?.length ?? 0) < 10) return false
  const [first, second] = francAll(text)
  if (!first || first[0] === 'und' || (second && first[1] - second[1] < 0.2)) return false
  return languageCodes.get(first[0]) === target.language
}
