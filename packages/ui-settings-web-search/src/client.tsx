import { useEffect, useId, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Input, SettingsPicker, SettingsRow, Switch, settingsStyles } from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import {
  channel,
  endpointPrefix,
  numericFields,
  validSettings,
  type WebToolSettings,
  type WebToolTarget,
} from './protocol.js'

export const name = 'dungsil-ui-settings-web-search'
export const inject = ['connection', 'locale', 'slots']
const localizedCopy = (language: string) => (language.startsWith('ko') ? ko : language.startsWith('zh') ? zh : en).ui

const styles = `${settingsStyles}
.dsh-web-tool-settings { container-type: inline-size; color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-web-tool-settings p { color: var(--dsw-alias-label-secondary); margin: 8px 0; }
.dsh-web-tool-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
.dsh-web-tool-settings .dsh-web-tool-input { width: 160px; flex: none; }
@container (max-width: 420px) {
  .dsh-web-tool-settings .dsh-plugin-settings-row { flex-wrap: wrap; }
  .dsh-web-tool-settings .dsh-plugin-settings-picker { max-width: 100%; }
}
`

function WebToolSettingsSection({ ctx }: { ctx: Context }) {
  const locale = useLocaleSnapshot(ctx.locale)
  const text = localizedCopy(locale.active)
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const id = useId()
  const [targets, setTargets] = useState<WebToolTarget[]>()
  const [selected, setSelected] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<'error' | 'conflict' | 'loadError'>()
  const lock = useRef(true)
  const lifetime = useRef<AbortController>()
  const target = targets?.find((item) => item.id === selected)

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    lock.current = true
    setBusy(true)
    setError(undefined)
    void (async () => {
      try {
        const result = await connection.rpc.call(channel, `${endpointPrefix}describe`, {}, controller.signal)
        if (controller.signal.aborted) return
        if (!result.ok) throw new Error('describe failed')
        const next = result.value as unknown as WebToolTarget[]
        setTargets(next)
        setSelected(next[0]?.id ?? '')
        lock.current = false
      } catch {
        if (!controller.signal.aborted) setError('loadError')
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    })()
    return () => controller.abort()
  }, [connection])

  const save = async (change: Partial<WebToolSettings>) => {
    const controller = lifetime.current
    if (lock.current || !target || !controller || controller.signal.aborted) return
    const settings = {
      ...target.settings,
      ...Object.fromEntries(numericFields.filter((key) => key in drafts).map((key) => [key, Number(drafts[key])])),
      ...change,
    }
    if (!validSettings(settings)) return
    if (JSON.stringify(settings) === JSON.stringify(target.settings)) return
    lock.current = true
    setBusy(true)
    try {
      const result = await connection.rpc.call(
        channel,
        `${endpointPrefix}save`,
        {
          id: target.id,
          revision: target.revision,
          settings,
        },
        controller.signal
      )
      if (controller.signal.aborted) return
      if (!result.ok) {
        setError(result.error.code === 'conflict' ? 'conflict' : 'error')
        return
      }
      setTargets(result.value as unknown as WebToolTarget[])
      setDrafts({})
      lock.current = false
    } catch {
      if (!controller.signal.aborted) setError('error')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  const invalid = numericFields.some(
    (key) => key in drafts && (!Number.isSafeInteger(Number(drafts[key])) || Number(drafts[key]) < 1)
  )
  const disabled = busy || !!error
  return (
    <section className="dsh-web-tool-settings" aria-label={text.nav} aria-busy={busy}>
      <p>{text.description}</p>
      {busy && <p role="status">{targets ? text.saving : text.loading}</p>}
      {error && <p role="alert">{text[error]}</p>}
      {targets?.length === 0 && <p role="status">{text.empty}</p>}
      {target && (
        <>
          <SettingsRow label={text.target}>
            <SettingsPicker
              value={target.label}
              selectedId={selected}
              items={targets!.map((item) => ({ id: item.id, label: item.label }))}
              aria-label={text.target}
              disabled={disabled || invalid}
              onSelect={(value) => {
                setSelected(value)
                setDrafts({})
              }}
            />
          </SettingsRow>
          <p>{target.preset ? text.presetHint : text.directHint}</p>
          {(['search', 'fetch'] as const).map((key) => (
            <SettingsRow key={key} label={text[key]}>
              <Switch
                label={text[key]}
                checked={target.settings[key]}
                disabled={disabled || invalid}
                onChange={(value) => void save({ [key]: value })}
              />
            </SettingsRow>
          ))}
          {numericFields.map((key) => {
            const value = drafts[key] ?? String(target.settings[key])
            const bad = !Number.isSafeInteger(Number(value)) || Number(value) < 1
            return (
              <div key={`${selected}-${key}`}>
                <SettingsRow label={<label htmlFor={`${id}-${key}`}>{text[key]}</label>}>
                  <Input
                    id={`${id}-${key}`}
                    className="dsh-web-tool-input"
                    type="number"
                    min={1}
                    step={1}
                    value={value}
                    disabled={disabled}
                    aria-invalid={bad}
                    aria-describedby={bad ? `${id}-${key}-error` : undefined}
                    onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                    onBlur={() => {
                      if (!bad) void save({ [key]: Number(value) })
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                    }}
                  />
                </SettingsRow>
                {bad && (
                  <p id={`${id}-${key}-error`} role="alert">
                    {text.invalid}
                  </p>
                )}
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.effect(() => installStyles(styles), 'web-tool-settings: styles')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 17,
        label: () => localizedCopy(ctx.locale.getSnapshot().active).nav,
        inject: () => ({ ctx }),
      },
      WebToolSettingsSection
    )
  )
}
