import { useId, useState } from 'react'
import { Button, Input, SegmentedControl, Tag } from '@dungsil/dsh-ui'
import {
  IconChevronDownOutlineRegular,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import type { localizedCopy } from './copy.js'
import type { QuotaAccount, QuotaResult } from './protocol.js'

export const quotaStyles = `
.dsh-cli-quota { margin-top: 20px; }
.dsh-cli-quota .quota-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 20px; }
.dsh-cli-quota .quota-search { box-sizing: border-box; flex: 1; min-width: 160px; }
.dsh-cli-quota .quota-toolbar-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dsh-cli-quota .quota-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.dsh-cli-quota .quota-card { display: flex; flex-direction: column; min-width: 0; padding: 16px; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
.dsh-cli-quota .quota-card-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 20px; }
.dsh-cli-quota .quota-identity { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.dsh-cli-quota .quota-identity strong { display: block; font-weight: 500; }
.dsh-cli-quota .quota-name { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; overflow-wrap: anywhere; }
.dsh-cli-quota .quota-badge { flex-shrink: 0; }
.dsh-cli-quota .quota-window { padding: 12px 0; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-cli-quota .quota-heading { gap: 4px 12px; font-size: 12px; }
.dsh-cli-quota .quota-heading strong { font-weight: 500; }
.dsh-cli-quota progress { height: 6px; margin: 10px 0; }
.dsh-cli-quota [data-tone=warning] progress::-webkit-progress-value { background: var(--dsw-alias-state-warn-primary); }
.dsh-cli-quota [data-tone=danger] progress::-webkit-progress-value { background: var(--dsw-alias-state-error-primary); }
.dsh-cli-quota [data-tone=warning] progress::-moz-progress-bar { background: var(--dsw-alias-state-warn-primary); }
.dsh-cli-quota [data-tone=danger] progress::-moz-progress-bar { background: var(--dsw-alias-state-error-primary); }
.dsh-cli-quota .quota-card-footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 16px; }
.dsh-cli-quota .quota-table-scroll { overflow-x: auto; border: .5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
.dsh-cli-quota .quota-table-scroll button:not(.quota-expand) { white-space: nowrap; }
.dsh-cli-quota table { width: 100%; min-width: 760px; border-collapse: collapse; text-align: start; font-size: 12px; }
.dsh-cli-quota th { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-weight: 500; white-space: nowrap; }
.dsh-cli-quota th, .dsh-cli-quota td { padding: 14px 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); vertical-align: middle; }
.dsh-cli-quota tbody:last-child tr:last-child td { border-bottom: 0; }
.dsh-cli-quota .quota-table-account { max-width: 190px; }
.dsh-cli-quota .quota-expand { max-width: 100%; height: auto; min-height: 28px; justify-content: flex-start; text-align: start; overflow-wrap: anywhere; }
.dsh-cli-quota .quota-expand svg { flex: none; transform: rotate(-90deg); }
.dsh-cli-quota .quota-expand[aria-expanded=true] svg { transform: none; }
.dsh-cli-quota .quota-summary { min-width: 135px; }
.dsh-cli-quota .quota-summary progress { width: 100%; margin: 6px 0; }
.dsh-cli-quota .quota-table-detail { padding: 4px 12px 12px; }
.dsh-cli-quota .quota-detail-header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 12px; }
.dsh-cli-quota .quota-detail-windows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 24px; }
.dsh-cli-quota .quota-empty { padding: 32px 16px; text-align: center; color: var(--dsw-alias-label-secondary); }
.dsh-cli-quota .quota-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
.dsh-cli-quota .quota-pagination > div { display: flex; gap: 8px; }
.dsh-cli-quota .quota-note { margin-top: 20px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; }
@container (max-width: 680px) {
  .dsh-cli-quota .quota-grid { grid-template-columns: minmax(0, 1fr); }
  .dsh-cli-quota .quota-search { width: 100%; flex-basis: 100%; }
  .dsh-cli-quota .quota-toolbar-actions { width: 100%; justify-content: space-between; }
  .dsh-cli-quota .quota-card { padding: 16px; }
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
  language: string
  text: ReturnType<typeof localizedCopy>
  busy: boolean
  canLoad: boolean
  managementDisabled: boolean
  onLoad: () => void
  onFetch: (account: QuotaAccount) => void
  onReset: (account: QuotaAccount) => void
}) {
  const id = useId()
  const [layout, setLayout] = useState<'cards' | 'table'>('cards')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
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
  const windowLabel = (window: QuotaResult['windows'][number]) =>
    `${labels[window.id] ?? window.id}${window.periodSeconds === undefined || ['five_hour', 'seven_day', 'daily', 'weekly', 'monthly'].includes(window.id) ? '' : ` · ${window.periodSeconds / 3600}${text.hours}`}`
  const percent = (used: number) => `${Number(used.toFixed(1))}%`
  const date = (value: string) => new Date(value).toLocaleString(language)
  const tone = (used?: number) =>
    used === undefined ? 'neutral' : used >= 100 ? 'danger' : used >= 80 ? 'warning' : 'neutral'

  const renderAccount = (account: QuotaAccount, index: number) => {
    const key = JSON.stringify([account.name, account.authIndex])
    const result = quotas[key]
    const observed =
      result?.windows.flatMap((window) => (window.usedPercent === undefined ? [] : [window.usedPercent])) ?? []
    const highest = observed.length ? Math.max(...observed) : undefined
    const status = account.disabled
      ? text.disabled
      : !account.supported
        ? text.quotaUnsupported
        : result === null
          ? text.quotaError
          : !result
            ? text.quotaUnqueried
            : highest === undefined
              ? text.quotaUnknown
              : highest >= 100
                ? text.quotaExhausted
                : highest >= 80
                  ? text.quotaWarning
                  : text.quotaAvailable
    const statusTone = result === null ? 'danger' : account.disabled || !account.supported ? 'neutral' : tone(highest)
    const badge = (
      <Tag className="quota-badge" tone={statusTone}>
        {status}
      </Tag>
    )
    const refresh = (
      <Button
        variant="outline"
        size={layout === 'table' ? 'sm' : 'md'}
        icon={<IconRefreshOutlineRegular size={16} aria-hidden="true" />}
        aria-label={`${text.refreshQuota} · ${account.name}`}
        disabled={managementDisabled || !account.supported || !account.authIndex}
        onClick={() => onFetch(account)}
      >
        {text.refreshQuota}
      </Button>
    )
    const reset = (
      <Button
        variant="ghost"
        size={layout === 'table' ? 'sm' : 'md'}
        aria-label={`${text.quotaReset} · ${account.name}`}
        disabled={managementDisabled || !account.editable || !account.authIndex}
        onClick={() => onReset(account)}
      >
        {text.quotaReset}
      </Button>
    )
    const details =
      !account.supported || account.disabled ? (
        <p className="hint">{account.disabled ? text.disabled : text.unsupportedQuota}</p>
      ) : result === null ? (
        <p role="alert">{text.quotaFailed}</p>
      ) : !result ? (
        <p className="hint">{text.unloadedQuota}</p>
      ) : (
        <>
          {result.plan && (
            <p className="hint">
              {text.plan}: {result.plan}
            </p>
          )}
          {result.windows.length === 0 && <p className="hint">{text.unknownQuota}</p>}
          <div className={layout === 'table' ? 'quota-detail-windows' : undefined}>
            {result.windows.map((window, windowIndex) => (
              <div className="quota-window" key={`${window.id}-${windowIndex}`} data-tone={tone(window.usedPercent)}>
                <div className="quota-heading">
                  <strong>{windowLabel(window)}</strong>
                  <span>
                    {window.usedPercent === undefined
                      ? text.unknownQuota
                      : `${text.used}: ${percent(window.usedPercent)} · ${text.remaining}: ${percent(100 - window.usedPercent)}`}
                  </span>
                </div>
                {window.usedPercent !== undefined && (
                  <progress
                    aria-label={`${account.name} · ${windowLabel(window)}`}
                    max={100}
                    value={window.usedPercent}
                  />
                )}
                {window.resetAt && (
                  <p className="hint">
                    {text.resetsAt}: {date(window.resetAt)}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="hint">
            {text.observedAt}: {date(result.observedAt)}
          </p>
        </>
      )
    if (layout === 'cards')
      return (
        <article className="quota-card" key={key} aria-label={`${account.provider} · ${account.name}`}>
          <header className="quota-card-header">
            <div className="quota-identity">
              <strong>{account.provider}</strong>
              <div className="quota-name">{account.name}</div>
            </div>
            {badge}
          </header>
          <div>{details}</div>
          <footer className="quota-card-footer">
            {refresh}
            {reset}
          </footer>
        </article>
      )
    const first = result?.windows[0]
    const detailId = `${id}-account-${index}`
    return (
      <tbody key={key}>
        <tr>
          <td className="quota-table-account">
            <Button
              variant="ghost"
              size="sm"
              className="quota-expand"
              aria-expanded={expanded.has(key)}
              aria-controls={detailId}
              onClick={() =>
                setExpanded((current) => {
                  const next = new Set(current)
                  if (next.has(key)) next.delete(key)
                  else next.add(key)
                  return next
                })
              }
            >
              <IconChevronDownOutlineRegular size={14} aria-hidden="true" />
              <span>{account.name}</span>
            </Button>
          </td>
          <td>{account.provider}</td>
          <td className="quota-summary" data-tone={tone(first?.usedPercent)}>
            {first ? (
              <>
                <div className="quota-name">{windowLabel(first)}</div>
                {first.usedPercent === undefined ? (
                  text.unknownQuota
                ) : (
                  <>
                    <strong>{percent(first.usedPercent)}</strong> {text.used} · {percent(100 - first.usedPercent)}{' '}
                    {text.remaining}
                    <progress
                      aria-label={`${account.name} · ${windowLabel(first)}`}
                      max={100}
                      value={first.usedPercent}
                    />
                  </>
                )}
              </>
            ) : (
              '—'
            )}
          </td>
          <td>{first?.resetAt ? date(first.resetAt) : '—'}</td>
          <td>{badge}</td>
          <td>{refresh}</td>
        </tr>
        <tr id={detailId} hidden={!expanded.has(key)}>
          <td colSpan={6}>
            <div className="quota-table-detail">
              <div className="quota-detail-header">
                <strong>{account.name}</strong>
                {reset}
              </div>
              {details}
            </div>
          </td>
        </tr>
      </tbody>
    )
  }

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
        <div className="quota-toolbar-actions">
          <SegmentedControl
            id={id}
            value={layout}
            label={text.quotaView}
            options={[
              { value: 'cards', label: text.quotaCards },
              { value: 'table', label: text.quotaTable },
            ]}
            onChange={setLayout}
          />
          <Button
            variant="outline"
            icon={<IconRefreshOutlineRegular size={16} aria-hidden="true" />}
            disabled={busy || !canLoad}
            onClick={() => {
              setPage(0)
              setExpanded(new Set())
              onLoad()
            }}
          >
            {text.refreshQuotaAccounts}
          </Button>
        </div>
      </div>
      {(['cards', 'table'] as const).map((value) => (
        <div
          key={value}
          id={`${id}-${value}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${value}`}
          hidden={layout !== value}
        >
          {layout === value &&
            (!accounts ? (
              <div className="quota-empty">
                <strong>{text.quotaLoadTitle}</strong>
                <p className="hint">{text.quotaLoadHint}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="quota-empty">{text.emptyAccounts}</div>
            ) : layout === 'cards' ? (
              <div className="quota-grid">
                {filtered.slice(currentPage * 20, (currentPage + 1) * 20).map(renderAccount)}
              </div>
            ) : (
              <div className="quota-table-scroll" role="region" aria-label={text.quotaTable} tabIndex={0}>
                <table aria-label={text.quota}>
                  <thead>
                    <tr>
                      {[
                        text.quotaAccount,
                        text.quotaProvider,
                        text.quotaUsage,
                        text.resetsAt,
                        text.quotaStatus,
                        text.quotaActions,
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  {filtered.slice(currentPage * 20, (currentPage + 1) * 20).map(renderAccount)}
                </table>
              </div>
            ))}
        </div>
      ))}
      {accounts && filtered.length > 0 && (
        <div className="quota-pagination">
          <span className="quota-name">
            {filtered.length} · {currentPage + 1} / {pages}
          </span>
          {pages > 1 && (
            <div>
              <Button variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
                {text.previous}
              </Button>
              <Button variant="outline" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>
                {text.next}
              </Button>
            </div>
          )}
        </div>
      )}
      <p className="quota-note">{text.quotaHint}</p>
    </div>
  )
}
