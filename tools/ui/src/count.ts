export interface CountParts {
  compact: string
  exact?: string
}

/** Shown for counts that are missing or not non-negative safe integers; never a substitute zero. */
const UNAVAILABLE_COUNT = '—'

/** Compact display and exact value for non-negative counts. */
export function countParts(count: number | null | undefined, language: string): CountParts {
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return { compact: UNAVAILABLE_COUNT }
  const locale = language.replaceAll('_', '-')
  const exact = new Intl.NumberFormat('en').format(count)
  let compact: string
  if (/^ko(?:-|$)/i.test(locale)) {
    try {
      compact = new Intl.NumberFormat(locale, {
        notation: count < 10_000 ? 'standard' : 'compact',
        maximumFractionDigits: count < 10_000 ? 0 : 1,
      }).format(count)
    } catch {
      compact = exact
    }
  } else if (count < 1000) {
    compact = String(count)
  } else {
    const round = (scaled: number) => (scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10)
    const thousands = round(count / 1000)
    // 999,950 rounds to 1000K; carry it to the next unit like the Korean compact form does.
    compact = count < 1_000_000 && thousands < 1000 ? `${thousands}K` : `${round(count / 1_000_000)}M`
  }
  return compact === exact ? { compact } : { compact, exact }
}

/** Plain text of a count: the compact form, then the exact form in parentheses when they differ. */
export function countText({ compact, exact }: CountParts): string {
  return exact === undefined ? compact : `${compact} (${exact})`
}
