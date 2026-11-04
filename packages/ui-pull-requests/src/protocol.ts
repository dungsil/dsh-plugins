export const channel = '/api'
export const method = 'dungsil-pull-requests/list'

export interface RequestItem {
  number: number
  title: string
  url: string
  author: string
  source: string
  target: string
  draft: boolean
  state: 'open' | 'closed' | 'merged'
}

export interface RequestView {
  provider: 'github' | 'gitlab'
  repository: string
  branch: string
  request: RequestItem | null
}
