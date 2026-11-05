export const channel = '/api'
export const describeMethod = 'dungsil-vcs/describe'
export const executeMethod = 'dungsil-vcs/execute'

export type GitOperation = 'commit' | 'push' | 'pr'

export interface GitActionRequest {
  sessionId: string
  cwd: string
  operation: GitOperation
  requestId: string
}

export interface GitActionResult {
  operation: GitOperation
  commit?: string
  branch: string
  url?: string
  checks: string[]
}

export function isGitActionResult(value: unknown): value is GitActionResult {
  if (!value || typeof value !== 'object') return false
  const result = value as GitActionResult
  return (
    ['commit', 'push', 'pr'].includes(result.operation) &&
    typeof result.branch === 'string' &&
    (result.commit === undefined || /^[a-f0-9]{40,64}$/.test(result.commit)) &&
    (result.url === undefined || /^https?:\/\//.test(result.url)) &&
    Array.isArray(result.checks) &&
    result.checks.every((check) => typeof check === 'string')
  )
}
