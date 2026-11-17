/** Owner-only RPC contract between the composer chips and the host Git actions. */
export const channel = '/api'
export const methods = {
  settings: 'dungsil-forge-chip/settings',
  saveDefault: 'dungsil-forge-chip/default',
  commit: 'dungsil-forge-chip/commit',
  pr: 'dungsil-forge-chip/pr',
} as const

/** What the split chip's main button runs. A menu choice runs once and leaves this unchanged. */
export type DefaultAction = 'commit' | 'push'

export type ActionErrorCode =
  | 'unavailable'
  | 'nothing-to-commit'
  | 'message-failed'
  | 'commit-failed'
  | 'no-remote'
  /** The commit succeeded; only the push failed. */
  | 'push-failed'
  | 'not-pushed'
  | 'unsupported'
  | 'pr-failed'

export interface CommitResult {
  commit: string
  subject: string
  pushed: boolean
}

export interface PrResult {
  url: string
  reused: boolean
}
