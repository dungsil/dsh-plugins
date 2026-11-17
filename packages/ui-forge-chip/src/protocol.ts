/** Browser-safe contract of the worktree integration endpoints. */

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
