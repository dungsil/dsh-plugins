/** Stroke glyphs in the shipped icon grid for DOM-injected native menu rows. */
export { default as activityIconSvg } from './icons/activity.svg'
/** Fallback check, used only when no selected native row exists to copy. */
export { default as checkIconSvg } from './icons/check.svg'

/** Accepts only trusted SVG assets bundled at build time. */
export function createIconGlyph(svg: string): SVGSVGElement {
  const template = document.createElement('template')
  template.innerHTML = svg
  return template.content.querySelector('svg')!
}
