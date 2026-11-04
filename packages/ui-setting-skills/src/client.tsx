import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SettingsRow, settingsStyles } from '@dungsil/dsh-ui'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { channel, method, type SkillsView } from './protocol.js'

export const name = 'dungsil-ui-setting-skills'
export const inject = ['connection', 'locale', 'slots']

const localizedCopy = (language: string) => (language.startsWith('ko') ? ko : language.startsWith('zh') ? zh : en).ui

const styles = `${settingsStyles}
.dsh-skills-settings { color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-skills-settings h3 { font-size: 14px; margin: 24px 0 0; }
.dsh-skills-settings p { margin: 4px 0; }
.dsh-skills-settings .dsh-skills-muted { color: var(--dsw-alias-label-secondary); }
.dsh-skills-settings .dsh-plugin-settings-row { overflow-wrap: anywhere; }
.dsh-skills-settings ul { list-style: none; margin: 0; padding: 0; }
.dsh-skills-settings code { font-size: 12px; overflow-wrap: anywhere; }
.dsh-skills-settings [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
`

function SkillsSettings({ ctx }: { ctx: Context }) {
  const locale = useSyncExternalStore(
    (listener) => ctx.locale.subscribe(listener),
    () => ctx.locale.getSnapshot()
  )
  const text = localizedCopy(locale.active)
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<SkillsView>()
  const [error, setError] = useState(false)

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
      {view &&
        (['user-agents', 'user-dsh'] as const).map((source) => {
          const skills = view.skills.filter((skill) => skill.source === source)
          return (
            <div key={source}>
              <h3>{source === 'user-agents' ? text.agents : text.dsh}</h3>
              <p className="dsh-skills-muted">
                <code>{source === 'user-agents' ? '~/.agents/skills' : '$DSH_HOME/skills'}</code>
              </p>
              {skills.length === 0 ? (
                <p className="dsh-skills-muted">{text.empty}</p>
              ) : (
                <ul>
                  {skills.map((skill) => (
                    <li key={skill.path ?? skill.name}>
                      <SettingsRow
                        label={
                          <>
                            <strong>{skill.name}</strong>
                            <p>{skill.description}</p>
                            {skill.path && (
                              <p className="dsh-skills-muted">
                                <code>{skill.path}</code>
                              </p>
                            )}
                          </>
                        }
                      >
                        {null}
                      </SettingsRow>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
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
