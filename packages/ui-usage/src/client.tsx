import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { Button, Menu, StateDot } from '@dungsil/dsh-ui'
import {
  IconChevronDownOutlineRegular,
  IconGaugeOutlineRegular,
  IconRefreshOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { localizedCopy } from './copy.js'
import { channel, method, type UsageView } from './protocol.js'

export const name = 'dungsil-ui-usage'
export const inject = ['connection', 'locale', 'slots']

const styles = `
.dsh-usage-page { box-sizing: border-box; height: 100%; overflow: auto; padding: 24px; padding-inline-start: max(24px, var(--dsh-frame-leading-clearance, 0px)); }
.dsh-usage-page > .dsh-usage { max-width: 960px; margin: 0 auto; }
.dsh-usage h1 { margin: 0 0 24px; font-size: 20px; line-height: 28px; font-weight: 500; }
.dsh-usage { container-type: inline-size; overflow-wrap: anywhere; color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-usage-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.dsh-usage-status { display: flex; align-items: center; gap: 6px; }
.dsh-usage-muted, .dsh-usage dt { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-usage h3 { margin: 24px 0 12px; font-size: 14px; font-weight: 500; }
.dsh-usage dl { margin: 0; }
.dsh-usage dd { margin: 4px 0 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dsh-usage-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; padding: 20px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-usage-summary > div:first-child { grid-column: 1 / -1; }
.dsh-usage-total { font-size: 28px; line-height: 36px; }
.dsh-usage-meta { display: flex; flex-wrap: wrap; gap: 8px 24px; margin: 12px 0; }
.dsh-usage-chart { display: flex; align-items: stretch; gap: clamp(1px, .5cqi, 4px); height: 120px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-usage-bar { flex: 1; min-width: 0; display: flex; align-items: flex-end; border: none; padding: 0; background: transparent; cursor: pointer; }
.dsh-usage-bar span { width: 100%; min-height: 2px; border-radius: 3px 3px 0 0; background: var(--dsw-alias-brand-primary-new-colorprimary-new-color); opacity: .55; }
.dsh-usage-bar[aria-pressed=true] span, .dsh-usage-bar:hover span { opacity: 1; }
.dsh-usage-bar:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-usage-axis { display: flex; justify-content: space-between; gap: 12px; margin-top: 4px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-usage-detail { min-height: 22px; margin: 8px 0; font-variant-numeric: tabular-nums; }
.dsh-usage-model { padding: 14px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-usage-model-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; overflow-wrap: anywhere; }
.dsh-usage-model-heading > span:first-child { min-width: 0; }
.dsh-usage-model-heading > span:last-child { flex: none; font-variant-numeric: tabular-nums; }
.dsh-usage-model dl { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-top: 12px; font-size: 12px; }
.dsh-usage [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
@container (max-width: 480px) {
  .dsh-usage-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dsh-usage-model dl { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 260px) {
  .dsh-usage-summary, .dsh-usage-model dl { grid-template-columns: minmax(0, 1fr); }
  .dsh-usage-model-heading { flex-direction: column; gap: 4px; }
}
`

function Usage({ ctx }: { ctx: Context }) {
  const locale = useLocaleSnapshot(ctx.locale)
  const text = localizedCopy(locale.active)
  const number = new Intl.NumberFormat(locale.active)
  const [period, setPeriod] = useState(7)
  const [periodOpen, setPeriodOpen] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [view, setView] = useState<UsageView>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  const [selectedDay, setSelectedDay] = useState('')
  const connection = ctx.get('connection') as unknown as ConnectionHandle

  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setError(false)
    setView(undefined)
    void (async () => {
      try {
        const result = await connection.rpc.call(
          channel,
          method,
          { days: period, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
          controller.signal
        )
        if (controller.signal.aborted) return
        if (!result.ok) throw new Error('Usage unavailable')
        const next = result.value as unknown as UsageView
        setView(next)
        setSelectedDay(next.days.at(-1)?.day ?? '')
      } catch {
        if (!controller.signal.aborted) setError(true)
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    })()
    return () => controller.abort()
  }, [connection, period, refresh])

  const metrics = ['input', 'output', 'cacheRead', 'cacheWrite'] as const
  const periods = [
    { id: '7', label: text.week },
    { id: '30', label: text.month },
    { id: '0', label: text.all },
  ]
  const selected = view?.days.find(({ day }) => day === selectedDay)
  const maximum = Math.max(1, ...(view?.days.map(({ total }) => total) ?? []))
  const date = (day: string) =>
    new Intl.DateTimeFormat(locale.active, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${day}T00:00:00Z`)
    )

  return (
    <section className="dsh-usage" aria-label={text.nav} aria-busy={busy}>
      <h1>{text.nav}</h1>
      <div className="dsh-usage-toolbar">
        <Menu
          open={periodOpen}
          onClose={() => setPeriodOpen(false)}
          selectedId={String(period)}
          items={periods}
          onSelect={(id) => {
            setPeriodOpen(false)
            setPeriod(Number(id))
          }}
          portal
          anchor={
            <Button
              variant="outline"
              aria-label={text.period}
              aria-haspopup="menu"
              aria-expanded={periodOpen}
              onClick={() => setPeriodOpen((open) => !open)}
            >
              {periods.find(({ id }) => id === String(period))!.label}
              <IconChevronDownOutlineRegular />
            </Button>
          }
        />
        <Button
          variant="outline"
          icon={<IconRefreshOutlineRegular />}
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          {text.refresh}
        </Button>
      </div>
      {busy && (
        <p role="status" className="dsh-usage-status">
          <StateDot state="ongoing" />
          {text.loading}
        </p>
      )}
      {error && <p role="alert">{text.error}</p>}
      {view && (
        <>
          <dl className="dsh-usage-summary">
            <div>
              <dt>{text.total}</dt>
              <dd className="dsh-usage-total">{number.format(view.totals.total)}</dd>
            </div>
            {metrics.map((key) => (
              <div key={key}>
                <dt>{text[key]}</dt>
                <dd>{number.format(view.totals[key])}</dd>
              </div>
            ))}
          </dl>
          <div className="dsh-usage-meta dsh-usage-muted">
            <span>
              {text.calls}: {number.format(view.totals.calls)}
            </span>
            <span>
              {text.sessions}: {number.format(view.sessions)}
            </span>
          </div>
          {view.unreadable > 0 && (
            <p role="alert">
              {text.unreadable}: {number.format(view.unreadable)}
            </p>
          )}
          {view.totals.unreported > 0 && (
            <p role="status">
              {text.unreported}: {number.format(view.totals.unreported)}
            </p>
          )}
          {view.totals.calls === 0 ? (
            <p role="status">{text.empty}</p>
          ) : (
            <>
              <h3>{period === 0 ? text.recent : text.daily}</h3>
              <div className="dsh-usage-chart" role="group" aria-label={`${text.daily} (${view.timeZone})`}>
                {view.days.map(({ day, total }) => (
                  <button
                    type="button"
                    className="dsh-usage-bar"
                    key={day}
                    aria-label={`${day}: ${number.format(total)} ${text.total}`}
                    aria-pressed={day === selectedDay}
                    onClick={() => setSelectedDay(day)}
                  >
                    <span style={{ height: `${(total / maximum) * 100}%` }} />
                  </button>
                ))}
              </div>
              <div className="dsh-usage-axis">
                <span>{date(view.days[0].day)}</span>
                <span>{date(view.days.at(-1)!.day)}</span>
              </div>
              <p className="dsh-usage-detail" aria-live="polite">
                {selected && `${date(selected.day)} · ${text.total}: ${number.format(selected.total)}`}
              </p>
              <h3>{text.models}</h3>
              {view.models.map((row) => (
                <div className="dsh-usage-model" key={JSON.stringify([row.provider, row.model])}>
                  <div className="dsh-usage-model-heading">
                    <span>
                      {row.provider || text.unknown} / {row.model || text.unknown}
                    </span>
                    <span>{number.format(row.total)}</span>
                  </div>
                  <dl>
                    {(['calls', ...metrics] as const).map((key) => (
                      <div key={key}>
                        <dt>{text[key]}</dt>
                        <dd>{number.format(row[key])}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </>
          )}
          <p className="dsh-usage-muted">
            {text.updated}:{' '}
            {new Intl.DateTimeFormat(locale.active, {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: view.timeZone,
            }).format(view.updatedAt)}{' '}
            ({view.timeZone})
          </p>
        </>
      )}
      <p className="dsh-usage-muted">{text.scope}</p>
      <p className="dsh-usage-muted">{text.accounting}</p>
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.effect(() => installStyles(styles), 'usage: styles')
  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: name,
        inject: () => ({ ctx }),
      },
      ({ ctx }) => (
        <div className="dsh-usage-page">
          <Usage ctx={ctx} />
        </div>
      )
    )
  )
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: name,
        order: 1,
        label: () => localizedCopy(ctx.locale.getSnapshot().active).nav,
      },
      ({ size }) => <IconGaugeOutlineRegular size={size} />
    )
  )
}
