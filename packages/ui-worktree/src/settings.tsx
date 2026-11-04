import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Input, Menu, Switch, IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
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
    loading: '설정을 불러오는 중입니다…',
    saving: '저장 중…',
    saved: '설정을 저장했습니다. 다음 워크트리 생성부터 적용합니다.',
    resynced: '저장된 설정을 다시 불러왔습니다.',
    error: '변경 결과를 확인하지 못했습니다. 저장된 값을 확인한 뒤 다시 변경하세요.',
    conflict: '다른 곳에서 설정을 변경했습니다. 저장된 값을 확인한 뒤 다시 변경하세요.',
    unavailable: '설정을 불러오지 못했습니다. 연결을 확인한 뒤 설정 화면을 다시 여세요.',
    invalidDirectory: '공백이 아닌 경로를 4096자 이내로 입력하세요. 줄바꿈은 사용할 수 없습니다.',
    invalidPrefix: '올바른 접두사를 100자 이내로 입력하세요. 사용자 지정 접두사는 비워 둘 수 없습니다.',
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
    loading: 'Loading settings…',
    saving: 'Saving…',
    saved: 'Settings saved. Applies to the next worktree creation.',
    resynced: 'The saved settings are now shown.',
    error: 'Could not confirm the change. Check the saved values before you change them again.',
    conflict: 'Settings changed elsewhere. Check the saved values before you change them again.',
    unavailable: 'Could not load settings. Check the connection and reopen this settings page.',
    invalidDirectory: 'Enter a nonblank path of at most 4096 characters without line breaks.',
    invalidPrefix: 'Enter a valid prefix of at most 100 characters. A custom prefix cannot be empty.',
  },
}

export const settingsLabel = (language: string) => copy[language.startsWith('ko') ? 'ko' : 'en'].nav

const validDirectory = (value: string) => value.trim().length > 0 && value.length <= 4096 && !/[\0\r\n]/.test(value)
const validPrefix = (value: string) =>
  value.length <= 100 && (value === '' || /^[a-zA-Z0-9][a-zA-Z0-9_-]*(\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*\/?$/.test(value))
const validSettings = (settings: WorktreeSettings) =>
  validDirectory(settings.directory) &&
  validPrefix(settings.prefix) &&
  (settings.naming !== 'custom' || !!settings.prefix)
const sameSettings = (left: WorktreeSettings | undefined, right: WorktreeSettings | undefined) =>
  JSON.stringify(left) === JSON.stringify(right)

export function WorktreeSettingsSection({ ctx }: { ctx: Context }) {
  const language = useSyncExternalStore(
    (listener) => ctx.locale.subscribe(listener),
    () => ctx.locale.getSnapshot().active
  )
  const text = copy[language.startsWith('ko') ? 'ko' : 'en']
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [draft, setDraft] = useState<WorktreeSettings>()
  const [operation, setOperation] = useState<'loading' | 'saving' | undefined>('loading')
  const [notice, setNotice] = useState<'saved' | 'error' | 'conflict' | 'unavailable'>()
  const [namingOpen, setNamingOpen] = useState(false)
  const saved = useRef<WorktreeSettingsView | undefined>(undefined)
  const latest = useRef<WorktreeSettings | undefined>(undefined)
  const pending = useRef(false)
  const blocked = useRef(true)
  const lifetime = useRef<AbortController | null>(null)

  const read = async (controller: AbortController) => {
    const result = await connection.rpc.call(channel, `${endpointPrefix}settings`, {}, controller.signal)
    if (controller.signal.aborted) return
    if (!result.ok) throw new Error('settings failed')
    const next = result.value as WorktreeSettingsView
    saved.current = next
    latest.current = { ...next.settings }
    setDraft(latest.current)
    blocked.current = false
  }

  const load = async () => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || pending.current) return
    pending.current = true
    blocked.current = true
    setNamingOpen(false)
    setOperation('loading')
    try {
      await read(controller)
      if (!controller.signal.aborted) setNotice(undefined)
    } catch {
      if (!controller.signal.aborted) {
        blocked.current = true
        setNotice('unavailable')
      }
    } finally {
      if (!controller.signal.aborted) {
        pending.current = false
        setOperation(undefined)
      }
    }
  }

  const save = async () => {
    const controller = lifetime.current
    if (!controller || controller.signal.aborted || pending.current || blocked.current || !saved.current) return
    pending.current = true
    setNotice(undefined)
    try {
      while (latest.current && validSettings(latest.current) && !sameSettings(latest.current, saved.current.settings)) {
        const submitted = { ...latest.current }
        setOperation('saving')
        const result = await connection.rpc.call(
          channel,
          `${endpointPrefix}save-settings`,
          { revision: saved.current.revision, settings: submitted },
          controller.signal
        )
        if (controller.signal.aborted) return
        if (!result.ok) {
          setNotice(result.error.code === 'conflict' ? 'conflict' : 'error')
          blocked.current = true
          break
        }
        const next = result.value as WorktreeSettingsView
        saved.current = next
        if (sameSettings(latest.current, submitted)) {
          latest.current = { ...next.settings }
          setDraft(latest.current)
        }
      }
      if (!blocked.current && sameSettings(latest.current, saved.current.settings)) setNotice('saved')
    } catch {
      if (controller.signal.aborted) return
      blocked.current = true
      setNotice('error')
    } finally {
      if (!controller.signal.aborted) {
        if (blocked.current) {
          setNamingOpen(false)
          setOperation('loading')
          try {
            await read(controller)
          } catch {
            if (!controller.signal.aborted) setNotice('unavailable')
          }
        }
        if (!controller.signal.aborted) {
          pending.current = false
          setOperation(undefined)
        }
      }
    }
  }

  const change = (patch: Partial<WorktreeSettings>) => {
    if (!latest.current || blocked.current) return
    latest.current = { ...latest.current, ...patch }
    if (patch.naming && patch.naming !== 'custom' && !validPrefix(latest.current.prefix)) latest.current.prefix = ''
    setDraft(latest.current)
    setNotice(undefined)
    if (validSettings(latest.current)) void save()
  }

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    pending.current = false
    blocked.current = true
    void load()
    const refresh = () => {
      if (blocked.current || sameSettings(latest.current, saved.current?.settings)) void load()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    return () => {
      controller.abort()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [])

  const disabled = operation === 'loading' || blocked.current
  const invalidDirectory = !!draft && !validDirectory(draft.directory)
  const invalidPrefix = !!draft && (!validPrefix(draft.prefix) || (draft.naming === 'custom' && !draft.prefix))
  return (
    <section className="dsh-worktree-settings" aria-label={text.nav} aria-busy={operation !== undefined}>
      <form onSubmit={(event) => event.preventDefault()}>
        {draft && (
          <fieldset disabled={disabled}>
            <div className="dsh-worktree-settings-row">
              <div className="dsh-worktree-settings-text">
                <label htmlFor={`${id}-directory`}>{text.directory}</label>
                <p id={`${id}-directory-hint`}>{text.directoryHint}</p>
                {invalidDirectory && (
                  <p id={`${id}-directory-error`} role="alert">
                    {text.invalidDirectory}
                  </p>
                )}
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
                aria-invalid={invalidDirectory || undefined}
                aria-describedby={`${id}-directory-hint${invalidDirectory ? ` ${id}-directory-error` : ''}`}
                onChange={(event) => change({ directory: event.target.value })}
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
                disabled={disabled}
                onChange={(remote) => change({ remote })}
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
                  if (!disabled) change({ naming: naming as WorktreeSettings['naming'] })
                }}
                anchor={
                  <button
                    type="button"
                    className="dsh-worktree-settings-selector"
                    disabled={disabled}
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
                  {invalidPrefix && (
                    <p id={`${id}-prefix-error`} role="alert">
                      {text.invalidPrefix}
                    </p>
                  )}
                </div>
                <Input
                  className="dsh-worktree-settings-input"
                  id={`${id}-prefix`}
                  type="text"
                  value={draft.prefix}
                  required
                  maxLength={100}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*(/[a-zA-Z0-9][a-zA-Z0-9_\-]*)*/?"
                  aria-invalid={invalidPrefix || undefined}
                  aria-describedby={`${id}-prefix-hint${invalidPrefix ? ` ${id}-prefix-error` : ''}`}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => change({ prefix: event.target.value })}
                />
              </div>
            )}
          </fieldset>
        )}
        <p role="status">
          {operation
            ? text[operation]
            : notice === 'saved'
              ? text.saved
              : (notice === 'error' || notice === 'conflict') && !blocked.current
                ? text.resynced
                : ''}
        </p>
        {notice && notice !== 'saved' && <p role="alert">{text[notice]}</p>}
      </form>
    </section>
  )
}
