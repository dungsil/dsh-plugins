import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { AnnotatedDiffBlock, annotatedDiffStyles } from '@dungsil/dsh-ui'
import { installStyles, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import en from '../locale/en.json' with { type: 'json' }
import ko from '../locale/ko.json' with { type: 'json' }
import zh from '../locale/zh.json' with { type: 'json' }
import { isDiffNote } from './protocol.js'

export const name = 'dungsil-tool-diff-note'
export const inject = ['slots', 'locale']

const styles = `${annotatedDiffStyles}
.dsh-diff-note { min-width: 0; margin: 8px 0; color: var(--dsw-alias-label-primary); }
.dsh-diff-note-status { margin: 0; }
`

export function apply(ctx: Context) {
  function DiffNoteCard(props: ToolCallViewProps) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const text = (active.startsWith('ko') ? ko : active.startsWith('zh') ? zh : en).ui
    const note =
      props.phase === 'result' && !props.block.isError && isDiffNote(props.block.meta) ? props.block.meta : undefined
    const failed = props.phase === 'result' && !note
    return (
      <section className="dsh-diff-note" aria-label={text.title}>
        {note ? (
          <AnnotatedDiffBlock
            diffs={[{ path: note.path, oldText: note.old_text, newText: note.new_text }]}
            maxLines={6}
            annotation={note.note}
            annotationLabel={text.annotationLabel}
            labels={{
              ...text,
              expand: (hidden) => text.expand.replace('{count}', String(hidden)),
              expandAria: (hidden) => text.expandAria.replace('{count}', String(hidden)),
            }}
          />
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
