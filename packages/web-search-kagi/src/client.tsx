import { useEffect, useId, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button, Input, SettingsRow, settingsStyles } from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { channel, endpointPrefix, type KagiSettings } from './protocol.js'

export const name = 'dungsil-web-search-kagi'
export const inject = ['connection', 'locale', 'slots']

const copy = (language: string) => (language.startsWith('ko') ? ko : language.startsWith('zh') ? zh : en).ui

const styles = `${settingsStyles}
.dsh-kagi-settings { color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-kagi-settings p { margin: 8px 0; }
.dsh-kagi-settings-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 20px; }
.dsh-kagi-settings-field { display: grid; gap: 8px; margin-top: 20px; }
.dsh-kagi-settings .dsh-plugin-settings-row { justify-content: flex-start; }
.dsh-kagi-settings a { color: var(--dsw-alias-link); }
.dsh-kagi-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
`

function KagiSettingsPage({ ctx }: { ctx: Context }) {
  const locale = useLocaleSnapshot(ctx.locale)
  const text = copy(locale.active)
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<KagiSettings>()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<'saved' | 'saveError' | 'loadError'>()
  const pending = useRef(false)
  const lifetime = useRef<AbortController>()

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void (async () => {
      try {
        const result = await connection.rpc.call(channel, `${endpointPrefix}describe`, {}, controller.signal)
        if (controller.signal.aborted) return
        if (!result.ok) throw new Error('Could not load Kagi settings')
        setView(result.value as unknown as KagiSettings)
      } catch {
        if (!controller.signal.aborted) setNotice('loadError')
      }
    })()
    return () => {
      controller.abort()
      lifetime.current = undefined
    }
  }, [connection])

  const save = async () => {
    const controller = lifetime.current
    if (!controller || pending.current || !view?.writable || !key.trim() || notice === 'saveError') return
    pending.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      const result = await connection.rpc.call(channel, `${endpointPrefix}save`, { apiKey: key }, controller.signal)
      if (controller.signal.aborted) return
      if (!result.ok) throw new Error('Could not save Kagi settings')
      setView(result.value as unknown as KagiSettings)
      setKey('')
      setNotice('saved')
    } catch {
      if (!controller.signal.aborted) setNotice('saveError')
    } finally {
      pending.current = false
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <section className="dsh-kagi-settings" aria-label={text.nav} aria-busy={!view || busy}>
      <p>{text.description}</p>
      <p className="dsh-kagi-settings-hint" id={`${id}-hint`}>
        {text.hint}
      </p>
      {!view && !notice && <p role="status">{text.loading}</p>}
      {view && (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="dsh-kagi-settings-field">
            <label htmlFor={id}>{text.apiKey}</label>
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              maxLength={4096}
              value={key}
              disabled={!view.writable || busy || notice === 'saveError'}
              aria-describedby={`${id}-hint ${id}-status`}
              onChange={(event) => {
                setKey(event.target.value)
                setNotice(undefined)
              }}
            />
            <p className="dsh-kagi-settings-hint" id={`${id}-status`}>
              {view.environment ? text.environment : view.configured ? text.configured : text.missing}
            </p>
          </div>
          {!view.writable && !view.environment && <p role="status">{text.readOnly}</p>}
          <SettingsRow
            label={
              <a href="https://kagi.com/api/keys" target="_blank" rel="noopener noreferrer">
                {text.portal}
              </a>
            }
          >
            <Button
              type="submit"
              variant="primary"
              disabled={!view.writable || busy || !key.trim() || notice === 'saveError'}
            >
              {busy ? text.saving : text.save}
            </Button>
          </SettingsRow>
        </form>
      )}
      {notice && <p role={notice === 'saved' ? 'status' : 'alert'}>{text[notice]}</p>}
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.effect(() => installStyles(styles), 'kagi: settings styles')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 16,
        label: () => copy(ctx.locale.getSnapshot().active).nav,
        inject: () => ({ ctx }),
      },
      KagiSettingsPage
    )
  )
}
