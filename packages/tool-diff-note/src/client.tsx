import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { Button, FileTypeIcon, writeClipboard } from '@dungsil/dsh-ui'
import {
  IconCheckOutlineRegular,
  IconCopyOutlineRegular,
  IconRightUpOutlineRegular,
  IconWrapLinesOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { structuredPatch } from 'diff'
import { Fragment, useEffect, useMemo, useState } from 'react'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { isDiffNote } from './protocol.js'

export const name = 'dungsil-tool-diff-note'
export const inject = ['slots', 'locale']

const styles = `
.dsh-diff-note { container-type: inline-size; min-width: 0; margin: 8px 0; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; overflow: hidden; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-markdown-code-block); font-size: 13px; }
.dsh-diff-note-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 8px 4px 12px; border-bottom: 1px solid var(--dsw-alias-border-l4); }
.dsh-diff-note-path { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-diff-note-path > svg { flex: none; }
.dsh-diff-note-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-diff-note-directory { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-diff-note-actions { display: flex; flex: none; gap: 2px; }
.dsh-diff-note-actions button { width: 28px; padding: 0; }
.dsh-diff-note-rows { display: grid; grid-template-columns: minmax(max-content, 1fr); overflow-x: auto; padding: 6px 0; }
.dsh-diff-note-line { padding: 0 12px; min-height: 1lh; white-space: pre; color: var(--dsw-alias-label-secondary); font: var(--dsw-font-markdown-code-block); }
.dsh-diff-note-line::before { content: attr(data-prefix); white-space: pre; user-select: none; }
.dsh-diff-note-line[data-kind='+'] { color: var(--dsw-alias-state-success-primary); background: var(--dsw-alias-code-diff-added); }
.dsh-diff-note-line[data-kind='-'] { color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-code-diff-deleted); }
.dsh-diff-note[data-wrap='true'] .dsh-diff-note-rows { grid-template-columns: minmax(0, 1fr); }
.dsh-diff-note[data-wrap='true'] .dsh-diff-note-line { white-space: pre-wrap; overflow-wrap: anywhere; }
.dsh-diff-note-bubble { position: sticky; left: 12px; box-sizing: border-box; width: fit-content; max-width: calc(100cqw - 24px); margin: 10px 12px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
.dsh-diff-note-bubble::before { content: ''; position: absolute; top: -6px; left: 12px; width: 12px; height: 6px; background: inherit; clip-path: polygon(0 100%, 50% 0, 100% 100%); }
.dsh-diff-note-status { margin: 0; padding: 10px 12px; }
.dsh-diff-note-fold { justify-self: start; margin: 2px 8px; }
`

export function apply(ctx: Context) {
  function DiffNoteCard(props: ToolCallViewProps) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = (active.startsWith('ko') ? ko : active.startsWith('zh') ? zh : en).ui
    const note =
      props.phase === 'result' && !props.block.isError && isDiffNote(props.block.meta) ? props.block.meta : undefined
    const failed = props.phase === 'result' && !note
    const [expanded, setExpanded] = useState(false)
    const [wrapped, setWrapped] = useState(false)
    const [copied, setCopied] = useState(false)
    useEffect(() => {
      if (!copied) return
      const timer = window.setTimeout(() => setCopied(false), 1000)
      return () => window.clearTimeout(timer)
    }, [copied])
    const rows = useMemo(() => {
      if (!note) return []
      const lines = (value: string) =>
        value === '' ? [] : (value.endsWith('\n') ? value.slice(0, -1) : value).split('\n')
      const before = lines(note.old_text)
      const after = lines(note.new_text)
      // Match DSH's line-terminator rule and bounded diff search.
      const normalize = (value: string[]) => value.map((line) => `${line}\n`).join('')
      const patch = structuredPatch('', '', normalize(before), normalize(after), undefined, undefined, {
        context: 3,
        maxEditLength: 256,
      })
      return patch
        ? patch.hunks.flatMap((hunk, index) => (index ? ['⋯', ...hunk.lines] : hunk.lines))
        : [...before.map((line) => `-${line}`), ...after.map((line) => `+${line}`)]
    }, [note])
    let annotationIndex = rows.findIndex((line) => line.startsWith('+') || line.startsWith('-'))
    if (annotationIndex !== -1) while (rows[annotationIndex + 1]?.match(/^[+-]/u)) annotationIndex++
    const visible = rows
      .map((_, index) => index)
      .filter(
        (index) =>
          expanded ||
          index < 3 ||
          index >= rows.length - 3 ||
          (index >= annotationIndex - 1 && index <= annotationIndex)
      )
    const hidden = rows.length - visible.length
    const filePath = note?.path.replaceAll('\\', '/') ?? ''
    const fileName = filePath.slice(filePath.lastIndexOf('/') + 1)
    const directory = filePath.slice(0, Math.max(0, filePath.lastIndexOf('/')))
    return (
      <section className="dsh-diff-note" aria-label={text.title} data-wrap={wrapped}>
        {note ? (
          <>
            <header className="dsh-diff-note-header">
              <div className="dsh-diff-note-path" title={note.path}>
                <FileTypeIcon path={note.path} size={16} />
                <span className="dsh-diff-note-name">{fileName}</span>
                <span className="dsh-diff-note-directory">{directory}</span>
              </div>
              <div className="dsh-diff-note-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={text.open}
                  title={text.open}
                  onClick={() => props.openFile(note.path)}
                >
                  <IconRightUpOutlineRegular />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={wrapped ? text.unwrapLabel : text.wrapLabel}
                  title={wrapped ? text.unwrapLabel : text.wrapLabel}
                  aria-pressed={wrapped}
                  onClick={() => setWrapped(!wrapped)}
                >
                  <IconWrapLinesOutlineRegular />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={copied ? text.copied : text.copy}
                  title={copied ? text.copied : text.copy}
                  onClick={async () => {
                    if (
                      await writeClipboard(
                        [note.path, ...rows.map((line) => (line === '⋯' ? line : `${line[0]} ${line.slice(1)}`))].join(
                          '\n'
                        )
                      )
                    )
                      setCopied(true)
                  }}
                >
                  {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
                </Button>
              </div>
            </header>
            <div className="dsh-diff-note-rows">
              {visible.map((index, position) => {
                const skipped = index - (visible[position - 1] ?? -1) - 1
                const line = rows[index]!
                return (
                  <Fragment key={index}>
                    {skipped > 0 && (
                      <Button
                        className="dsh-diff-note-fold"
                        size="sm"
                        aria-expanded={false}
                        aria-label={text.expandAria.replace('{count}', String(hidden))}
                        onClick={() => setExpanded(true)}
                      >
                        {text.expand.replace('{count}', String(hidden))}
                      </Button>
                    )}
                    <div
                      className="dsh-diff-note-line"
                      data-kind={line[0]}
                      data-prefix={line === '⋯' ? '  ' : `${line[0]} `}
                    >
                      {line === '⋯' ? line : line.slice(1)}
                    </div>
                    {index === annotationIndex && <p className="dsh-diff-note-bubble">{note.note}</p>}
                  </Fragment>
                )
              })}
              {annotationIndex === -1 && <p className="dsh-diff-note-bubble">{note.note}</p>}
              {expanded && rows.length > 8 && (
                <Button
                  className="dsh-diff-note-fold"
                  size="sm"
                  aria-expanded={true}
                  aria-label={text.collapseAria}
                  onClick={() => setExpanded(false)}
                >
                  {text.collapse}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p className="dsh-diff-note-status" role="status">
            {failed ? text.failed : text.waiting}
          </p>
        )}
      </section>
    )
  }

  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({ name: 'tool.call.toolview', key: 'diff_note' }, DiffNoteCard)
  )
  ctx.effect(() => installStyles(styles), 'diff-note: card styles')
}
