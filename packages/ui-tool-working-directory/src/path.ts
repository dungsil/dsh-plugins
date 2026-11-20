/** Only abbreviate the active home and its path descendants, never a same-prefix sibling. */
export function abbreviateHomePath(path: string, home: string | undefined | null): string {
  const root = home?.replace(/[\\/]+$/u, '')
  if (!root) return path
  if (path === root) return '~'
  if (path.startsWith(root) && (path[root.length] === '/' || path[root.length] === '\\')) {
    return '~' + path.slice(root.length)
  }
  return path
}
