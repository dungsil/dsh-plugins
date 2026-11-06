export const channel = '/api'
export const endpointPrefix = 'dungsil-worktree/'
export const ownershipRecord = 'plugin:dungsil/ui-worktree/ownership'
declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    'plugin:dungsil/ui-worktree/ownership': { path: string; source: string; branch: string; sessionId: string }
  }
}
export interface WorktreeSettings {
  directory: string
  remote: boolean
  deleteOnArchive: boolean
  naming: 'semantic' | 'dsh' | 'custom'
  prefix: string
}

export interface WorktreeSettingsView {
  revision: string
  settings: WorktreeSettings
}

export interface WorktreeSelectionView {
  cwd: string
}

export interface WorktreeView extends WorktreeSelectionView {
  worktrees: { path: string; branch: string | null }[]
}
function comparablePath(path: string) {
  const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || path.startsWith('//')
  const value = windows ? path.replaceAll('\\', '/').replace(/^[A-Z]:/, (drive) => drive.toLowerCase()) : path
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return value.slice(0, end)
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
