export function pullRequestUrl(value: string): string | undefined {
  try {
    if (
      !/^https?:\/\//i.test(value) ||
      value.length > 4096 ||
      value.includes('\\') ||
      value.split('').some((character) => character <= ' ' || character === '\u007f')
    )
      return
    const url = new URL(value)
    if (url.username || url.password || url.pathname !== value.match(/^https?:\/\/[^@/?#]+([^?#]*)/i)?.[1]) return
    const match =
      /^(\/(?:[\w.-]+\/)+)(pull|pulls|merge_requests)\/([1-9]\d*)(?:\/(?:files|commits|checks|diffs))?\/?$/.exec(
        url.pathname
      )
    if (!match || !Number.isSafeInteger(Number(match[3]))) return
    if (match[2] === 'merge_requests' && !match[1].endsWith('/-/')) return
    if (match[2] !== 'merge_requests' && match[1].split('/').filter(Boolean).length < 2) return
    url.pathname = `${match[1]}${match[2]}/${match[3]}`
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return
  }
}

export function bindPullRequestLinks(root: Element, open: (url: string) => boolean): () => void {
  const click = (event: Event) => {
    const mouse = event as MouseEvent
    if (
      event.defaultPrevented ||
      mouse.button !== 0 ||
      mouse.metaKey ||
      mouse.ctrlKey ||
      mouse.shiftKey ||
      mouse.altKey
    )
      return
    const target = event.target instanceof Element ? event.target : null
    const anchor = target?.closest('a[href]')
    if (!anchor || !root.contains(anchor) || anchor.hasAttribute('download')) return
    const url = pullRequestUrl(anchor.getAttribute('href') ?? '')
    if (!url) return
    try {
      if (!open(url)) return
    } catch {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }
  root.addEventListener('click', click, true)
  return () => root.removeEventListener('click', click, true)
}
