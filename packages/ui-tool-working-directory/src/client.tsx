import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { installStyles, localizedCopy, useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { translations, type CopyKey } from './copy.js'
import { styles } from './styles.js'
import { DirectoryView } from './view.js'

export const inject = ['slots', 'locale']

/** Replaces only the keyed working_directory presentation; the official tool still executes. */
export function apply(ctx: Context) {
  function WorkingDirectoryCard(props: ToolCallViewProps) {
    const { active } = useLocaleSnapshot(ctx.locale)
    const copy = localizedCopy(translations, active).ui
    const t = (key: CopyKey) => copy[key]
    return <DirectoryView {...props} t={t} />
  }

  ctx.slots.inject('tool.call.toolview', () =>
    ctx.slots.register({ name: 'tool.call.toolview', key: 'working_directory' }, WorkingDirectoryCard)
  )
  ctx.effect(() => installStyles(styles), 'working-directory: tool card styles')
}
