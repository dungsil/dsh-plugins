/** Marks every element this plugin inserts so scans and serialization skip it. */
export const OWN = 'data-answer-translation'

const BLOCKS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DETAILS',
  'DIV',
  'DL',
  'FIELDSET',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'MENU',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'UL',
])
// Kept verbatim: translators must not rewrite code, destinations, formulas, or interactive mentions.
const ATOMS = 'a, code, kbd, samp, img, svg, button, input, sup, [role="button"], [tabindex], .katex'

/** One answer paragraph rendered by the native Markdown renderer. */
export interface Paragraph {
  readonly element: HTMLElement
  /** Position among the row's paragraphs, independent of which ones are eligible. */
  readonly index: number
  /** Paragraph text with `⟦n⟧` in place of each preserved inline element. */
  readonly text: string
  /** Preserved inline elements, by placeholder number. */
  readonly atoms: readonly Element[]
}

/** Answer Markdown roots of one settled assistant row, excluding reasoning, which uses the compact variant. */
function answerRoots(scope: Element) {
  return [...scope.querySelectorAll<HTMLElement>('[data-text-interaction-source]:not([data-markdown-variant])')].filter(
    (root) => !root.closest(`[data-markdown-variant], [${OWN}]`) && !root.querySelector('[data-markdown-variant]')
  )
}

/** First nested block of a list item, before which its own inline content ends. */
export function firstBlockChild(element: Element): Element | null {
  for (const child of element.children) if (BLOCKS.has(child.tagName) && !child.hasAttribute(OWN)) return child
  return null
}

/** Serialize the element's own inline content; nested blocks such as sublists keep their own actions. */
export function serialize(element: Element): { text: string; atoms: Element[] } {
  let text = ''
  const atoms: Element[] = []
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) text += (child as Text).data
      if (!(child instanceof Element) || child.hasAttribute(OWN) || BLOCKS.has(child.tagName)) continue
      if (child.tagName === 'BR') text += '\n'
      else if (child.matches(ATOMS)) {
        text += `⟦${atoms.length}⟧`
        atoms.push(child)
      } else walk(child)
    }
  }
  walk(element)
  return {
    text: text
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .trim(),
    atoms,
  }
}

/**
 * Collect translatable paragraphs: `<p>` blocks and tight list items with their own text.
 * Headings, tables, code blocks, and footnotes stay unchanged.
 */
export function collectParagraphs(scope: Element): Paragraph[] {
  const result: Paragraph[] = []
  for (const root of answerRoots(scope)) {
    for (const element of root.querySelectorAll<HTMLElement>('p, li')) {
      if (element.closest(`[${OWN}], section[data-footnotes], table`)) continue
      // A loose list item holds paragraphs, which get their own actions.
      if (element.tagName === 'LI' && [...element.children].some((child) => child.tagName === 'P')) continue
      const { text, atoms } = serialize(element)
      if (text.replace(/⟦\d+⟧/g, '').trim() === '') continue
      result.push({ element, index: result.length, text, atoms })
    }
  }
  return result
}

/** Plain paragraph text for local language detection. */
export function prose(text: string) {
  return text.replace(/⟦\d+⟧/g, ' ')
}

/**
 * Split a translation into text and preserved-element indexes.
 * Placeholders a provider dropped are appended so no code or link disappears.
 */
export function restore(translated: string, count: number): Array<string | number> {
  const parts: Array<string | number> = []
  const used = new Set<number>()
  let last = 0
  for (const match of translated.matchAll(/⟦\s*(\d+)\s*⟧/g)) {
    const index = Number(match[1])
    if (index >= count || used.has(index)) continue
    if (match.index > last) parts.push(translated.slice(last, match.index))
    parts.push(index)
    used.add(index)
    last = match.index + match[0].length
  }
  if (last < translated.length) parts.push(translated.slice(last))
  for (let index = 0; index < count; index++) {
    if (!used.has(index)) parts.push(' ', index)
  }
  return parts
}
