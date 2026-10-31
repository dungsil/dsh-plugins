import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import dictionary from './plugin-metadata.json' with { type: 'json' }

/** Official plugin metadata translations, keyed by the English text DeepSeek Harness ships. */
const korean: Readonly<Record<string, string>> = dictionary

type ResolveText = LocaleRuntime['resolveText']
type PackageText = Parameters<ResolveText>[0]

/** Korean text for one package text map or sentence-like string, when known. */
function koreanText(text: PackageText): string | undefined {
  // A package that ships its own Korean text keeps it.
  if (typeof text !== 'string') return text.ko === undefined ? korean[text.en] : undefined
  // Bare identifiers (module names, slugs) stay verbatim.
  return text.includes(' ') ? korean[text] : undefined
}

/**
 * Translate the official plugins' display metadata into Korean.
 *
 * The Host reads a plugin's title and description from the package's
 * `locale/<language>.json` files, and the shipped packages carry English and
 * Chinese only. The locale service then resolves that text through the active
 * language's fallback chain, so Korean readers see the English metadata. Every
 * plugin surface — the Plugin Manager, the Plugins page, the plugin market, and
 * approval reasons — resolves package text through this single entry point, so
 * answering here reaches all of them without modifying the installed packages.
 *
 * A text map that carries its own `ko` entry keeps that translation. Plain
 * strings — the Host's fallback for packages without locale files, which it
 * uses for descriptions — translate when they are sentence-like; bare
 * identifiers such as module names stay verbatim. Other active locales keep
 * the service's own resolution.
 * @param locale - the installed locale service.
 * @returns disposer restoring the previous resolution behavior.
 */
export function installPluginMetadataTranslation(locale: LocaleRuntime) {
  // Older or future builds without this entry point keep working untranslated.
  if (typeof locale.resolveText !== 'function') return () => {}
  const resolveText = locale.resolveText.bind(locale)

  const translate: ResolveText = (text) => {
    if (locale.getLocale().active === 'ko') {
      const translation = koreanText(text)
      if (translation !== undefined) return translation
    }
    return resolveText(text)
  }

  locale.resolveText = translate
  return () => {
    if (locale.resolveText === translate) locale.resolveText = resolveText
  }
}
