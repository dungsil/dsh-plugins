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

/* Worktree integration into the original checkout. */
export type MergeMethod = 'merge' | 'rebase' | 'squash'
export type IntegrationMethod = 'ff' | 'cherry-pick' | MergeMethod
export type IntegrationBlocker = 'read-only' | 'detached' | 'in-progress' | 'staged' | 'overlap'
export const mergeMethods: readonly MergeMethod[] = ['merge', 'rebase', 'squash']
export const inspectMethod = 'dungsil-forge-integration/inspect'
export const runMethod = 'dungsil-forge-integration/run'

/** The single integration the Host proposes for a Session working in a linked worktree. */
export interface IntegrationProposal {
  readonly source: { readonly root: string; readonly branch: string | null; readonly head: string }
  readonly target: { readonly root: string; readonly branch: string | null; readonly head: string }
  /** Suggested method: fast-forward, one cherry-pick, or the configured merge-family method. */
  readonly method: IntegrationMethod
  /** Methods the menu may offer for the same heads. */
  readonly methods: readonly IntegrationMethod[]
  /** Commits of the source that the target does not have. */
  readonly commits: number
  readonly blocker: IntegrationBlocker | null
  /** A few paths that explain a `staged` or `overlap` blocker. */
  readonly paths: readonly string[]
}

export type IntegrationErrorCode = 'unavailable' | 'busy' | 'stale' | 'blocked' | 'failed' | 'cleanup-refused'
