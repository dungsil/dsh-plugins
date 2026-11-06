export const channel = '/api'
export const describeMethod = 'dungsil-vcs/describe'
export const executeMethod = 'dungsil-vcs/execute'

export interface CommitSettings {
  authorName: string
  authorEmail: string
  noSign: boolean
}

export interface CommitSettingsView {
  revision: string
  settings: CommitSettings
}

export function validCommitSettings(value: unknown): value is CommitSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const input = value as CommitSettings
  return (
    Object.keys(input).every((key) => ['authorName', 'authorEmail', 'noSign'].includes(key)) &&
    typeof input.authorName === 'string' &&
    input.authorName.length <= 200 &&
    !/[<>]/.test(input.authorName) &&
    !Array.from(input.authorName).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    typeof input.authorEmail === 'string' &&
    input.authorEmail.length <= 254 &&
    (input.authorEmail === '' || /^[^\s<>@]+@[^\s<>@]+$/.test(input.authorEmail)) &&
    !Array.from(input.authorEmail).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    (input.authorName === '' ? input.authorEmail === '' : !!input.authorName.trim() && !!input.authorEmail) &&
    typeof input.noSign === 'boolean'
  )
}

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
