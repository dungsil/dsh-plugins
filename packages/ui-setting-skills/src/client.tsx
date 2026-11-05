import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Button, installSettingsIcon, SegmentedControl, Switch, Tooltip } from '@dungsil/dsh-ui'
import {
  IconChevronRightOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconLoadingOutlineRegular,
  IconSkillOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { channel, method, openFolderMethod, saveMethod, translateMethod, type SkillsView } from './protocol.js'

export const name = 'dungsil-ui-setting-skills'
export const inject = ['connection', 'locale', 'slots']

const localizedCopy = (language: string) => (language.startsWith('ko') ? ko : language.startsWith('zh') ? zh : en).ui

const styles = `
.dsh-skills-settings { container-type: inline-size; color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-skills-settings p { margin: 4px 0; }
.dsh-skills-settings-tabs { margin: 20px 0 12px; }
.dsh-skills-settings .dsh-skills-muted { color: var(--dsw-alias-label-secondary); }
.dsh-skills-settings ul { list-style: none; margin: 0; padding: 0; }
.dsh-skills-settings code { font-size: 12px; overflow-wrap: anywhere; }
.dsh-skills-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
.dsh-skills-settings li { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-skills-settings details { min-width: 0; }
.dsh-skills-settings summary { display: flex; align-items: center; gap: 12px; padding: 16px 0; list-style: none; cursor: pointer; border-radius: var(--dsw-radius-md); }
.dsh-skills-settings summary::-webkit-details-marker { display: none; }
.dsh-skills-settings summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-skills-settings summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset: 2px; }
.dsh-skills-settings summary svg { flex: none; }
.dsh-skills-settings details[open] summary svg { transform: rotate(90deg); }
.dsh-skills-summary-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.dsh-skills-title { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.dsh-skills-title strong { min-width: 0; overflow-wrap: anywhere; }
.dsh-skills-title .dsh-skills-muted { flex: none; font-size: 12px; }
.dsh-skills-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-skills-detail { padding: 0 0 16px 28px; overflow-wrap: anywhere; }
.dsh-skills-actions { display: flex; align-items: center; align-self: start; gap: 12px; height: 78px; }
.dsh-skills-folder { width: 28px; padding: 0; }
.dsh-skills-open-error { grid-column: 1 / -1; padding: 0 0 16px 28px; }
.dsh-skills-list-header { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
`

function SkillDescription({
  skill,
  connection,
  language,
  available,
  expanded,
}: {
  skill: SkillsView['skills'][number]
  connection: ConnectionHandle
  language: string
  available: boolean
  expanded: boolean
}) {
  const text = localizedCopy(language)
  const [translated, setTranslated] = useState<string>()
  const [original, setOriginal] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    setTranslated(undefined)
    setOriginal(false)
    setPending(false)
    setFailed(false)
    if (!expanded || !available || !skill.path || !skill.description) return
    const request = new AbortController()
    setPending(true)
    void (async () => {
      try {
        const result = await connection.rpc.call(
          channel,
          translateMethod,
          { path: skill.path, language },
          request.signal
        )
        if (request.signal.aborted) return
        if (!result.ok || typeof result.value !== 'string') throw new Error('Could not translate description')
        setTranslated(result.value)
      } catch {
        if (!request.signal.aborted) setFailed(true)
      } finally {
        if (!request.signal.aborted) setPending(false)
      }
    })()
    return () => request.abort()
  }, [expanded, skill.description, skill.path, language, available, connection, retry])

  return (
    <>
      <p>{original || translated === undefined ? skill.description : translated}</p>
      {available && skill.path && skill.description && (
        <>
          {pending && <p role="status">{text.translating}</p>}
          {translated !== undefined && (
            <Button variant="ghost" size="sm" onClick={() => setOriginal((value) => !value)}>
              {original ? text.translate : text.original}
            </Button>
          )}
          {failed && (
            <>
              <p role="alert">{text.translationError}</p>
              <Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>
                {text.retry}
              </Button>
            </>
          )}
        </>
      )}
    </>
  )
}

function SkillsSettings({ ctx }: { ctx: Context }) {
  const locale = useSyncExternalStore(
    (listener) => ctx.locale.subscribe(listener),
    () => ctx.locale.getSnapshot()
  )
  const text = localizedCopy(locale.active)
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<SkillsView>()
  const [error, setError] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [folderStatus, setFolderStatus] = useState<Record<string, 'opening' | 'error' | undefined>>({})
  const openingPending = useRef(new Set<string>())
  const pending = useRef(false)
  const mounted = useRef(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [source, setSource] = useState<'user-agents' | 'user-dsh'>('user-agents')
  const groups = (['user-agents', 'user-dsh'] as const).map((value) => ({
    value,
    label: value === 'user-agents' ? text.agents : text.dsh,
    skills: view?.skills.filter((skill) => skill.source === value) ?? [],
  }))

  useEffect(() => {
    const controller = new AbortController()
    mounted.current = true
    setView(undefined)
    setError(false)
    void (async () => {
      try {
        const result = await connection.rpc.call(channel, method, {}, controller.signal)
        if (controller.signal.aborted) return
        if (!result.ok) throw new Error('Could not load skills')
        setView(result.value as unknown as SkillsView)
      } catch {
        if (!controller.signal.aborted) setError(true)
      }
    })()
    return () => {
      mounted.current = false
      controller.abort()
    }
  }, [connection])

  async function save(name: string, disabled: boolean) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setSaveError(false)
    try {
      const result = await connection.rpc.call(channel, saveMethod, { name, disabled })
      if (!result.ok) throw new Error('Could not save skills')
      const value = result.value as unknown as { disabled: string[] }
      if (mounted.current) setView((current) => current && { ...current, disabled: value.disabled })
    } catch {
      if (mounted.current) setSaveError(true)
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function openFolder(path: string) {
    if (openingPending.current.has(path)) return
    openingPending.current.add(path)
    setFolderStatus((current) => ({ ...current, [path]: 'opening' }))
    try {
      const result = await connection.rpc.call(channel, openFolderMethod, { path })
      if (!result.ok) throw new Error('Could not open skill folder')
      if (mounted.current) setFolderStatus((current) => ({ ...current, [path]: undefined }))
    } catch {
      if (mounted.current) setFolderStatus((current) => ({ ...current, [path]: 'error' }))
    } finally {
      openingPending.current.delete(path)
    }
  }

  return (
    <section className="dsh-skills-settings" aria-label={text.nav} aria-busy={!view && !error}>
      <p className="dsh-skills-muted">{text.description}</p>
      {view && !view.folderOpenAvailable && <p className="dsh-skills-muted">{text.openFolderUnavailable}</p>}
      {view?.translationAvailable && <p className="dsh-skills-muted">{text.translationNotice}</p>}
      {!view && !error && <p role="status">{text.loading}</p>}
      {error && <p role="alert">{text.error}</p>}
      {saveError && <p role="alert">{text.saveError}</p>}
      {view && !view.complete && <p role="alert">{text.incomplete}</p>}
      {view && (
        <>
          <SegmentedControl
            id={id}
            className="dsh-skills-settings-tabs"
            value={source}
            options={groups.map((group) => ({ value: group.value, label: `${group.label} ${group.skills.length}` }))}
            onChange={setSource}
            label={text.nav}
          />
          {groups.map((group) => (
            <div
              key={group.value}
              id={`${id}-${group.value}-panel`}
              role="tabpanel"
              aria-labelledby={`${id}-${group.value}`}
              hidden={source !== group.value}
              tabIndex={0}
            >
              {group.skills.length === 0 ? (
                <p className="dsh-skills-muted">{text.empty}</p>
              ) : (
                <>
                  <div className="dsh-skills-list-header dsh-skills-muted" aria-hidden="true">
                    <span>
                      {text.nav} {group.skills.length}
                    </span>
                    <span>{text.use}</span>
                  </div>
                  <ul>
                    {group.skills.map((skill) => (
                      <li key={skill.path ?? skill.name}>
                        <details
                          onToggle={(event) => {
                            const open = event.currentTarget.open
                            setExpanded((current) => ({ ...current, [skill.path ?? skill.name]: open }))
                          }}
                        >
                          <summary aria-label={skill.name}>
                            <IconChevronRightOutlineRegular size={16} aria-hidden="true" />
                            <span className="dsh-skills-summary-text">
                              <span className="dsh-skills-title">
                                <strong>{skill.name}</strong>
                                {view.disabled.includes(skill.name) && (
                                  <span className="dsh-skills-muted">{text.disabled}</span>
                                )}
                              </span>
                              <span className="dsh-skills-preview dsh-skills-muted" aria-hidden="true">
                                {skill.description}
                              </span>
                            </span>
                          </summary>
                          <div className="dsh-skills-detail">
                            <SkillDescription
                              skill={skill}
                              connection={connection}
                              language={locale.active}
                              available={view.translationAvailable && source === group.value}
                              expanded={expanded[skill.path ?? skill.name] ?? false}
                            />
                            {skill.path && (
                              <p className="dsh-skills-muted">
                                <code>{skill.path}</code>
                              </p>
                            )}
                          </div>
                        </details>
                        <div className="dsh-skills-actions">
                          {skill.path && (
                            <Tooltip
                              label={folderStatus[skill.path] === 'opening' ? text.openingFolder : text.openFolder}
                              side="top"
                              portal
                            >
                              <Button
                                className="dsh-skills-folder"
                                variant="ghost"
                                size="sm"
                                aria-label={`${folderStatus[skill.path] === 'opening' ? text.openingFolder : text.openFolder}: ${skill.name}`}
                                aria-busy={folderStatus[skill.path] === 'opening'}
                                disabled={!view.folderOpenAvailable || folderStatus[skill.path] === 'opening'}
                                aria-description={
                                  view.folderOpenAvailable ? text.openFolderHint : text.openFolderUnavailable
                                }
                                onClick={() => void openFolder(skill.path!)}
                                icon={
                                  folderStatus[skill.path] === 'opening' ? (
                                    <IconLoadingOutlineRegular size={16} aria-hidden="true" />
                                  ) : (
                                    <IconFolderOpenOutlineRegular size={16} aria-hidden="true" />
                                  )
                                }
                              />
                            </Tooltip>
                          )}
                          <Switch
                            label={`${text.use}: ${skill.name}`}
                            checked={!view.disabled.includes(skill.name)}
                            disabled={busy || saveError}
                            onChange={(enabled) => void save(skill.name, !enabled)}
                          />
                        </div>
                        {skill.path && folderStatus[skill.path] === 'error' && (
                          <p className="dsh-skills-open-error" role="alert">
                            {text.openFolderError}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.effect(() =>
    installSettingsIcon(name, [en.ui.nav, ko.ui.nav, zh.ui.nav], (container) => {
      const root = createRoot(container)
      root.render(<IconSkillOutlineRegular size={16} />)
      return () => root.unmount()
    })
  )
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.append(style)
    return () => style.remove()
  }, 'ui-setting-skills: styles')
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 16,
        label: () => localizedCopy(ctx.locale.getSnapshot().active).nav,
        inject: () => ({ ctx }),
      },
      SkillsSettings
    )
  )
}
