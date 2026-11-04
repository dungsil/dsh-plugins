export interface QuotaWindow {
  id: string
  usedPercent?: number
  resetAt?: string
  periodSeconds?: number
}

export interface QuotaResult {
  windows: QuotaWindow[]
  observedAt: string
  plan?: string
}

type Management = (path: string, method?: string, body?: unknown) => Promise<unknown>
type RecordValue = Record<string, unknown>
type QuotaError = 'invalid_response' | 'upstream_failed' | 'unsupported' | 'invalid'

function fail(code: QuotaError): never {
  throw new Error(code)
}

function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function encoded(value: string): string {
  try {
    return encodeURIComponent(value)
  } catch {
    fail('invalid')
  }
}

function jsonRecord(value: unknown): RecordValue {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      fail('invalid_response')
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('invalid_response')
  return value as RecordValue
}

function number(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function percent(value: unknown): number | undefined {
  const parsed = number(value)
  return parsed !== undefined && parsed >= 0 && parsed <= 100 ? parsed : undefined
}

function positive(value: unknown): number | undefined {
  const parsed = number(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

function instant(value: unknown): string | undefined {
  const seconds = number(value)
  const ms =
    seconds !== undefined
      ? seconds * 1000
      : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
        ? Date.parse(value)
        : NaN
  return Number.isFinite(ms) && ms >= 0 && Number.isFinite(new Date(ms).getTime())
    ? new Date(ms).toISOString()
    : undefined
}

function planName(value: unknown): string | undefined {
  const name = text(value)
  // Only short plan fields, never arbitrary profile objects, identifiers, or error text.
  return name && name.length <= 64 && /^[\p{L}\p{N} _+().-]+$/u.test(name) ? name : undefined
}

function provider(account: RecordValue): string {
  const key = text(account.provider ?? account.type)
    .toLowerCase()
    .replace(/_/g, '-')
  if (key === 'kimi-ai') return 'kimi'
  if (key === 'grok' || key === 'x-ai') return 'xai'
  return key
}

function pluginId(account: RecordValue): string {
  const supported = account.supports_quota ?? account.supportsQuota
  return supported === true || supported === 'true' || supported === '1'
    ? text(account.quota_plugin_id ?? account.quotaPluginId)
    : ''
}

export function supportsQuota(account: Record<string, unknown>): boolean {
  const disabled = account.disabled
  if (
    disabled === true ||
    (typeof disabled === 'number' && disabled !== 0) ||
    ['true', '1'].includes(text(disabled).toLowerCase())
  )
    return false
  return (
    ['claude', 'codex', 'antigravity', 'kimi', 'devin', 'meta', 'xai'].includes(provider(account)) ||
    Boolean(pluginId(account))
  )
}

async function managementCall(management: Management, path: string, method = 'GET', body?: unknown) {
  try {
    return await management(path, method, body)
  } catch {
    fail('upstream_failed')
  }
}

async function download(account: RecordValue, management: Management): Promise<RecordValue> {
  const name = text(account.name)
  if (!name || [account.runtimeOnly, account.runtime_only].some((value) => value === true || value === 'true')) {
    fail('invalid')
  }
  return jsonRecord(await managementCall(management, `credentials/download?name=${encoded(name)}`))
}

// URLs and headers are owned here on the server; none are supplied by an RPC caller.
async function apiCall(
  management: Management,
  authIndex: string,
  url: string,
  header: Record<string, string>,
  data?: unknown
): Promise<RecordValue> {
  const response = record(
    await managementCall(management, 'requests/api-call', 'POST', {
      auth_index: authIndex,
      method: data === undefined ? 'GET' : 'POST',
      url,
      header,
      ...(data === undefined ? {} : { data: JSON.stringify(data) }),
    })
  )
  if (typeof response.status_code !== 'number' || !Number.isInteger(response.status_code)) fail('invalid_response')
  if (response.status_code < 200 || response.status_code >= 300) fail('upstream_failed')
  if (typeof response.body !== 'string') fail('invalid_response')
  return jsonRecord(response.body)
}

function addWindow(windows: QuotaWindow[], id: string, used: unknown, reset?: unknown, duration?: unknown) {
  if (windows.length >= 100) return
  const usedPercent = percent(used)
  const resetAt = instant(reset)
  const periodSeconds = positive(duration)
  if (usedPercent === undefined && resetAt === undefined && periodSeconds === undefined) return
  windows.push({
    id,
    ...(usedPercent === undefined ? {} : { usedPercent }),
    ...(resetAt === undefined ? {} : { resetAt }),
    ...(periodSeconds === undefined ? {} : { periodSeconds }),
  })
}

function fromRemaining(value: unknown, scale: number): number | undefined {
  const remaining = number(value)
  return remaining !== undefined && remaining >= 0 && remaining <= scale ? 100 - (remaining / scale) * 100 : undefined
}

function groupWindows(payload: RecordValue, windows: QuotaWindow[]) {
  if (payload.groups !== undefined && !Array.isArray(payload.groups)) fail('invalid_response')
  if (!Array.isArray(payload.groups)) return
  for (const [groupIndex, group] of payload.groups.entries()) {
    const buckets = record(group).buckets
    if (!Array.isArray(buckets)) continue
    for (const [bucketIndex, value] of buckets.entries()) {
      const bucket = record(value)
      const window = text(bucket.window).toLowerCase()
      const duration = ['5h', 'five-hour', 'five_hour'].includes(window)
        ? 18000
        : ['weekly', 'week'].includes(window)
          ? 604800
          : undefined
      // Project only quota display fields, not arbitrary bucket IDs/descriptions.
      const groupLabel = planName(record(group).displayName ?? record(group).display_name)
      const bucketLabel = planName(bucket.displayName ?? bucket.display_name) ?? planName(bucket.window)
      const label = [groupLabel, bucketLabel].filter(Boolean).join(' ').slice(0, 96)
      addWindow(
        windows,
        label || `group-${groupIndex + 1}-bucket-${bucketIndex + 1}`,
        fromRemaining(bucket.remainingFraction ?? bucket.remaining_fraction, 1),
        bucket.resetTime ?? bucket.reset_time,
        duration
      )
      if (windows.length >= 100) return
    }
  }
}

function codexAccountId(account: RecordValue): string {
  const sources = [account, record(account.metadata), record(account.attributes)]
  for (const source of sources) {
    const direct = text(source.chatgpt_account_id ?? source.chatgptAccountId)
    if (direct && !/[\r\n]/.test(direct)) return direct
  }
  for (const source of sources) {
    let token = source.id_token
    if (typeof token === 'string') {
      const rawToken = token
      try {
        token = JSON.parse(token)
      } catch {
        try {
          token = JSON.parse(Buffer.from(rawToken.split('.')[1] ?? '', 'base64url').toString('utf8'))
        } catch {
          continue
        }
      }
    }
    const claims = record(token)
    const auth = record(claims['https://api.openai.com/auth'])
    const id = text(claims.chatgpt_account_id ?? claims.chatgptAccountId ?? auth.chatgpt_account_id)
    if (id && !/[\r\n]/.test(id)) return id
  }
  return ''
}

function codexWindows(payload: RecordValue, windows: QuotaWindow[], now: number) {
  const limits: [string, unknown][] = [
    ['', payload.rate_limit ?? payload.rateLimit],
    ['code_review_', payload.code_review_rate_limit ?? payload.codeReviewRateLimit],
  ]
  const additional = payload.additional_rate_limits ?? payload.additionalRateLimits
  if (Array.isArray(additional)) {
    additional.slice(0, 50).forEach((value, i) => {
      const item = record(value)
      const name = planName(item.limit_name ?? item.limitName ?? item.metered_feature ?? item.meteredFeature)
      limits.push([`${name ?? `additional-${i + 1}`} `, item.rate_limit ?? item.rateLimit])
    })
  }
  for (const [prefix, value] of limits) {
    const limit = record(value)
    for (const [position, raw] of [
      limit.primary_window ?? limit.primaryWindow,
      limit.secondary_window ?? limit.secondaryWindow,
    ].entries()) {
      const window = record(raw)
      const duration = positive(window.limit_window_seconds ?? window.limitWindowSeconds)
      const id = position === 0 ? 'primary_window' : 'secondary_window'
      const offset = number(window.reset_after_seconds ?? window.resetAfterSeconds)
      const reset =
        instant(window.reset_at ?? window.resetAt) ??
        (offset !== undefined && offset >= 0 ? instant(now / 1000 + offset) : undefined)
      addWindow(windows, `${prefix}${id}`, window.used_percent ?? window.usedPercent, reset, duration)
    }
  }
}

function kimiDomain(value: unknown, isUrl = false): 'ai' | 'com' | undefined {
  let domain = text(value).toLowerCase()
  if (isUrl) {
    try {
      domain = new URL(domain).hostname
    } catch {
      return
    }
  }
  if (['ai', 'kimi-ai', 'kimi_ai', 'kimi.ai'].includes(domain) || domain.endsWith('.kimi.ai')) return 'ai'
  if (['com', 'kimi', 'kimi.com'].includes(domain) || domain.endsWith('.kimi.com')) return 'com'
}

function kimiWindows(payload: RecordValue, windows: QuotaWindow[], now: number) {
  const rows: [string, RecordValue, RecordValue][] = []
  if (Array.isArray(payload.limits)) {
    payload.limits.slice(0, 100).forEach((value, i) => {
      const item = record(value)
      const detail = record(item.detail ?? item)
      const name = planName(item.displayName ?? item.name ?? item.title ?? detail.name ?? detail.title)
      rows.push([name ?? `limit-${i + 1}`, detail, item])
    })
  }
  if (payload.usage) rows.push(['weekly', record(payload.usage), {}])
  for (const [id, detail, item] of rows) {
    const limit = positive(detail.limit)
    const remaining = number(detail.remaining)
    const used = number(detail.used) ?? (limit !== undefined && remaining !== undefined ? limit - remaining : undefined)
    const offset = number(detail.reset_in ?? detail.resetIn ?? detail.ttl)
    const reset =
      instant(detail.reset_at ?? detail.resetAt ?? detail.reset_time ?? detail.resetTime) ??
      (offset !== undefined && offset >= 0 ? instant(now / 1000 + offset) : undefined)
    const window = record(item.window)
    const duration = positive(window.duration ?? item.duration ?? detail.duration)
    const unit = text(window.timeUnit ?? item.timeUnit ?? detail.timeUnit)
      .toUpperCase()
      .replace(/^TIME_UNIT_/, '')
    const multiplier = /^SECONDS?$/.test(unit)
      ? 1
      : /^HOURS?$/.test(unit)
        ? 3600
        : /^DAYS?$/.test(unit)
          ? 86400
          : /^WEEKS?$/.test(unit)
            ? 604800
            : 60
    addWindow(
      windows,
      id,
      limit !== undefined && used !== undefined ? (used / limit) * 100 : undefined,
      reset,
      duration === undefined ? undefined : duration * multiplier
    )
  }
  const monthly = record(record(payload.usages).limit_month_total)
  const ratio = number(monthly.used_ratio)
  addWindow(windows, 'monthly', ratio === undefined ? undefined : ratio * 100, monthly.reset_time)
}

export async function fetchQuota(
  account: Record<string, unknown>,
  management: (path: string, method?: string, body?: unknown) => Promise<unknown>
): Promise<QuotaResult> {
  if (!supportsQuota(account)) fail('unsupported')
  const rawIndex = account.auth_index ?? account.authIndex
  const authIndex = typeof rawIndex === 'number' && Number.isFinite(rawIndex) ? String(rawIndex) : text(rawIndex)
  if (!authIndex) fail('invalid')
  const windows: QuotaWindow[] = []
  const now = Date.now()
  let plan: string | undefined
  const kind = provider(account)
  const bearer = { Authorization: 'Bearer $TOKEN$' }
  const jsonHeaders = { ...bearer, 'Content-Type': 'application/json' }
  const id = pluginId(account)
  if (id) {
    const payload = jsonRecord(
      await managementCall(management, `plugins/${encoded(id)}/quota`, 'POST', { auth_index: authIndex })
    )
    groupWindows(payload, windows)
    const subscription = record(payload.subscription)
    plan = planName(subscription.plan ?? subscription.tierName ?? subscription.tierId)
  } else if (kind === 'claude') {
    const payload = await apiCall(management, authIndex, 'https://api.anthropic.com/api/oauth/usage', {
      ...jsonHeaders,
      Accept: 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-cli/2.1.280 (external, cli)',
    })
    for (const key of [
      'five_hour',
      'seven_day',
      'seven_day_oauth_apps',
      'seven_day_opus',
      'seven_day_sonnet',
      'seven_day_cowork',
      'iguana_necktie',
    ]) {
      if (payload[key] === null || typeof payload[key] !== 'object' || Array.isArray(payload[key])) continue
      const window = record(payload[key])
      addWindow(
        windows,
        key === 'iguana_necktie' ? 'credits' : key,
        window.utilization,
        window.resets_at,
        key === 'five_hour' ? 18000 : key === 'iguana_necktie' ? undefined : 604800
      )
    }
    plan = planName(payload.plan_type)
  } else if (kind === 'codex') {
    const accountId = codexAccountId(account)
    const payload = await apiCall(management, authIndex, 'https://chatgpt.com/backend-api/wham/usage', {
      ...jsonHeaders,
      'User-Agent': 'codex-tui/0.149.1 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.149.1)',
      ...(accountId ? { 'Chatgpt-Account-Id': accountId } : {}),
    })
    codexWindows(payload, windows, now)
    plan = planName(payload.plan_type ?? payload.planType)
  } else if (kind === 'antigravity') {
    const metadata = record(account.metadata)
    const attributes = record(account.attributes)
    let project =
      text(account.project_id ?? account.projectId) ||
      text(metadata.project_id ?? metadata.projectId) ||
      text(attributes.project_id ?? attributes.projectId ?? attributes.gemini_virtual_project)
    if (!project) {
      const credential = await download(account, management)
      project =
        text(credential.project_id ?? credential.projectId) ||
        text(record(credential.installed).project_id ?? record(credential.installed).projectId) ||
        text(record(credential.web).project_id ?? record(credential.web).projectId)
    }
    if (!project) fail('invalid')
    let payload: RecordValue | undefined
    let lastCode: QuotaError = 'upstream_failed'
    for (const host of [
      'daily-cloudcode-pa.googleapis.com',
      'daily-cloudcode-pa.sandbox.googleapis.com',
      'cloudcode-pa.googleapis.com',
    ]) {
      try {
        payload = await apiCall(
          management,
          authIndex,
          `https://${host}/v1internal:retrieveUserQuotaSummary`,
          {
            ...jsonHeaders,
            'User-Agent': 'antigravity/hub/2.23.0 darwin/arm64',
          },
          { project }
        )
        if (!Array.isArray(payload.groups)) fail('invalid_response')
        break
      } catch (error) {
        payload = undefined
        lastCode =
          error instanceof Error && error.message === 'invalid_response' ? 'invalid_response' : 'upstream_failed'
      }
    }
    if (!payload) fail(lastCode)
    groupWindows(payload, windows)
    plan = planName(record(payload.subscription).plan)
  } else if (kind === 'kimi') {
    const credential = await download(account, management)
    const explicit = text(credential.domain)
    const domain =
      (explicit ? (kimiDomain(explicit) ?? 'com') : undefined) ??
      kimiDomain(Object.hasOwn(credential, 'base_url') ? credential.base_url : credential['base-url'], true) ??
      kimiDomain(credential.type) ??
      kimiDomain(account.provider ?? account.type) ??
      'com'
    const payload = await apiCall(management, authIndex, `https://api.kimi.${domain}/coding/v1/usages`, bearer)
    kimiWindows(payload, windows, now)
  } else if (kind === 'devin') {
    const payload = await apiCall(
      management,
      authIndex,
      'https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus',
      { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
      {
        metadata: {
          ideName: 'chisel',
          ideVersion: '3000.10.21',
          apiKey: '$TOKEN$',
          locale: 'en',
          os: 'darwin',
          extensionVersion: '3000.10.21',
          clientName: 'chisel',
        },
      }
    )
    const status = record(record(payload.userStatus).planStatus)
    for (const id of ['daily', 'weekly']) {
      if (!Object.hasOwn(status, `${id}QuotaRemainingPercent`) && !Object.hasOwn(status, `${id}QuotaResetAtUnix`))
        continue
      addWindow(
        windows,
        id,
        fromRemaining(status[`${id}QuotaRemainingPercent`], 100),
        status[`${id}QuotaResetAtUnix`],
        id === 'daily' ? 86400 : 604800
      )
    }
    plan = planName(record(status.planInfo).planName)
  } else if (kind === 'meta') {
    const credential = await download(account, management)
    const token = text(credential.dca_token)
    if (!/^dca:[^\s]+$/.test(token)) fail('invalid')
    const payload = await apiCall(
      management,
      authIndex,
      'https://api.meta.ai/muse-code/key',
      {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-api-version': '1.0.0',
      },
      {}
    )
    const usage = record(payload.subs_usage)
    for (const id of ['window', 'weekly']) {
      const window = record(usage[id])
      const minutes = positive(window.window_duration_mins)
      addWindow(
        windows,
        id === 'window' ? 'primary_window' : id,
        window.used_percent,
        window.resets_at,
        id === 'window' && minutes !== undefined ? minutes * 60 : undefined
      )
    }
    plan = planName(payload.subs_tier_name ?? usage.tier)
  } else if (kind === 'xai') {
    const header: Record<string, string> = {
      ...bearer,
      'x-xai-token-auth': 'xai-grok-cli',
      'x-grok-client-version': '1.0.46',
      accept: '*/*',
      'user-agent': 'grok-pager/1.0.46 grok-shell/1.0.46 (macos; aarch64)',
    }
    const sources = [account, record(account.metadata), record(account.attributes)]
    const userId = sources
      .map(
        (source) =>
          text(source.sub ?? source.subject ?? source.user_id ?? source.userId) ||
          text(record(source.oauth).sub ?? record(source.oauth).subject) ||
          text(record(source.user).sub ?? record(source.user).id)
      )
      .find(Boolean)
    if (userId && !/[\r\n]/.test(userId)) header['x-userid'] = userId
    const results = await Promise.allSettled([
      apiCall(management, authIndex, 'https://cli-chat-proxy.grok.com/v1/billing?format=credits', header),
      apiCall(management, authIndex, 'https://cli-chat-proxy.grok.com/v1/billing', header),
    ])
    if (results.every((result) => result.status === 'rejected')) {
      const invalid = results.some(
        (result) =>
          result.status === 'rejected' && result.reason instanceof Error && result.reason.message === 'invalid_response'
      )
      fail(invalid ? 'invalid_response' : 'upstream_failed')
    }
    for (const [i, result] of results.entries()) {
      if (result.status !== 'fulfilled') continue
      const config = record(result.value.config)
      const period = record(config.currentPeriod ?? config.current_period)
      const end = period.end ?? config.billingPeriodEnd ?? config.billing_period_end
      const startAt = instant(period.start ?? config.billingPeriodStart ?? config.billing_period_start)
      const endAt = instant(end)
      const duration = startAt && endAt ? (Date.parse(endAt) - Date.parse(startAt)) / 1000 : undefined
      const limitValue = config.monthlyLimit ?? config.monthly_limit
      const limit = positive(record(limitValue).val ?? limitValue)
      const used = number(record(config.used).val ?? config.used)
      const credit = config.creditUsagePercent ?? config.credit_usage_percent
      addWindow(
        windows,
        i === 0
          ? ['daily', 'weekly', 'monthly'].includes(text(period.type))
            ? text(period.type)
            : 'credits'
          : 'monthly',
        i === 0 ? credit : limit !== undefined && used !== undefined ? (used / limit) * 100 : undefined,
        end,
        duration
      )
    }
  }
  return { windows, observedAt: new Date().toISOString(), ...(plan ? { plan } : {}) }
}
