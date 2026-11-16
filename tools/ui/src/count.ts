/** Compact display and exact value for non-negative counts. */
export function countParts(count: number, language: string): { compact: string; exact?: string } {
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
    const divisor = count < 1_000_000 ? 1000 : 1_000_000
    const scaled = count / divisor
    compact = `${scaled >= 100 ? Math.round(scaled) : Math.round(scaled * 10) / 10}${divisor === 1000 ? 'K' : 'M'}`
  }
  return compact === exact ? { compact } : { compact, exact }
}
