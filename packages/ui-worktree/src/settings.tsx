import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { Button, Input, Menu, Switch, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { channel, endpointPrefix, type WorktreeSettings, type WorktreeSettingsView } from './protocol.js'

const copy = {
  ko: {
    nav: '워크트리',
    directory: '워크트리 풀 디렉터리',
    directoryHint: '원본 저장소 루트 기준 상대 경로 또는 절대 경로를 입력하세요.',
    remote: '추적 중인 원격 브랜치 사용',
    remoteHint: '로컬에 가져온 원격 참조를 사용합니다. 자동으로 fetch하지 않습니다.',
    naming: '자동 브랜치 이름 형식',
    namingHint: '워크트리 생성 시 브랜치 입력을 비운 경우에만 적용합니다.',
    semantic: '시멘틱 (feat/… 또는 fix/…)',
    dsh: 'DSH (dsh/*)',
    custom: '사용자 지정 접두사',
    prefix: '브랜치 접두사',
    prefixHint: '영문·숫자·하이픈·밑줄과 /를 사용하세요. 예: team/, task-',
    save: '저장',
    refresh: '설정 새로고침',
    loading: '설정을 불러오는 중입니다…',
    saving: '저장 중…',
    saved: '설정을 저장했습니다. 다음 워크트리 생성부터 적용합니다.',
    error: '설정을 확인하지 못했습니다. 다시 저장하기 전에 설정을 새로고침하세요.',
    conflict: '다른 곳에서 설정을 변경했습니다. 설정을 새로고침한 뒤 다시 저장하세요.',
  },
  en: {
    nav: 'Worktrees',
    directory: 'Worktree pool directory',
    directoryHint: 'Enter a path relative to the source repository root, or an absolute path.',
    remote: 'Use tracked remote branch',
    remoteHint: 'Uses the locally fetched remote reference. Does not fetch automatically.',
    naming: 'Automatic branch naming',
    namingHint: 'Applies only when the branch input is left empty when creating a worktree.',
    semantic: 'Semantic (feat/… or fix/…)',
    dsh: 'DSH (dsh/*)',
    custom: 'Custom prefix',
    prefix: 'Branch prefix',
    prefixHint: 'Use letters, digits, hyphens, underscores and /. For example: team/, task-',
    save: 'Save',
    refresh: 'Reload settings',
    loading: 'Loading settings…',
    saving: 'Saving…',
    saved: 'Settings saved. Applies to the next worktree creation.',
    error: 'Could not confirm settings. Reload settings before saving again.',
    conflict: 'Settings changed elsewhere. Reload settings before saving again.',
  },
}

export const settingsLabel = (language: string) => copy[language.startsWith('ko') ? 'ko' : 'en'].nav

export function WorktreeSettingsSection({ ctx }: { ctx: Context }) {
  const language = useSyncExternalStore(
    (listener) => ctx.locale.subscribe(listener),
    () => ctx.locale.getSnapshot().active
  )
  const text = copy[language.startsWith('ko') ? 'ko' : 'en']
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<WorktreeSettingsView>()
  const [draft, setDraft] = useState<WorktreeSettings>()
  const [operation, setOperation] = useState<'loading' | 'saving' | undefined>('loading')
  const [notice, setNotice] = useState<'saved' | 'error' | 'conflict'>()
  const [namingOpen, setNamingOpen] = useState(false)
  const pending = useRef(false)
  const needsReload = useRef(false)
  const lifetime = useRef<AbortController | null>(null)

  // Reads and writes share a synchronous lock, including same-tick submissions.
  // An uncertain write must be explicitly reloaded, never automatically retried.
  const request = async (save = false) => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || pending.current) return
    if (save && (!view || !draft || needsReload.current)) return
    pending.current = true
    setNamingOpen(false)
    setOperation(save ? 'saving' : 'loading')
    setNotice(undefined)
    try {
      const result = await connection.rpc.call(
        channel,
        `${endpointPrefix}${save ? 'save-settings' : 'settings'}`,
        save ? { revision: view!.revision, settings: { ...draft! } } : {},
        controller.signal
      )
      if (controller.signal.aborted) return
      if (!result.ok) {
        needsReload.current = true
        setNotice(result.error.code === 'conflict' ? 'conflict' : 'error')
        return
      }
      const next = result.value as WorktreeSettingsView
      setView(next)
      setDraft({ ...next.settings })
      needsReload.current = false
      if (save) setNotice('saved')
    } catch {
      if (!controller.signal.aborted) {
        needsReload.current = true
        setNotice('error')
      }
    } finally {
      if (!controller.signal.aborted) {
        pending.current = false
        setOperation(undefined)
      }
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    pending.current = false
    void request()
    return () => controller.abort()
  }, [])

  const busy = operation !== undefined
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(view?.settings)
  return (
    <section className="dsh-worktree-settings" aria-label={text.nav} aria-busy={busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void request(true)
        }}
      >
        {draft && (
          <fieldset disabled={busy}>
            <div className="dsh-worktree-settings-row">
              <div className="dsh-worktree-settings-text">
                <label htmlFor={`${id}-directory`}>{text.directory}</label>
                <p id={`${id}-directory-hint`}>{text.directoryHint}</p>
              </div>
              <Input
                className="dsh-worktree-settings-input"
                id={`${id}-directory`}
                type="text"
                value={draft.directory}
                required
                maxLength={4096}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-directory-hint`}
                onChange={(event) => setDraft({ ...draft, directory: event.target.value })}
              />
            </div>
            <div className="dsh-worktree-settings-row">
              <div className="dsh-worktree-settings-text">
                <div className="dsh-worktree-settings-title">{text.remote}</div>
                <p>{text.remoteHint}</p>
              </div>
              <Switch
                label={text.remote}
                checked={draft.remote}
                disabled={busy}
                onChange={(remote) => setDraft({ ...draft, remote })}
              />
            </div>
            <div className="dsh-worktree-settings-row">
              <div className="dsh-worktree-settings-text">
                <div id={`${id}-naming`} className="dsh-worktree-settings-title">
                  {text.naming}
                </div>
                <p id={`${id}-naming-hint`}>{text.namingHint}</p>
              </div>
              <Menu
                open={namingOpen}
                align="end"
                portal
                selectedId={draft.naming}
                items={(['semantic', 'dsh', 'custom'] as const).map((id) => ({ id, label: text[id] }))}
                onClose={() => setNamingOpen(false)}
                onSelect={(naming) => {
                  setNamingOpen(false)
                  if (!busy) setDraft({ ...draft, naming: naming as WorktreeSettings['naming'] })
                }}
                anchor={
                  <button
                    type="button"
                    className="dsh-worktree-settings-selector"
                    disabled={busy}
                    aria-labelledby={`${id}-naming`}
                    aria-describedby={`${id}-naming-hint`}
                    aria-haspopup="menu"
                    aria-expanded={namingOpen}
                    onClick={() => setNamingOpen((open) => !open)}
                  >
                    <span>{text[draft.naming]}</span>
                    <IconChevronDownOutlineRegular size={16} aria-hidden="true" />
                  </button>
                }
              />
            </div>
            {draft.naming === 'custom' && (
              <div className="dsh-worktree-settings-row">
                <div className="dsh-worktree-settings-text">
                  <label htmlFor={`${id}-prefix`}>{text.prefix}</label>
                  <p id={`${id}-prefix-hint`}>{text.prefixHint}</p>
                </div>
                <Input
                  className="dsh-worktree-settings-input"
                  id={`${id}-prefix`}
                  type="text"
                  value={draft.prefix}
                  required
                  maxLength={100}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*(/[a-zA-Z0-9][a-zA-Z0-9_\-]*)*/?"
                  aria-describedby={`${id}-prefix-hint`}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => setDraft({ ...draft, prefix: event.target.value })}
                />
              </div>
            )}
          </fieldset>
        )}
        <p role="status">{operation ? text[operation] : notice === 'saved' ? text.saved : ''}</p>
        {(notice === 'error' || notice === 'conflict') && <p role="alert">{text[notice]}</p>}
        <footer>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void request()}>
            {text.refresh}
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !view || !dirty || needsReload.current}>
            {operation === 'saving' ? text.saving : text.save}
          </Button>
        </footer>
      </form>
    </section>
  )
}
