import { useEffect, useId, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { Button, Input, SettingsRow, settingsStyles } from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { channel, readMethod, saveMethod, validSettings, type SettingsView } from './protocol.js'
import { localized } from './copy.js'

export const inject = ['connection', 'locale', 'slots']
type Patch = { directory?: string; prefix?: string }
const validPatch = (patch: Patch) =>
  (patch.directory === undefined || validSettings({ directory: patch.directory, prefix: '' }, 'worktree')) &&
  (patch.prefix === undefined || validSettings({ prefix: patch.prefix }, 'panel'))
const common = (values: string[]) => (values.every((value) => value === values[0]) ? values[0] : undefined)

export function VcsSettings({ ctx }: { ctx: Context }) {
  const text = localized(useLocaleSnapshot(ctx.locale).active)
  const id = useId()
  const [view, setView] = useState<SettingsView>()
  const [draft, setDraft] = useState<Patch>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedNotice, setSavedNotice] = useState(false)
  const [notice, setNotice] = useState<'error' | 'conflict'>()
  const saved = useRef<SettingsView>()
  const latest = useRef<Patch>({})
  const pending = useRef(false)
  const blocked = useRef(true)
  const lifetime = useRef<AbortController | null>(null)
  const connection = ctx.get('connection') as unknown as ConnectionHandle

  const load = async () => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || pending.current) return
    pending.current = true
    blocked.current = true
    setLoading(true)
    try {
      const result = await connection.rpc.call(channel, readMethod, {}, signal)
      if (signal.aborted) return
      if (!result.ok) throw new Error('unavailable')
      const next = result.value as SettingsView
      saved.current = next
      latest.current = {}
      setView(next)
      setDraft({
        directory: common(
          next.entries.filter((entry) => entry.kind === 'worktree').map((entry) => entry.settings.directory!)
        ),
        prefix: common(next.entries.map((entry) => entry.settings.prefix)),
      })
      setNotice(undefined)
      setSavedNotice(false)
      blocked.current = false
    } catch {
      if (!signal.aborted) setNotice('error')
    } finally {
      pending.current = false
      if (!signal.aborted) setLoading(false)
    }
  }
  const save = async () => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || pending.current || blocked.current || !saved.current) return
    pending.current = true
    setSaving(true)
    try {
      while (Object.keys(latest.current).length && validPatch(latest.current)) {
        const patch = { ...latest.current }
        const baseline: SettingsView = saved.current!
        for (const entry of baseline.entries) {
          const settings = {
            ...entry.settings,
            ...(patch.prefix !== undefined ? { prefix: patch.prefix } : {}),
            ...(entry.kind === 'worktree' && patch.directory !== undefined ? { directory: patch.directory } : {}),
          }
          if (JSON.stringify(settings) === JSON.stringify(entry.settings)) continue
          const result = await connection.rpc.call(
            channel,
            saveMethod,
            { id: entry.id, revision: entry.revision, settings },
            signal
          )
          if (signal.aborted) return
          if (!result.ok) {
            blocked.current = true
            setNotice(result.error.code === 'conflict' ? 'conflict' : 'error')
            return
          }
          const next = (result.value as SettingsView).entries.find((item) => item.id === entry.id)
          if (!next) throw new Error('unavailable')
          saved.current = { entries: saved.current!.entries.map((item) => (item.id === entry.id ? next : item)) }
        }
        for (const key of ['directory', 'prefix'] as const) {
          if (latest.current[key] === patch[key]) delete latest.current[key]
        }
      }
      setSavedNotice(Object.keys(latest.current).length === 0)
    } catch {
      if (!signal.aborted) {
        blocked.current = true
        setNotice('error')
      }
    } finally {
      pending.current = false
      if (!signal.aborted) setSaving(false)
    }
  }
  const change = (key: keyof Patch, value: string) => {
    if (blocked.current) return
    latest.current = { ...latest.current, [key]: value }
    setDraft((current) => ({ ...current, [key]: value }))
    setSavedNotice(false)
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void load()
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (loading || saving || blocked.current || !validPatch(latest.current) || !Object.keys(latest.current).length)
      return
    const timer = setTimeout(() => void save(), 600)
    return () => clearTimeout(timer)
  }, [draft, loading, saving])

  const hasDirectory = view?.entries.some((entry) => entry.kind === 'worktree')
  const mixedDirectory = draft.directory === undefined && hasDirectory
  const mixedPrefix = draft.prefix === undefined && !!view?.entries.length
  const invalidDirectory = draft.directory !== undefined && !validPatch({ directory: draft.directory })
  const invalidPrefix = draft.prefix !== undefined && !validPatch({ prefix: draft.prefix })
  const invalid = invalidDirectory || invalidPrefix
  return (
    <section className="dsh-setting-vcs" aria-label={text.nav} aria-busy={loading || saving}>
      <p>{text.scope}</p>
      {loading && <p role="status">{text.loading}</p>}
      {!loading && view?.entries.length === 0 && <p>{text.empty}</p>}
      {!loading && !!view?.entries.length && (
        <form onSubmit={(event) => event.preventDefault()}>
          <fieldset disabled={blocked.current}>
            {hasDirectory && (
              <SettingsRow
                label={
                  <>
                    <label htmlFor={`${id}-directory`}>{text.directory}</label>
                    <p>{text.directoryHint}</p>
                  </>
                }
              >
                <Input
                  id={`${id}-directory`}
                  value={draft.directory ?? ''}
                  placeholder={mixedDirectory ? text.mixed : undefined}
                  maxLength={4096}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={invalidDirectory || undefined}
                  aria-describedby={invalid ? `${id}-invalid` : undefined}
                  onChange={(event) => change('directory', event.target.value)}
                />
              </SettingsRow>
            )}
            <SettingsRow
              label={
                <>
                  <label htmlFor={`${id}-prefix`}>{text.prefix}</label>
                  <p>{text.prefixHint}</p>
                </>
              }
            >
              <Input
                id={`${id}-prefix`}
                value={draft.prefix ?? ''}
                placeholder={mixedPrefix ? text.mixed : undefined}
                maxLength={100}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={invalidPrefix || undefined}
                aria-describedby={invalid ? `${id}-invalid` : undefined}
                onChange={(event) => change('prefix', event.target.value)}
              />
            </SettingsRow>
            {invalid && (
              <p id={`${id}-invalid`} role="alert">
                {text.invalid}
              </p>
            )}
          </fieldset>
        </form>
      )}
      {(mixedDirectory || mixedPrefix) && <p>{text.mixedHint}</p>}
      {saving && <p role="status">{text.saving}</p>}
      {!saving && savedNotice && <p role="status">{text.saved}</p>}
      {notice && (
        <>
          <p role="alert">{text[notice]}</p>
          <Button type="button" disabled={loading || saving} onClick={() => void load()}>
            {text.refresh}
          </Button>
        </>
      )}
      <p className="dsh-setting-vcs-note">{text.unsupported}</p>
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dungsil-ui-setting-vcs',
        order: 18,
        label: () => localized(ctx.locale.getSnapshot().active).nav,
        inject: () => ({ ctx }),
      },
      VcsSettings
    )
  )
  ctx.effect(
    () =>
      installStyles(`${settingsStyles}
.dsh-setting-vcs { color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-setting-vcs fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.dsh-setting-vcs p { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.dsh-setting-vcs .dsh-plugin-settings-text p { font-size: 12px; line-height: 20px; margin: 4px 0 0; }
.dsh-setting-vcs input { box-sizing: border-box; width: 240px; max-width: 50%; flex: 0 1 240px; min-width: 0; }
.dsh-setting-vcs [role=alert] { color: var(--dsw-alias-state-error-primary); }
.dsh-setting-vcs-note { margin-top: 24px; }
@media (max-width: 520px) { .dsh-setting-vcs .dsh-plugin-settings-row { align-items: stretch; flex-direction: column; gap: 8px; } .dsh-setting-vcs input { width: 100%; max-width: 100%; flex: auto; } }
`),
    'ui-setting-vcs: settings styles'
  )
}
