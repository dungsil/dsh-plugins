export const channel = '/api'
export const endpointPrefix = 'dungsil-worktree/'

export interface WorktreeView {
  cwd: string
  worktrees: { path: string; branch: string | null }[]
}
