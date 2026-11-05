export const channel = '/api'
export const endpointPrefix = 'dungsil-worktree/'
export const progressRecord = 'plugin:dungsil/ui-worktree/progress'
export const selectionRecord = 'plugin:dungsil/ui-worktree/selection'
export const ownershipRecord = 'plugin:dungsil/ui-worktree/ownership'

export interface WorktreeProgress {
  id: string
  step: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  updatedAt: number
  durations: number[]
  branch?: string
}

declare module '@deepseek-ai/dsh-session' {
  interface PluginRecordMap {
    'plugin:dungsil/ui-worktree/progress': WorktreeProgress
    'plugin:dungsil/ui-worktree/selection': { initialized: true }
    'plugin:dungsil/ui-worktree/ownership': { path: string; source: string; branch: string; sessionId: string }
  }
}

export function isWorktreeProgress(value: unknown): value is WorktreeProgress {
  if (!value || typeof value !== 'object') return false
  const progress = value as WorktreeProgress
  return (
    typeof progress.id === 'string' &&
    Number.isInteger(progress.step) &&
    progress.step >= 0 &&
    progress.step < 4 &&
    ['running', 'completed', 'failed', 'cancelled'].includes(progress.status) &&
    Number.isFinite(progress.updatedAt) &&
    Array.isArray(progress.durations) &&
    progress.durations.length === 4 &&
    progress.durations.every((duration) => Number.isFinite(duration) && duration >= 0) &&
    (progress.branch === undefined || typeof progress.branch === 'string')
  )
}

export interface WorktreeSettings {
  defaultSelection: 'current' | 'new'
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
