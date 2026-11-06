import { createElement } from 'react'
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import claude from './icons/brands/simple-icons/claude.svg'
import gemini from './icons/brands/simple-icons/googlegemini.svg'
import kimi from './icons/brands/simple-icons/kimi.svg'
import ollama from './icons/brands/simple-icons/ollama.svg'
import meta from './icons/brands/simple-icons/meta.svg'
import opencode from './icons/brands/simple-icons/opencode.svg'
import antigravity from './icons/brands/antigravity-color.svg'
import codex from './icons/brands/codex-color.svg'
import openai from './icons/brands/openai.svg'
import xai from './icons/brands/xai.svg'
import devin from './icons/brands/devin-color.svg'

// Prefer the pinned Simple Icons 16.36.0 catalog. The five LobeHub exceptions
// are absent from that catalog; preserve their product-specific artwork.
// Monochrome masks inherit currentColor in both themes. All SVGs are local
// build-time assets, never URLs constructed from untrusted provider names.
const assets = {
  claude: { svg: claude, monochrome: true, source: 'simple-icons' },
  gemini: { svg: gemini, monochrome: true, source: 'simple-icons' },
  kimi: { svg: kimi, monochrome: true, source: 'simple-icons' },
  ollama: { svg: ollama, monochrome: true, source: 'simple-icons' },
  meta: { svg: meta, monochrome: true, source: 'simple-icons' },
  opencode: { svg: opencode, monochrome: true, source: 'simple-icons' },
  antigravity: { svg: antigravity, monochrome: false, source: 'lobe-icons' },
  codex: { svg: codex, monochrome: false, source: 'lobe-icons' },
  openai: { svg: openai, monochrome: true, source: 'lobe-icons' },
  xai: { svg: xai, monochrome: true, source: 'lobe-icons' },
  devin: { svg: devin, monochrome: false, source: 'lobe-icons' },
}

const sources = Object.fromEntries(
  Object.entries(assets).map(([name, asset]) => [
    name,
    {
      uri: `data:image/svg+xml,${encodeURIComponent(asset.svg)}`,
      monochrome: asset.monochrome,
      source: asset.source,
    },
  ])
) as Record<keyof typeof assets, { uri: string; monochrome: boolean; source: string }>

const aliases: Record<string, keyof typeof assets> = {
  claude: 'claude',
  anthropic: 'claude',
  antigravity: 'antigravity',
  codex: 'codex',
  'openai-codex': 'codex',
  gemini: 'gemini',
  google: 'gemini',
  vertex: 'gemini',
  'vertex-ai': 'gemini',
  interactions: 'gemini',
  openai: 'openai',
  'openai-compatibility': 'openai',
  kimi: 'kimi',
  'kimi-ai': 'kimi',
  xai: 'xai',
  'x-ai': 'xai',
  grok: 'xai',
  ollama: 'ollama',
  'ollama-cloud': 'ollama',
  meta: 'meta',
  devin: 'devin',
  opencode: 'opencode',
  'opencode-go': 'opencode',
}

/** Decorative provider mark; the adjacent provider text supplies its name. */
export function ProviderIcon({
  provider,
  size = 20,
  className,
}: {
  provider: string
  size?: number
  className?: string
}) {
  const normalized = provider.trim().toLowerCase().replace(/_/g, '-')
  const name = Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined
  const asset = name ? sources[name] : undefined
  // The icons entry point is also consumed by TypeScript-only plugins. Keep
  // this component JSX-free rather than imposing a jsx option on every caller.
  return createElement(
    'span',
    {
      className,
      'data-provider-brand': name ?? 'generic',
      'data-provider-source': asset?.source ?? 'generic',
      'aria-hidden': true,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: size,
        height: size,
      },
    },
    !asset
      ? createElement(IconDataOutlineRegular, { size })
      : asset.monochrome
        ? createElement('span', {
            style: {
              width: '100%',
              height: '100%',
              background: 'currentColor',
              maskImage: `url("${asset.uri}")`,
              WebkitMaskImage: `url("${asset.uri}")`,
              maskSize: 'contain',
              maskPosition: 'center',
              maskRepeat: 'no-repeat',
            },
          })
        : createElement('img', { src: asset.uri, alt: '', width: size, height: size, draggable: false })
  )
}
