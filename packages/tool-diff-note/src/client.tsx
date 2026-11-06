import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { Button, DiffBlock } from '@dungsil/dsh-ui'
import { IconRightUpOutlineRegular } from '@dungsil/dsh-ui/icons'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { useMemo } from 'react'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { isDiffNote } from './protocol.js'

export const name = 'dungsil-tool-diff-note'
export const inject = ['slots', 'locale']

const styles = `
.dsh-diff-note { min-width: 0; margin: 8px 0; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-diff-note-bubble { position: relative; box-sizing: border-box; width: fit-content; max-width: calc(100% - 24px); margin: 10px 12px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
.dsh-diff-note-bubble::before { content: ''; position: absolute; top: -6px; left: 12px; width: 12px; height: 6px; background: inherit; clip-path: polygon(0 100%, 50% 0, 100% 100%); }
.dsh-diff-note-open { margin-left: 8px; vertical-align: middle; }
.dsh-diff-note-status { margin: 0; padding: 10px 12px; }
`

export function apply(ctx: Context) {
  function DiffNoteCard(props: ToolCallViewProps) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = (active.startsWith('ko') ? ko : active.startsWith('zh') ? zh : en).ui
    const note =
      props.phase === 'result' && !props.block.isError && isDiffNote(props.block.meta) ? props.block.meta : undefined
    const failed = props.phase === 'result' && !note
    const diffs = useMemo(
      () => (note ? [{ path: note.path, oldText: note.old_text, newText: note.new_text }] : []),
      [note]
    )
    return (
      <section className="dsh-diff-note" aria-label={text.title}>
        {note ? (
          <>
            <DiffBlock
              diffs={diffs}
              labels={{
                ...text,
                expand: (count) => text.expand.replace('{count}', String(count)),
                expandAria: (count) => text.expandAria.replace('{count}', String(count)),
              }}
            />
            {/* DiffBlock owns its rows and folding; keep the annotation outside its private DOM. */}
            <p className="dsh-diff-note-bubble">
              {note.note}
              <Button
                className="dsh-diff-note-open"
                size="sm"
                variant="ghost"
                aria-label={text.open}
                title={text.open}
                onClick={() => props.openFile(note.path)}
              >
                <IconRightUpOutlineRegular />
              </Button>
            </p>
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
