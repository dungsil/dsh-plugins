export const channel = '/api'
export const endpointPrefix = 'dungsil-ui-settings-web-search/'

// DSH tool-web schema defaults; the profile's explicit values take precedence.
export const defaults = {
  search: true,
  fetch: true,
  searchMaxResults: 8,
  searchMaxQueries: 4,
  searchTimeoutMs: 30000,
  fetchTimeoutMs: 30000,
  fetchMaxOutputChars: 200000,
}

export type WebToolSettings = typeof defaults
export type NumericField = Exclude<keyof WebToolSettings, 'search' | 'fetch'>
export const numericFields: NumericField[] = [
  'searchMaxResults',
  'searchMaxQueries',
  'searchTimeoutMs',
  'fetchTimeoutMs',
  'fetchMaxOutputChars',
]

export function validSettings(value: unknown): value is WebToolSettings {
  if (!value || typeof value !== 'object') return false
  const settings = value as WebToolSettings
  return (
    typeof settings.search === 'boolean' &&
    typeof settings.fetch === 'boolean' &&
    numericFields.every((key) => Number.isSafeInteger(settings[key]) && settings[key] > 0)
  )
}

export interface WebToolTarget {
  id: string
  label: string
  preset: boolean
  revision: string
  settings: WebToolSettings
}
