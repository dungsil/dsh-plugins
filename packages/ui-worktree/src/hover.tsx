import { useEffect, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import { channel, currentWorktree, endpointPrefix, isWorktreeView, type WorktreeView } from './protocol.js'
import { copy } from './requests.js'

/** The native card owns visibility; reads neither activate a Session nor initialize its selection. */
export function installWorktreeHover(ctx: Context, connection: ConnectionHandle) {
  function WorktreeHover({ sessionId }: PropsRuntime<'sidebar.session.row.hover'>) {
    const { active: language } = useLocaleSnapshot(ctx.locale)
    const text = copy[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
    const [view, setView] = useState<WorktreeView>()
    useEffect(() => {
      const controller = new AbortController()
      setView(undefined)
      void (async () => {
        try {
          const result = await connection.rpc.call(
            channel,
            endpointPrefix + 'describe',
            { sessionId },
            controller.signal
          )
          if (!controller.signal.aborted && result.ok && isWorktreeView(result.value)) setView(result.value)
        } catch {
          // Optional metadata must not replace or disrupt the native card on read failures.
        }
      })()
      return () => controller.abort()
    }, [sessionId])
    const current = currentWorktree(view)
    if (!current) return null
    return (
      <div className="dsh-worktree-hover">
        <div>
          {text.currentWorktree}: {current.branch ?? text.detached}
        </div>
        <div>{current.path}</div>
      </div>
    )
  }
  ctx.slots.inject('sidebar.session.row.hover', () =>
    ctx.slots.register({ name: 'sidebar.session.row.hover', id: 'dungsil-ui-worktree' }, (props) => (
      <WorktreeHover key={props.sessionId} {...props} />
    ))
  )
}
