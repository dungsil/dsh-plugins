import { providerFamilies } from './protocol.js'

type Row = Record<string, unknown>

function record(value: unknown): Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isDisabled(value: unknown): boolean {
  return (
    value === true || (typeof value === 'number' && value !== 0) || ['true', '1'].includes(text(value).toLowerCase())
  )
}

export function apiKeyQuotaProvider(value: unknown): 'opencode-go' | 'ollama-cloud' | undefined {
  try {
    const url = new URL(text(value))
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return
    const path = url.pathname.replace(/\/+$/, '')
    if (
      url.hostname === 'opencode.ai' &&
      /^\/(?:zen\/go(?:\/v1)?|inference\/go(?:\/(?:v1|openai\/v1|anthropic\/v1|google\/v1beta))?)$/.test(path)
    )
      return 'opencode-go'
    if (url.hostname === 'ollama.com' && ['', '/api', '/v1'].includes(path)) return 'ollama-cloud'
  } catch {
    return
  }
}

export function mergeAPIKeyAccounts(accounts: Row[], config: unknown, configRevision: string): Row[] {
  const families = record(record(config)['api-keys'])
  const result = [...accounts]
  for (const family of providerFamilies) {
    const groups = families[family]
    if (groups === undefined || groups === null) continue
    if (!Array.isArray(groups)) throw new Error('invalid_response')
    groups.forEach((value, groupIndex) => {
      const group = record(value)
      const keys = group.keys
      if (!Array.isArray(keys)) return
      keys.forEach((value, keyIndex) => {
        const key = record(value)
        const kind = apiKeyQuotaProvider(key['base-url'] ?? group['base-url'])
        if (!kind) return
        const authIndex = text(key.auth_index ?? key['auth-index'])
        const existingIndex = authIndex ? result.findIndex((row) => row.auth_index === authIndex) : -1
        const existing = existingIndex < 0 ? {} : result[existingIndex]!
        const groupName = text(group.name).slice(0, 256) || `${family} ${groupIndex + 1}`
        const row = {
          name: `${groupName} · ${keyIndex + 1}`,
          provider: kind,
          auth_index: authIndex,
          disabled: isDisabled(group.disabled) || isDisabled(key.disabled) || isDisabled(existing.disabled),
          source: 'config',
          runtime_only: true,
          modtime: existing.modtime,
          updated_at: existing.updated_at,
          // Compare the management ETag after lookup. The Client never receives this value or credentials.
          quotaConfigRevision: configRevision,
        }
        if (existingIndex < 0) result.push(row)
        else result[existingIndex] = row
      })
    })
  }
  return result
}
