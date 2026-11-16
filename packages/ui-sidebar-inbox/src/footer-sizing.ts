/** Compute a stable footer budget from the native container, not its content-sized tree. */
export function footerLimit(tree: HTMLElement, viewportHeight: number): number {
  const treeTop = tree.getBoundingClientRect().top
  for (let ancestor = tree.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const maxHeight = getComputedStyle(ancestor).maxHeight
    if (!maxHeight.endsWith('px')) continue
    const pixels = Number.parseFloat(maxHeight)
    if (!Number.isFinite(pixels) || pixels <= 0) continue
    const offset = treeTop - ancestor.getBoundingClientRect().top
    return Math.max(0, pixels - Math.max(0, offset)) / 2
  }
  // When no ancestor exposes a finite cap, bound the independent budget by the viewport.
  return Math.max(0, viewportHeight - Math.max(0, treeTop)) / 2
}

/** Watch each native ancestor because its constraint can change independently of the tree. */
export function observeFooterAncestors(observer: ResizeObserver, tree: HTMLElement): void {
  for (let element: HTMLElement | null = tree; element; element = element.parentElement) observer.observe(element)
}
