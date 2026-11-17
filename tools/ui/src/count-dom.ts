/** Smaller, muted exact count after a compact one, as written by {@link markExactCounts}. */
export const exactCountStyles = `
[data-dsh-count-exact] {
  font-size: .85em;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
}
`

// The parenthesized exact part `countText` appends; a compact form never has thousands groups.
const EXACT = /\s\((\d{1,3}(?:,\d{3})+)\)/

interface Split {
  text: Text
  before: string
  original: string
  after: Text | undefined
}

/**
 * Restyles exact counts inside text another renderer owns, such as native React
 * text. Each split shortens the owner's text node in place and inserts sibling
 * nodes after it, so the owner can still replace or remove its node; stale
 * splits are dropped on the next mark and every split is undone by restore.
 */
export function createExactCountMarker() {
  const splits = new Map<HTMLElement, Split>()
  const owned = new WeakSet<Node>()

  function drop(span: HTMLElement, split: Split) {
    span.remove()
    split.after?.remove()
    if (split.text.nodeValue === split.before) split.text.nodeValue = split.original
    splits.delete(span)
  }

  function mark(root: Element) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const found: Text[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!owned.has(node) && !owned.has(node.parentNode!) && EXACT.test(node.nodeValue!)) found.push(node as Text)
    }
    for (let text of found) {
      // One text can hold several counts, such as `~839K (839,013) / 1M (1,048,576)`.
      for (let match = EXACT.exec(text.nodeValue!); match;) {
        const original = text.nodeValue!
        const before = original.slice(0, match.index + 1)
        const rest = original.slice(match.index + match[0].length)
        const span = document.createElement('span')
        span.dataset.dshCountExact = ''
        span.textContent = `(${match[1]})`
        owned.add(span)
        const after = rest === '' ? undefined : document.createTextNode(rest)
        if (after) owned.add(after)
        text.nodeValue = before
        text.after(...(after ? [span, after] : [span]))
        splits.set(span, { text, before, original, after })
        if (!after) break
        text = after
        match = EXACT.exec(rest)
      }
    }
  }

  return {
    /** Drops splits whose owner changed or removed its text, then splits new exact counts under each root. */
    mark(roots: Iterable<Element>) {
      for (const [span, split] of splits) {
        if (!span.isConnected || span.previousSibling !== split.text || split.text.nodeValue !== split.before)
          drop(span, split)
      }
      for (const root of roots) mark(root)
    },
    /** Puts every split text back as its owner wrote it. */
    restore() {
      for (const [span, split] of splits) drop(span, split)
    },
  }
}
