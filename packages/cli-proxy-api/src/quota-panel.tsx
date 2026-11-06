import { useState } from 'react'
import { Button, Input } from '@dungsil/dsh-ui'
import { IconRefreshOutlineRegular, IconSearchOutlineRegular, ProviderIcon } from '@dungsil/dsh-ui/icons'
import type { localizedCopy } from './copy.js'
import type { QuotaAccount, QuotaResult } from './protocol.js'
import { quotaKey } from './quota-cache.js'

type QuotaWindow = QuotaResult['windows'][number]

export const quotaStyles = `
.dsh-cli-quota { margin-top: 20px; }
.dsh-cli-quota .quota-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 16px; }
.dsh-cli-quota .quota-search { flex: 1; min-width: 160px; max-width: 340px; }
.dsh-cli-quota .quota-count { margin-inline-start: auto; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
.dsh-cli-quota .quota-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
.dsh-cli-quota .quota-card { min-width: 0; padding: 16px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
.dsh-cli-quota .quota-card-heading { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-cli-quota .quota-provider-icon { box-sizing: content-box; padding: 4px; border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); }
.dsh-cli-quota .quota-provider { min-width: 0; margin: 0; font: inherit; font-weight: 500; overflow-wrap: anywhere; }
.dsh-cli-quota .quota-account-name { display: block; color: var(--dsw-alias-label-secondary); font-size: .857rem; overflow-wrap: anywhere; margin-top: 4px; }
.dsh-cli-quota .quota-plan { color: var(--dsw-alias-label-secondary); font-size: .857rem; margin: 12px 0; }
.dsh-cli-quota .quota-plan span { color: var(--dsw-alias-label-primary); margin-inline-start: 6px; }
.dsh-cli-quota .quota-windows { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.dsh-cli-quota .quota-limit { min-width: 0; }
.dsh-cli-quota .quota-limit + .quota-limit { border-top: .5px dashed var(--dsw-alias-border-l2); padding-top: 12px; }
.dsh-cli-quota .quota-limit-heading { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 4px 8px; font-size: .857rem; }
.dsh-cli-quota .quota-limit-label { min-width: 0; flex: 1; overflow-wrap: anywhere; font-weight: 500; }
.dsh-cli-quota .quota-value { flex: none; font-weight: 500; font-variant-numeric: tabular-nums; }
.dsh-cli-quota .quota-reset { display: block; text-align: end; }
.dsh-cli-quota .quota-reset, .dsh-cli-quota .quota-missing { color: var(--dsw-alias-label-secondary); font-size: .857rem; line-height: 1.5; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.dsh-cli-quota .quota-limit progress { height: 6px; margin: 6px 0 0; }
.dsh-cli-quota .quota-limit progress::-webkit-progress-value { background: var(--dsw-alias-state-success-primary); }
.dsh-cli-quota .quota-limit progress::-moz-progress-bar { background: var(--dsw-alias-state-success-primary); }
.dsh-cli-quota [data-tone=warning] progress::-webkit-progress-value { background: var(--dsw-alias-state-warn-primary); }
.dsh-cli-quota [data-tone=danger] progress::-webkit-progress-value { background: var(--dsw-alias-state-error-primary); }
.dsh-cli-quota [data-tone=warning] progress::-moz-progress-bar { background: var(--dsw-alias-state-warn-primary); }
.dsh-cli-quota [data-tone=danger] progress::-moz-progress-bar { background: var(--dsw-alias-state-error-primary); }
.dsh-cli-quota .quota-card-footer { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 16px; }
.dsh-cli-quota .quota-routing { margin-top: 12px; color: var(--dsw-alias-label-secondary); font-size: .857rem; }
.dsh-cli-quota .quota-routing summary { cursor: pointer; }
.dsh-cli-quota .quota-routing p { margin: 8px 0; }
.dsh-cli-quota .quota-empty { padding: 32px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dsh-cli-quota .quota-pagination { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dsh-cli-quota .quota-help { color: var(--dsw-alias-label-secondary); font-size: .857rem; margin-top: 16px; }
.dsh-cli-quota .quota-help summary { cursor: pointer; }
.dsh-cli-quota .quota-help p { max-width: 75ch; }
@container (max-width: 1300px) { .dsh-cli-quota .quota-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@container (max-width: 1000px) { .dsh-cli-quota .quota-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (max-width: 680px) {
  .dsh-cli-quota .quota-grid { grid-template-columns: minmax(0, 1fr); }
  .dsh-cli-quota .quota-search { flex-basis: 100%; max-width: 100%; }
  .dsh-cli-quota .quota-count { margin-inline-start: 0; flex: 1; }
}
`

export function QuotaPanel({
  accounts,
  quotas,
  language,
  text,
  busy,
  canLoad,
  managementDisabled,
  onLoad,
  onFetch,
  onReset,
}: {
  accounts?: QuotaAccount[]
  quotas: Record<string, QuotaResult | null | undefined>
  fetchedAt?: number
  language: string
  text: ReturnType<typeof localizedCopy>
  busy: boolean
  canLoad: boolean
  managementDisabled: boolean
  onLoad: () => void
  onFetch: (account: QuotaAccount) => void
  onReset: (account: QuotaAccount) => void
}) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const filtered =
    accounts?.filter((account) =>
      `${account.name} ${account.provider}`.toLowerCase().includes(search.trim().toLowerCase())
    ) ?? []
  const pages = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, pages - 1)
  const labels: Record<string, string> = {
    five_hour: text.fiveHour,
    seven_day: text.sevenDay,
    seven_day_oauth_apps: text.oauthApps,
    seven_day_opus: 'Opus',
    seven_day_sonnet: 'Sonnet',
    seven_day_cowork: 'Cowork',
    primary_window: text.primaryWindow,
    secondary_window: text.secondaryWindow,
    code_review_primary_window: text.codeReview,
    code_review_secondary_window: text.codeReview,
    daily: text.daily,
    weekly: text.sevenDay,
    monthly: text.monthly,
    credits: text.credits,
  }
  const windowLabel = (window: QuotaWindow) =>
    `${labels[window.id] ?? window.id}${window.periodSeconds === undefined || ['five_hour', 'seven_day', 'daily', 'weekly', 'monthly'].includes(window.id) ? '' : ` · ${window.periodSeconds / 3600}${text.hours}`}`
  const percent = (value: number) => `${Number(value.toFixed(1))}%`
  const remainingLabel = (used: number) => text.remainingPercent.replace('{percent}', percent(100 - used))
  const dateTime = new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' })

  return (
    <div className="dsh-cli-quota">
      <div className="quota-toolbar">
        <Input
          className="quota-search"
          icon={<IconSearchOutlineRegular size={16} aria-hidden="true" />}
          type="search"
          aria-label={text.searchAccounts}
          placeholder={text.searchAccounts}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(0)
          }}
        />
        <span className="quota-count">{accounts && `${filtered.length} / ${accounts.length}`}</span>
        <Button
          variant="outline"
          icon={<IconRefreshOutlineRegular size={16} aria-hidden="true" />}
          disabled={busy || !canLoad}
          onClick={() => {
            setPage(0)
            onLoad()
          }}
        >
          {text.refreshQuotaAccounts}
        </Button>
      </div>
      {!accounts ? (
        <div className="quota-empty">
          <strong>{busy ? text.busy : text.quotaLoadTitle}</strong>
          {!busy && <p>{text.quotaLoadHint}</p>}
        </div>
      ) : filtered.length === 0 ? (
        <div className="quota-empty">
          <p>{accounts.length ? text.noMatchingAccounts : text.emptyAccounts}</p>
          {accounts.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setSearch('')
                setPage(0)
              }}
            >
              {text.clearSearch}
            </Button>
          )}
        </div>
      ) : (
        <div className="quota-grid" role="region" aria-label={text.quota}>
          {filtered.slice(currentPage * 20, (currentPage + 1) * 20).map((account) => {
            const result = quotas[quotaKey(account)]
            return (
              <article
                className="quota-card"
                key={quotaKey(account)}
                aria-label={`${account.provider} · ${account.name}`}
              >
                <header>
                  <div className="quota-card-heading">
                    <ProviderIcon className="quota-provider-icon" provider={account.provider} size={18} />
                    <h2 className="quota-provider">{account.provider}</h2>
                  </div>
                  <span className="quota-account-name">{account.name}</span>
                </header>
                {result?.plan && (
                  <p className="quota-plan">
                    {text.plan}
                    <span>{result.plan}</span>
                  </p>
                )}
                {account.disabled ? (
                  <p className="quota-missing">{text.disabled}</p>
                ) : !account.supported ? (
                  <p className="quota-missing">{text.unsupportedQuota}</p>
                ) : result === null ? (
                  <p role="alert" className="quota-missing">
                    {text.quotaFailed}
                  </p>
                ) : !result ? (
                  <p className="quota-missing">{text.unloadedQuota}</p>
                ) : result.windows.length === 0 ? (
                  <p className="quota-missing">{text.unknownQuota}</p>
                ) : (
                  <div className="quota-windows">
                    {result.windows.map((window, index) => {
                      const label = windowLabel(window)
                      const used = window.usedPercent
                      return (
                        <div
                          className="quota-limit"
                          key={`${window.id}-${window.periodSeconds ?? ''}-${index}`}
                          data-tone={
                            used === undefined ? 'neutral' : used >= 100 ? 'danger' : used >= 80 ? 'warning' : 'neutral'
                          }
                        >
                          <div className="quota-limit-heading">
                            <span className="quota-limit-label">{label}</span>
                            <span className="quota-value">
                              {used === undefined ? text.quotaUnknown : remainingLabel(used)}
                            </span>
                            {window.resetAt && (
                              <time
                                className="quota-reset"
                                dateTime={window.resetAt}
                                title={`${text.resetsAt}: ${dateTime.format(new Date(window.resetAt))}`}
                                aria-label={`${text.resetsAt}: ${dateTime.format(new Date(window.resetAt))}`}
                              >
                                {dateTime.format(new Date(window.resetAt))}
                              </time>
                            )}
                          </div>
                          {used !== undefined && (
                            <progress
                              max={100}
                              value={100 - used}
                              aria-label={`${account.name} · ${label} · ${remainingLabel(used)}`}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
                <footer className="quota-card-footer">
                  <Button
                    className="quota-account-refresh"
                    variant="outline"
                    size="sm"
                    icon={<IconRefreshOutlineRegular size={14} aria-hidden="true" />}
                    aria-label={`${text.refreshQuota} · ${account.name}`}
                    disabled={managementDisabled || account.disabled || !account.supported || !account.authIndex}
                    onClick={() => onFetch(account)}
                  >
                    {text.refreshQuota}
                  </Button>
                </footer>
                <details className="quota-routing">
                  <summary>{text.accountActions}</summary>
                  <p>{text.cooldownHint}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={managementDisabled || !account.editable || !account.authIndex}
                    onClick={() => onReset(account)}
                  >
                    {text.quotaReset}
                  </Button>
                </details>
              </article>
            )
          })}
        </div>
      )}
      {pages > 1 && (
        <nav className="quota-pagination" aria-label={text.quotaPages}>
          <Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            {text.previous}
          </Button>
          <span className="quota-count">
            {currentPage + 1} / {pages}
          </span>
          <Button variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>
            {text.next}
          </Button>
        </nav>
      )}
      <details className="quota-help">
        <summary>{text.quotaHelp}</summary>
        <p>{text.quotaHint}</p>
      </details>
    </div>
  )
}
