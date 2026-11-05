export const channel = '/api'
export const method = 'dungsil-usage/describe'
export const callLimit = 100

export interface UsageTotals {
  calls: number
  unreported: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface UsageView {
  totals: UsageTotals
  models: (UsageTotals & { provider: string; model: string })[]
  calls: (UsageTotals & {
    session: string
    seq: number
    time: number
    provider: string
    model: string
    status: 'success' | 'failure' | 'interrupted' | 'unknownStatus'
  })[]
  days: { day: string; total: number }[]
  sessions: number
  unreadable: number
  updatedAt: number
  timeZone: string
}
