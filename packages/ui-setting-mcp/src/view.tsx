import { useEffect, useId, useMemo, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { Button, Input, Modal, Switch } from '@dungsil/dsh-ui'
import { localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { formatCopy, translations, type McpKey, type ResetKey, type McpTranslate } from './locale.js'
import { McpPageState } from './page-state.js'
import type { McpEditor, McpPageSnapshot } from './page-state.js'
import type { McpSource } from './model.js'

const stateKeys: Record<string, McpKey> = {
  closed: 'state.closed',
  connected: 'state.connected',
  connecting: 'state.connecting',
  disabled: 'state.disabled',
  failed: 'state.failed',
  reconnecting: 'state.reconnecting',
  'waiting-credentials': 'state.waiting-credentials',
}
type EditorKey = 'name' | 'command' | 'args' | 'env' | 'cwd' | 'url' | 'headers'

function EditorField({
  name: _name,
  value,
  label,
  hint,
  secret,
  disabled,
  visible,
  onChange,
}: {
  name: EditorKey
  value: string
  label: string
  hint?: string
  secret?: boolean
  disabled: boolean
  visible: boolean
  onChange: (next: string) => void
}) {
  const id = useId()
  return (
    <div className="dsh-mcp-field">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        value={value}
        type={secret && !visible ? 'password' : 'text'}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <small>{hint}</small>}
    </div>
  )
}

function EditorModal({
  editor,
  page,
  state,
  t,
}: {
  editor: McpEditor
  page: McpPageSnapshot
  state: McpPageState
  t: McpTranslate
}) {
  const draft = editor.draft
  const fields: { name: EditorKey; label: McpKey; hint?: McpKey; secret?: boolean }[] = [
    { name: 'name', label: 'name', hint: 'nameHint' },
    ...(draft.transport === 'stdio'
      ? ([
          { name: 'command', label: 'command' },
          { name: 'args', label: 'args', hint: 'argsHint', secret: true },
          { name: 'env', label: 'env', hint: 'envHint', secret: true },
          { name: 'cwd', label: 'cwd' },
        ] as const)
      : ([
          { name: 'url', label: 'url', hint: 'urlHint', secret: true },
          { name: 'headers', label: 'headers', hint: 'headersHint', secret: true },
        ] as const)),
  ]
  return (
    <Modal
      open
      title={t(editor.originalName ? 'editTitle' : 'addTitle')}
      closeLabel={t('close')}
      onClose={state.closeEditor}
    >
      <div className="dsh-mcp-modal" aria-busy={page.pending}>
        <div className="dsh-mcp-field">
          <label htmlFor="dsh-mcp-transport">{t('transport')}</label>
          <select
            id="dsh-mcp-transport"
            value={draft.transport}
            disabled={page.pending}
            onChange={(event) => state.updateDraft('transport', event.target.value)}
          >
            <option value="stdio">{t('stdio')}</option>
            <option value="streamable-http">{t('http')}</option>
          </select>
        </div>
        {fields.map((field) => (
          <EditorField
            key={field.name}
            name={field.name}
            label={t(field.label)}
            hint={field.hint ? t(field.hint) : undefined}
            value={draft[field.name]}
            disabled={page.pending || (field.name === 'name' && !!editor.originalName)}
            secret={field.secret}
            visible={page.sensitiveVisible}
            onChange={(value) => state.updateDraft(field.name, value)}
          />
        ))}
        <Switch
          label={t('enabled')}
          checked={draft.enabled}
          disabled={page.pending}
          onChange={(checked) => state.updateDraft('enabled', checked)}
        />
        <Switch
          label={t('revealSensitive')}
          checked={page.sensitiveVisible}
          disabled={page.pending}
          onChange={state.revealSensitive}
        />
        <p className="dsh-mcp-help">{t('credentialHelp')}</p>
        {page.editorError && <p role="alert">{t(page.editorError)}</p>}
        <div className="dsh-mcp-actions">
          <Button type="button" disabled={page.pending} onClick={state.closeEditor}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={page.pending || !page.snapshot?.writable} onClick={() => void state.save()}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** The official manager owns actual MCP tools and processes; this component presents editable state. */
export function McpSettings({ ctx, source }: { ctx: Context; source: McpSource }) {
  const { active } = useLocaleSnapshot(ctx.locale)
  const copy = localizedCopy(translations, active)
  const t: McpTranslate = (key, params) => formatCopy(copy.ui[key], params)
  const reset = (key: ResetKey, params?: Record<string, string>) => formatCopy(copy.reset[key], params)
  const state = useMemo(() => new McpPageState(source), [source])
  const page = useSyncExternalStore(state.subscribe, state.getSnapshot)
  useEffect(() => state.start(), [state])
  const snapshot = page.snapshot
  const names = [...new Set([...Object.keys(snapshot?.entries ?? {}), ...page.statuses.map((x) => x.name)])].toSorted()
  const matched = names.filter((name) => name.toLowerCase().includes(page.search.trim().toLowerCase()))
  const canWrite = snapshot?.writable === true && !page.pending

  return (
    <section className="dsh-mcp-settings" aria-label={t('title')} aria-busy={page.loading || page.pending}>
      <h2>{t('title')}</h2>
      <p className="dsh-mcp-help">{t('intro')}</p>
      <div className="dsh-mcp-toolbar">
        <Input
          value={page.search}
          aria-label={t('search')}
          placeholder={t('search')}
          onChange={(event) => state.search(event.target.value)}
        />
        <Button type="button" disabled={page.pending} onClick={state.refresh}>
          {t('refresh')}
        </Button>
        <Button type="button" disabled={!canWrite} onClick={() => state.openEditor()}>
          {t('add')}
        </Button>
      </div>
      {page.loading && !snapshot && <p role="status">{t('loading')}</p>}
      {page.loadError && <p role="alert">{t('loadFailed')}</p>}
      {page.watchError && <p role="alert">{t('watchFailed')}</p>}
      {page.notice && <p role={page.notice.error ? 'alert' : 'status'}>{t(page.notice.key)}</p>}
      {snapshot && !snapshot.writable && <p role="status">{t('readOnly')}</p>}
      {snapshot && names.length === 0 && <p>{t('empty')}</p>}
      {snapshot && names.length > 0 && matched.length === 0 && <p>{t('noMatches')}</p>}
      <div className="dsh-mcp-list">
        {matched.map((name) => {
          const entry = snapshot?.entries[name]
          const status = page.statuses.find((x) => x.name === name)
          const inherited = snapshot?.inherited.includes(name) === true
          const stateName = status?.state ?? (entry?.enabled === false ? 'disabled' : 'connecting')
          const blocked =
            page.cleanupBlocked.has(name) || status?.cleanupFailed === true || status?.configured === false
          const tag =
            entry === undefined
              ? status?.configured === false
                ? t('removedStatus')
                : t('plugin')
              : inherited
                ? t('inherited')
                : null
          return (
            <article className="dsh-mcp-card" key={name}>
              <div className="dsh-mcp-card-header">
                <strong>{name}</strong>
                {tag && <span className="dsh-mcp-tag">{tag}</span>}
                <span className="dsh-mcp-status" data-state={stateName}>
                  {t(stateKeys[stateName] ?? 'state.unknown')}
                </span>
              </div>
              <div className="dsh-mcp-details">
                {entry && <span>{entry.transport === 'stdio' ? t('stdio') : t('http')}</span>}
                <span>
                  {t('tools')}: {status?.toolCount ?? '–'}
                </span>
              </div>
              {entry && (
                <div className="dsh-mcp-activation">
                  <Switch
                    label={t('enableServer', { name })}
                    checked={entry.enabled !== false}
                    disabled={!canWrite}
                    onChange={(checked) => state.setEnabled(name, checked)}
                  />
                  {snapshot?.enabledOverrides.includes(name) && (
                    <Button
                      type="button"
                      disabled={!canWrite || page.loading || page.loadError}
                      onClick={() => state.resetEnabled(name)}
                    >
                      {reset('restoreDefault')}
                    </Button>
                  )}
                </div>
              )}
              <div className="dsh-mcp-actions">
                <Button type="button" disabled={page.pending || blocked} onClick={() => state.probe(name)}>
                  {t('probe')}
                </Button>
                <Button
                  type="button"
                  disabled={page.pending || blocked || entry?.enabled === false || stateName === 'disabled'}
                  onClick={() => state.restart(name)}
                >
                  {t('restart')}
                </Button>
                {entry && (
                  <Button type="button" disabled={!canWrite} onClick={() => state.openEditor(name)}>
                    {t('edit')}
                  </Button>
                )}
                {entry && !inherited && (
                  <Button type="button" disabled={!canWrite} onClick={() => state.confirmRemove(name)}>
                    {t('remove')}
                  </Button>
                )}
              </div>
            </article>
          )
        })}
      </div>
      {page.statuses.some((s) => !snapshot?.entries[s.name] && s.configured !== false) && <p>{t('pluginHelp')}</p>}
      {snapshot?.inherited.length ? <p>{t('inheritedHelp')}</p> : null}
      {page.editor && <EditorModal editor={page.editor} page={page} state={state} t={t} />}
      {page.removing && (
        <Modal open title={t('removeTitle')} closeLabel={t('close')} onClose={state.cancelRemove}>
          <p>{t('removeMessage', { name: page.removing.name })}</p>
          <div className="dsh-mcp-actions">
            <Button type="button" disabled={page.pending} onClick={state.cancelRemove}>
              {t('cancel')}
            </Button>
            <Button type="button" disabled={!canWrite} onClick={() => void state.remove()}>
              {t('remove')}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  )
}
