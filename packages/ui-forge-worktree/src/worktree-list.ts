import { isAbsolute } from 'node:path'

export interface ListedWorktree {
  readonly path: string
  readonly branch: string | null
}

/** Parse `git worktree list --porcelain -z` without Git's quoted-path ambiguity. */
export function parseWorktreeList(output: string): ListedWorktree[] {
  const entries: ListedWorktree[] = []
  let path: string | undefined
  let branch: string | null = null
  let excluded = false
  const flush = () => {
    if (path !== undefined && isAbsolute(path) && !excluded) entries.push({ path, branch })
    path = undefined
    branch = null
    excluded = false
  }
  for (const field of output.split('\0')) {
    if (field === '') {
      flush()
    } else if (field.startsWith('worktree ')) {
      flush()
      path = field.slice('worktree '.length)
    } else if (field.startsWith('branch ')) {
      const value = field.slice('branch '.length)
      branch = value.startsWith('refs/heads/') ? value.slice('refs/heads/'.length) : value
    } else if (field === 'detached') {
      branch = null
    } else if (field === 'bare' || field === 'prunable' || field.startsWith('prunable ')) {
      excluded = true
    }
  }
  flush()
  return entries
}

/** Keep the active checkout visible even when it falls outside the recency cap. */
export function capWorktrees<T>(entries: readonly T[], current: T | undefined, limit = 50): T[] {
  const visible = entries.slice(0, limit)
  if (current !== undefined && limit > 0 && entries.includes(current) && !visible.includes(current)) {
    visible[visible.length - 1] = current
  }
  return visible
}

/** Display at most one page, retaining the selected entry on every page. */
export function worktreePage<T>(entries: readonly T[], current: T | undefined, page: number, size = 5): T[] {
  const others = current === undefined ? entries : entries.filter((entry) => entry !== current)
  const offset = Math.max(0, Math.floor(page)) * size
  const visible = others.slice(offset, offset + size)
  return current !== undefined && entries.includes(current) ? [current, ...visible] : visible
}
