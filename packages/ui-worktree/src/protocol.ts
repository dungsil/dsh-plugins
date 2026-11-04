export const channel = '/api'
export const endpointPrefix = 'dungsil-worktree/'

export interface WorktreeSettings {
  directory: string
  remote: boolean
  naming: 'semantic' | 'dsh' | 'custom'
  prefix: string
}

export interface WorktreeSettingsView {
  revision: string
  settings: WorktreeSettings
}

export interface WorktreeView {
  cwd: string
  worktrees: { path: string; branch: string | null }[]
}
