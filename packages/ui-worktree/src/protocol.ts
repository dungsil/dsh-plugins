export const channel = '/api'
export const endpointPrefix = 'dungsil-worktree/'

export interface WorktreeView {
  cwd: string
  worktrees: { path: string; branch: string | null }[]
  pendingCreation?: { name: string; failed: boolean }
}

function comparablePath(path: string) {
  const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || path.startsWith('//')
  const value = windows ? path.replaceAll('\\', '/').replace(/^[A-Z]:/, (drive) => drive.toLowerCase()) : path
  return value.replace(/\/+$/, '')
}

export function currentWorktree(view: WorktreeView | undefined) {
  if (!view) return undefined
  const cwd = comparablePath(view.cwd)
  return view.worktrees
    .filter((item) => {
      const path = comparablePath(item.path)
      return cwd === path || cwd.startsWith(path + '/')
    })
    .sort((a, b) => comparablePath(b.path).length - comparablePath(a.path).length)[0]
}

export function isWorktreeView(value: unknown): value is WorktreeView {
  if (!value || typeof value !== 'object') return false
  const view = value as Partial<WorktreeView>
  return (
    typeof view.cwd === 'string' &&
    (view.pendingCreation === undefined ||
      (view.pendingCreation !== null &&
        typeof view.pendingCreation.name === 'string' &&
        typeof view.pendingCreation.failed === 'boolean')) &&
    Array.isArray(view.worktrees) &&
    view.worktrees.every(
      (item) => item && typeof item.path === 'string' && (item.branch === null || typeof item.branch === 'string')
    )
  )
}
