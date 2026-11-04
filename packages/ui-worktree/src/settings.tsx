import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Input, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { SettingsPicker, SettingsRow } from '@dungsil/dsh-ui'
import { channel, endpointPrefix, type WorktreeSettings, type WorktreeSettingsView } from './protocol.js'

const copy = {
  ko: {
    nav: '워크트리',
    directory: '워크트리 풀 디렉터리',
    remote: '추적 중인 원격 브랜치 사용',
    naming: '자동 브랜치 이름 형식',
    semantic: '시멘틱 (feat/… 또는 fix/…)',
    dsh: 'DSH (dsh/*)',
    custom: '사용자 지정 접두사',
    prefix: '브랜치 접두사',
    loading: '설정을 불러오는 중입니다…',
    saving: '저장 중…',
    error: '변경 결과를 확인하지 못했습니다. 저장된 값을 확인한 뒤 다시 변경하세요.',
    conflict: '다른 곳에서 설정을 변경했습니다. 저장된 값을 확인한 뒤 다시 변경하세요.',
    unavailable: '설정을 불러오지 못했습니다. 연결을 확인한 뒤 설정 화면을 다시 여세요.',
    invalidDirectory: '공백이 아닌 경로를 4096자 이내로 입력하세요. 줄바꿈은 사용할 수 없습니다.',
    invalidPrefix: '올바른 접두사를 100자 이내로 입력하세요. 사용자 지정 접두사는 비워 둘 수 없습니다.',
  },
  zh: {
    nav: '工作树',
    directory: '工作树池目录',
    remote: '使用跟踪的远程分支',
    naming: '自动分支命名格式',
    semantic: '语义化（feat/… 或 fix/…）',
    dsh: 'DSH（dsh/*）',
    custom: '自定义前缀',
    prefix: '分支前缀',
    loading: '正在加载设置…',
    saving: '正在保存…',
    error: '无法确认更改结果，请检查已保存的值后再进行更改。',
    conflict: '设置已在其他位置更改，请检查已保存的值后再进行更改。',
    unavailable: '无法加载设置，请检查连接后重新打开此设置页面。',
    invalidDirectory: '请输入不超过 4096 个字符的非空路径，不能包含换行符。',
    invalidPrefix: '请输入不超过 100 个字符的有效前缀，自定义前缀不能为空。',
  },
  en: {
    nav: 'Worktrees',
    directory: 'Worktree pool directory',
    remote: 'Use tracked remote branch',
    naming: 'Automatic branch naming',
    semantic: 'Semantic (feat/… or fix/…)',
    dsh: 'DSH (dsh/*)',
    custom: 'Custom prefix',
    prefix: 'Branch prefix',
    loading: 'Loading settings…',
    saving: 'Saving…',
    error: 'Could not confirm the change. Check the saved values before you change them again.',
    conflict: 'Settings changed elsewhere. Check the saved values before you change them again.',
    unavailable: 'Could not load settings. Check the connection and reopen this settings page.',
    invalidDirectory: 'Enter a nonblank path of at most 4096 characters without line breaks.',
    invalidPrefix: 'Enter a valid prefix of at most 100 characters. A custom prefix cannot be empty.',
  },
}

const languageKey = (language: string) => (language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en')
export const settingsLabel = (language: string) => copy[languageKey(language)].nav

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
  const text = copy[languageKey(language)]
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [draft, setDraft] = useState<WorktreeSettings>()
  const [operation, setOperation] = useState<'loading' | 'saving' | undefined>('loading')
  const [notice, setNotice] = useState<'error' | 'conflict' | 'unavailable'>()
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
    } catch {
      if (controller.signal.aborted) return
      blocked.current = true
      setNotice('error')
    } finally {
      if (!controller.signal.aborted) {
        if (blocked.current) {
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
            <SettingsRow
              label={
                <>
                  <label htmlFor={`${id}-directory`}>{text.directory}</label>
                  {invalidDirectory && (
                    <p id={`${id}-directory-error`} role="alert">
                      {text.invalidDirectory}
                    </p>
                  )}
                </>
              }
            >
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
                aria-describedby={invalidDirectory ? `${id}-directory-error` : undefined}
                onChange={(event) => change({ directory: event.target.value })}
              />
            </SettingsRow>
            <SettingsRow label={<div className="dsh-worktree-settings-title">{text.remote}</div>}>
              <Switch
                label={text.remote}
                checked={draft.remote}
                disabled={disabled}
                onChange={(remote) => change({ remote })}
              />
            </SettingsRow>
            <SettingsRow
              label={
                <div id={`${id}-naming`} className="dsh-worktree-settings-title">
                  {text.naming}
                </div>
              }
            >
              <SettingsPicker
                className="dsh-worktree-settings-picker"
                disabled={disabled}
                aria-labelledby={`${id}-naming`}
                value={text[draft.naming]}
                selectedId={draft.naming}
                items={(['semantic', 'dsh', 'custom'] as const).map((id) => ({ id, label: text[id] }))}
                onSelect={(naming) => {
                  change({ naming: naming as WorktreeSettings['naming'] })
                }}
              />
            </SettingsRow>
            {draft.naming === 'custom' && (
              <SettingsRow
                label={
                  <>
                    <label htmlFor={`${id}-prefix`}>{text.prefix}</label>
                    {invalidPrefix && (
                      <p id={`${id}-prefix-error`} role="alert">
                        {text.invalidPrefix}
                      </p>
                    )}
                  </>
                }
              >
                <Input
                  className="dsh-worktree-settings-input"
                  id={`${id}-prefix`}
                  type="text"
                  value={draft.prefix}
                  required
                  maxLength={100}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*(/[a-zA-Z0-9][a-zA-Z0-9_\-]*)*/?"
                  aria-invalid={invalidPrefix || undefined}
                  aria-describedby={invalidPrefix ? `${id}-prefix-error` : undefined}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => change({ prefix: event.target.value })}
                />
              </SettingsRow>
            )}
          </fieldset>
        )}
        {operation && <p role="status">{text[operation]}</p>}
        {notice && <p role="alert">{text[notice]}</p>}
      </form>
    </section>
  )
}
