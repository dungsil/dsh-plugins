import type { Section } from './inbox.js'

export type FooterSection = Extract<Section, 'Working' | 'Archived' | 'Snoozed'>

/** Count only the native rows actually present in each footer. */
export function countFooterSections(sections: readonly FooterSection[]): Record<FooterSection, number> {
  const counts: Record<FooterSection, number> = { Working: 0, Archived: 0, Snoozed: 0 }
  for (const section of sections) counts[section]++
  return counts
}
