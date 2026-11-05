export const channel = '/api'
export const method = 'dungsil-vcs/pull-requests/list'
export const actionMethod = 'dungsil-vcs/pull-requests/action'

export interface GitContext {
  operation: 'push' | 'pr'
  headSha: string
  dirty: boolean
}

export interface RequestAction {
  sessionId: string
  requestUrl: string
  headSha: string
  action: 'comment' | 'approve' | 'request_changes' | 'merge'
  body?: string
  strategy?: 'merge' | 'squash' | 'rebase'
}

export interface RequestItem {
  number: number
  title: string
  url: string
  author: string
  source: string
  target: string
  draft: boolean
  state: 'open' | 'closed' | 'merged'
  body: string
  headSha: string
  mergeable: string
  reviewDecision: string
  checks: Array<{ name: string; status: string; url: string }>
  files: Array<{ path: string; additions: number; deletions: number }>
  diff: string
  diffTruncated: boolean
  comments: Array<{ author: string; body: string; url: string }>
  reviews: Array<{ author: string; body: string; state: string }>
  detailsError?: boolean
}

export interface RequestView {
  provider: 'github' | 'gitlab' | 'gitea' | 'forgejo'
  repository: string
  branch: string
  request: RequestItem | null
}
