import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { installStyles, localizedCopy } from '@dungsil/dsh-ui/client'
import { createMcpSource, type McpRemote } from './controller.js'
import type { ConfigForm } from './runtime.js'
import { translations } from './locale.js'
import { McpSettings } from './view.js'
import { styles } from './styles.js'

export const inject = ['remote']
type ConfigForms = {
  get(id: string): ConfigForm
  whileServed(ids: readonly string[], register: () => () => void): () => void
}
type McpClientContext = Context & {
  configForms: ConfigForms
  remote: { mcpManager: McpRemote }
}
export function apply(ctx: Context) {
  ctx.inject(['locale', 'slots', 'configForms', 'remote.mcpManager'], (child) => {
    const runtime = child as unknown as McpClientContext
    const source = createMcpSource(runtime.configForms.get('mcp-manager'), runtime.remote.mcpManager)
    const copy = () => localizedCopy(translations, child.locale.getSnapshot().active)
    child.effect(() => installStyles(styles), 'ui-setting-mcp: settings style')
    return runtime.configForms.whileServed(['mcp-manager'], () =>
      child.slots.inject('settings.section', () =>
        child.slots.register(
          {
            name: 'settings.section',
            id: 'dungsil-ui-setting-mcp',
            order: 22,
            label: () => copy().meta.title,
            inject: () => ({ ctx: child, source }),
          },
          McpSettings
        )
      )
    )
  })
}
