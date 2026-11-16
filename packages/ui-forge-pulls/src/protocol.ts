export const channel = '/api'
export const method = 'dungsil-forge-pulls/pull-requests/list'
export const actionMethod = 'dungsil-forge-pulls/pull-requests/action'

export interface GitContext {
  operation: 'push' | 'pr'
  headSha: string
  dirty: boolean
}

export type MergeMethod = 'merge' | 'squash' | 'rebase'

export interface RequestAction {
  sessionId: string
  requestUrl: string
  headSha: string
  action: 'comment' | 'approve' | 'request_changes' | 'merge'
  body?: string
  strategy?: MergeMethod
  branch?: string
  target?: string
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
  comments: Array<{ author: string; body: string; url: string }>
  reviews: Array<{ author: string; body: string; state: string }>
  detailsError?: boolean
  mergeMethods?: MergeMethod[]
}

export interface RequestView {
  provider: 'github' | 'gitlab' | 'gitea' | 'forgejo'
  repository: string
  branch: string
  checkoutBranch?: string
  request: RequestItem | null
}
