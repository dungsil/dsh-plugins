import { useEffect, useId, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { Button, Input, SettingsRow, Switch, settingsStyles } from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { channel, validCommitSettings, type CommitSettings, type CommitSettingsView } from './protocol.js'
import type { CliStatus } from './cli-status.js'

const copy = {
  ko: {
    nav: '버전 관리',
    scope: 'DSH의 Git 버튼이 생성하는 커밋에만 적용합니다. 저장소와 사용자 Git 설정은 변경하지 않습니다.',
    author: '커밋 작성자',
    name: '이름',
    email: '이메일',
    authorHint: '이름과 이메일을 모두 비우면 기존 Git 작성자를 사용합니다. 커미터는 변경하지 않습니다.',
    noSign: '항상 커밋 서명 비활성화',
    noSignHint:
      '활성화하면 이 UI에서 생성하는 커밋에 --no-gpg-sign을 적용합니다. 비활성화하면 기존 Git 서명 설정을 따릅니다.',
    loading: '불러오는 중…',
    error: '결과를 확인하지 못했습니다. 새로고침한 뒤 다시 시도하세요.',
    conflict: '다른 곳에서 설정을 변경했습니다. 새로고침한 뒤 다시 입력하세요.',
    invalid: '이름과 올바른 이메일을 함께 입력하거나 두 항목을 모두 비우세요.',
    cli: 'CLI 인증 상태',
    refresh: '새로고침',
    authenticated: '인증됨',
    unauthenticated: '인증되지 않음',
    unavailable: '설치되지 않음',
    errorStatus: '확인 실패',
    environment: '환경 변수',
    keyring: '키링',
    'config-file': 'CLI 설정 파일',
  },
  en: {
    nav: 'Version control',
    scope:
      'Only applies to commits created by DSH Git buttons. Repository and user Git configuration are never changed.',
    author: 'Commit author',
    name: 'Name',
    email: 'Email',
    authorHint: 'Leave both fields empty to use the existing Git author. The committer is not changed.',
    noSign: 'Always disable commit signing',
    noSignHint:
      'When enabled, commits created by this UI use --no-gpg-sign. Otherwise, existing Git signing settings apply.',
    loading: 'Loading…',
    error: 'Could not confirm the result. Refresh before retrying.',
    conflict: 'Settings changed elsewhere. Refresh and enter your changes again.',
    invalid: 'Enter both a name and a valid email, or leave both fields empty.',
    cli: 'CLI authentication',
    refresh: 'Refresh',
    authenticated: 'Authenticated',
    unauthenticated: 'Not authenticated',
    unavailable: 'Not installed',
    errorStatus: 'Check failed',
    environment: 'Environment variable',
    keyring: 'Keyring',
    'config-file': 'CLI config file',
  },
  zh: {
    nav: '版本控制',
    scope: '仅适用于 DSH Git 按钮创建的提交，不会修改仓库或用户 Git 配置。',
    author: '提交作者',
    name: '姓名',
    email: '邮箱',
    authorHint: '将两个字段都留空以使用现有 Git 作者，不更改提交者。',
    noSign: '始终禁用提交签名',
    noSignHint: '启用时，此 UI 创建的提交使用 --no-gpg-sign；否则遵循现有 Git 签名设置。',
    loading: '正在加载…',
    error: '无法确认结果，请刷新后重试。',
    conflict: '设置已在其他位置更改，请刷新后重新输入。',
    invalid: '请输入姓名和有效邮箱，或将两个字段都留空。',
    cli: 'CLI 认证状态',
    refresh: '刷新',
    authenticated: '已认证',
    unauthenticated: '未认证',
    unavailable: '未安装',
    errorStatus: '检查失败',
    environment: '环境变量',
    keyring: '密钥环',
    'config-file': 'CLI 配置文件',
  },
}
const localized = (language: string) => copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']

function VcsSettings({ ctx }: { ctx: Context }) {
  const { active } = useLocaleSnapshot(ctx.locale)
  const text = localized(active)
  const id = useId()
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const [view, setView] = useState<CommitSettingsView>()
  const [draft, setDraft] = useState<CommitSettings>()
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [notice, setNotice] = useState<'error' | 'conflict'>()
  const [cli, setCli] = useState<CliStatus[]>()
  const [checking, setChecking] = useState(false)
  const [cliError, setCliError] = useState(false)
  const pending = useRef(false)
  const lifetime = useRef<AbortController | null>(null)

  const load = async (signal: AbortSignal) => {
    setBusy(true)
    try {
      const result = await connection.rpc.call(channel, 'dungsil-vcs/settings', {}, signal)
      if (signal.aborted) return
      if (!result.ok) throw new Error('unavailable')
      const next = result.value as CommitSettingsView
      setView(next)
      setDraft(next.settings)
      setBlocked(false)
      setNotice(undefined)
    } catch {
      if (!signal.aborted) {
        setBlocked(true)
        setNotice('error')
      }
    } finally {
      if (!signal.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void load(controller.signal)
    void check(controller.signal)
    return () => controller.abort()
  }, [])

  const check = async (signal: AbortSignal) => {
    setChecking(true)
    setCliError(false)
    try {
      const result = await connection.rpc.call(channel, 'dungsil-vcs/cli-status', {}, signal)
      if (signal.aborted) return
      if (!result.ok) throw new Error('unavailable')
      setCli(result.value as CliStatus[])
    } catch {
      if (!signal.aborted) {
        setCli(undefined)
        setCliError(true)
      }
    } finally {
      if (!signal.aborted) setChecking(false)
    }
  }
  const save = async () => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || pending.current || !view || !validCommitSettings(draft) || blocked) return
    if (JSON.stringify(view.settings) === JSON.stringify(draft)) return
    const settings = draft
    pending.current = true
    setBusy(true)
    setNotice(undefined)
    try {
      const result = await connection.rpc.call(
        channel,
        'dungsil-vcs/save-settings',
        { revision: view.revision, settings },
        signal
      )
      if (signal.aborted) return
      if (!result.ok) {
        setBlocked(true)
        setNotice(result.error.code === 'conflict' ? 'conflict' : 'error')
        return
      }
      const next = result.value as CommitSettingsView
      setView(next)
      setDraft((current) => (JSON.stringify(current) === JSON.stringify(settings) ? next.settings : current))
    } catch {
      if (!signal.aborted) {
        setBlocked(true)
        setNotice('error')
      }
    } finally {
      pending.current = false
      if (!signal.aborted) setBusy(false)
    }
  }
  useEffect(() => {
    if (busy || blocked || !view || !validCommitSettings(draft)) return
    if (JSON.stringify(view.settings) === JSON.stringify(draft)) return
    const timer = setTimeout(() => void save(), 600)
    return () => clearTimeout(timer)
  }, [draft, view, busy, blocked])

  return (
    <section className="dsh-vcs-settings" aria-label={text.nav}>
      <p>{text.scope}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        {draft && (
          <fieldset disabled={blocked}>
            <h3>{text.author}</h3>
            <p>{text.authorHint}</p>
            <SettingsRow label={<label htmlFor={`${id}-name`}>{text.name}</label>}>
              <Input
                className="dsh-vcs-settings-input"
                id={`${id}-name`}
                value={draft.authorName}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => {
                  setDraft({ ...draft, authorName: event.target.value })
                  setNotice(undefined)
                }}
              />
            </SettingsRow>
            <SettingsRow label={<label htmlFor={`${id}-email`}>{text.email}</label>}>
              <Input
                className="dsh-vcs-settings-input"
                id={`${id}-email`}
                type="email"
                value={draft.authorEmail}
                maxLength={254}
                autoComplete="off"
                onChange={(event) => {
                  setDraft({ ...draft, authorEmail: event.target.value })
                  setNotice(undefined)
                }}
              />
            </SettingsRow>
            <SettingsRow
              label={
                <>
                  <div>{text.noSign}</div>
                  <p>{text.noSignHint}</p>
                </>
              }
            >
              <Switch
                label={text.noSign}
                checked={draft.noSign}
                disabled={blocked}
                onChange={(noSign) => {
                  setDraft({ ...draft, noSign })
                  setNotice(undefined)
                }}
              />
            </SettingsRow>
            {!validCommitSettings(draft) && <p role="alert">{text.invalid}</p>}
          </fieldset>
        )}
        {busy && <p role="status">{text.loading}</p>}
        {notice && <p role="alert">{text[notice]}</p>}
        {blocked && (
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              if (lifetime.current) void load(lifetime.current.signal)
            }}
          >
            {text.refresh}
          </Button>
        )}
      </form>
      <h3>{text.cli}</h3>
      {checking && <p role="status">{text.loading}</p>}
      {cliError && <p role="alert">{text.error}</p>}
      {cli?.map((item) => (
        <div className="dsh-vcs-settings-cli" key={item.cli}>
          <SettingsRow label={<strong>{item.cli}</strong>}>
            <span>{text[item.status === 'error' ? 'errorStatus' : item.status]}</span>
          </SettingsRow>
          {item.accounts.map((account, index) => (
            <p key={index}>
              <code>{account.host}</code> · {account.login}
              {account.method && <> · {text[account.method]}</>}
            </p>
          ))}
        </div>
      ))}
    </section>
  )
}

export function apply(ctx: Context) {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dungsil-ui-vcs',
        order: 17,
        label: () => localized(ctx.locale.getSnapshot().active).nav,
        inject: () => ({ ctx }),
      },
      VcsSettings
    )
  )
  ctx.effect(
    () =>
      installStyles(`${settingsStyles}
.dsh-vcs-settings { color: var(--dsw-alias-label-primary); font: 14px/22px var(--dsw-font-family, system-ui); }
.dsh-vcs-settings fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.dsh-vcs-settings h3 { font: inherit; font-weight: 600; margin: 24px 0 8px; }
.dsh-vcs-settings p { color: var(--dsw-alias-label-secondary); margin: 8px 0; overflow-wrap: anywhere; }
.dsh-vcs-settings .dsh-plugin-settings-text p { font-size: 12px; line-height: 20px; margin: 4px 0 0; }
.dsh-vcs-settings-input { box-sizing: border-box; width: 240px; max-width: 65%; flex: 0 1 240px; min-width: 0; }
.dsh-vcs-settings [role=alert] { color: var(--dsw-alias-state-error-primary); }
.dsh-vcs-settings-cli .dsh-plugin-settings-row { padding: 8px 0; }
`),
    'ui-vcs: settings styles'
  )
}
