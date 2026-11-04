const SVG_NS = 'http://www.w3.org/2000/svg'

/** Stroke glyphs in the shipped icon grid for DOM-injected native menu rows. */
export const activityIconPath = 'M2.25 8.5h2.9l1.55-4.5 2.55 8 1.55-4.5h2.95'
/** Fallback check, used only when no selected native row exists to copy. */
export const checkIconPath = 'M2.25 8.5L5.5 11.75C5.9 12.15 6.57 12.13 6.95 11.7L13.75 4'

export function createIconGlyph(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('xmlns', SVG_NS)
  svg.setAttribute('aria-hidden', 'true')
  const line = document.createElementNS(SVG_NS, 'path')
  line.setAttribute('d', path)
  line.setAttribute('stroke', 'currentColor')
  line.setAttribute('stroke-width', '1')
  line.setAttribute('stroke-linecap', 'round')
  line.setAttribute('stroke-linejoin', 'round')
  svg.append(line)
  return svg
}
