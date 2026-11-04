import { useEffect, useId, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { IconChevronRightOutlineRegular, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { channel, method, type SkillsView } from './protocol.js'

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
.dsh-skills-settings details { border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-skills-settings summary { display: flex; align-items: center; gap: 12px; padding: 16px 0; list-style: none; cursor: pointer; border-radius: var(--dsw-radius-md); }
.dsh-skills-settings summary::-webkit-details-marker { display: none; }
.dsh-skills-settings summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-skills-settings summary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset: 2px; }
.dsh-skills-settings summary svg { flex: none; }
.dsh-skills-settings details[open] summary svg { transform: rotate(90deg); }
.dsh-skills-summary-text { display: flex; align-items: baseline; gap: 16px; min-width: 0; flex: 1; }
.dsh-skills-summary-text strong { max-width: 50%; overflow-wrap: anywhere; }
.dsh-skills-preview { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-skills-settings details[open] .dsh-skills-preview { display: none; }
.dsh-skills-settings details[open] .dsh-skills-summary-text strong { max-width: 100%; }
.dsh-skills-detail { padding: 0 0 16px 28px; overflow-wrap: anywhere; }
@container (max-width: 480px) {
  .dsh-skills-summary-text { align-items: stretch; flex-direction: column; gap: 2px; }
  .dsh-skills-summary-text strong { max-width: 100%; }
}
`

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
  const [source, setSource] = useState<'user-agents' | 'user-dsh'>('user-agents')
  const groups = (['user-agents', 'user-dsh'] as const).map((value) => ({
    value,
    label: value === 'user-agents' ? text.agents : text.dsh,
    skills: view?.skills.filter((skill) => skill.source === value) ?? [],
  }))

  useEffect(() => {
    const controller = new AbortController()
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
    return () => controller.abort()
  }, [connection])

  return (
    <section className="dsh-skills-settings" aria-label={text.nav} aria-busy={!view && !error}>
      <p className="dsh-skills-muted">{text.description}</p>
      {!view && !error && <p role="status">{text.loading}</p>}
      {error && <p role="alert">{text.error}</p>}
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
              <p className="dsh-skills-muted">
                <code>{group.value === 'user-agents' ? '~/.agents/skills' : '$DSH_HOME/skills'}</code>
              </p>
              {group.skills.length === 0 ? (
                <p className="dsh-skills-muted">{text.empty}</p>
              ) : (
                <ul>
                  {group.skills.map((skill) => (
                    <li key={skill.path ?? skill.name}>
                      <details>
                        <summary aria-label={skill.name}>
                          <IconChevronRightOutlineRegular size={16} aria-hidden="true" />
                          <span className="dsh-skills-summary-text">
                            <strong>{skill.name}</strong>
                            <span className="dsh-skills-preview dsh-skills-muted" aria-hidden="true">
                              {skill.description}
                            </span>
                          </span>
                        </summary>
                        <div className="dsh-skills-detail">
                          <p>{skill.description}</p>
                          {skill.path && (
                            <p className="dsh-skills-muted">
                              <code>{skill.path}</code>
                            </p>
                          )}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  )
}

export function apply(ctx: Context) {
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
