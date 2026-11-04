import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { Button, DiffBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { isDiffNote } from './protocol.js'

export const name = 'dungsil-tool-diff-note'
export const inject = ['slots', 'locale']

const styles = `
.dsh-diff-note { min-width: 0; margin: 8px 0; border: 1px solid var(--dsw-alias-border-l4); border-radius: 12px; overflow: hidden; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); font-size: 13px; }
.dsh-diff-note-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; }
.dsh-diff-note-header h3 { margin: 0; font-size: inherit; font-weight: 600; }
.dsh-diff-note-diff { margin: 0 8px; }
.dsh-diff-note p { margin: 0; padding: 10px 14px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
.dsh-diff-note .dsh-diff-note-bubble { position: relative; box-sizing: border-box; width: fit-content; max-width: calc(100% - 28px); margin: 10px 14px 12px; padding: 8px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.dsh-diff-note-bubble::before { content: ''; position: absolute; top: -6px; left: 12px; width: 12px; height: 6px; background: inherit; clip-path: polygon(0 100%, 50% 0, 100% 100%); }
.dsh-diff-note .dsh-diff-note-snapshot { padding-top: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
`

export function apply(ctx: Context) {
  function DiffNoteCard(props: ToolCallViewProps) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = (active.startsWith('ko') ? ko : active.startsWith('zh') ? zh : en).ui
    const note =
      props.phase === 'result' && !props.block.isError && isDiffNote(props.block.meta) ? props.block.meta : undefined
    const failed = props.phase === 'result' && !note
    const labels = {
      ...text,
      expand: (hidden: number) => text.expand.replace('{count}', String(hidden)),
      expandAria: (hidden: number) => text.expandAria.replace('{count}', String(hidden)),
    }
    return (
      <section className="dsh-diff-note" aria-label={text.title}>
        <header className="dsh-diff-note-header">
          <h3>{text.title}</h3>
          {note && (
            <Button size="sm" variant="ghost" onClick={() => props.openFile(note.path)}>
              {text.open}
            </Button>
          )}
        </header>
        {note ? (
          <>
            <DiffBlock
              className="dsh-diff-note-diff"
              diffs={[{ path: note.path, oldText: note.old_text, newText: note.new_text }]}
              labels={labels}
              maxLines={8}
            />
            <p className="dsh-diff-note-bubble">{note.note}</p>
            <p className="dsh-diff-note-snapshot">{text.snapshot}</p>
          </>
        ) : (
          <p role="status">{failed ? text.failed : text.waiting}</p>
        )}
      </section>
    )
  }

  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({ name: 'tool.call.toolview', key: 'diff_note' }, DiffNoteCard)
  )
  ctx.effect(() => installStyles(styles), 'diff-note: card styles')
}
