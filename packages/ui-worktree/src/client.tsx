import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { installStyles } from '@dungsil/dsh-ui/client'
import { styles } from './styles.js'
import { installSettingsIcon } from '@dungsil/dsh-ui'
import { worktreeSettingsIconSvg } from '@dungsil/dsh-ui/icons'
import { settingsLabel, WorktreeSettingsSection } from './settings.js'

export const name = 'dungsil-ui-worktree'
export const inject = ['slots', 'locale', 'connection']

// Forge owns the composer, reservations, progress, retry and restoration UI.
export function apply(ctx: Context) {
  ctx.effect(() => installStyles(styles), 'ui-worktree: settings styles')
  ctx.effect(() => installSettingsIcon(name, ['en', 'ko', 'zh'].map(settingsLabel), worktreeSettingsIconSvg))
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: name,
        order: 16,
        label: () => settingsLabel(ctx.locale.getSnapshot().active),
        inject: () => ({ ctx }),
      },
      WorktreeSettingsSection
    )
  )
}
