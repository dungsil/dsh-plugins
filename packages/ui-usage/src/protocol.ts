export const channel = '/api'
export const method = 'dungsil-usage/describe'
export const callLimit = 100
export const maxRangeDays = 366

export function isValidDateRange(startDate: string, endDate: string): boolean {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN
    const time = Date.parse(`${value}T00:00:00Z`)
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN
  }
  const start = parse(startDate)
  const end = parse(endDate)
  const inclusiveDays = (end - start) / 86_400_000 + 1
  return inclusiveDays >= 1 && inclusiveDays <= maxRangeDays
}

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
