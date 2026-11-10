import type { Context } from '@deepseek-ai/cordis'
import type { ChatFlowSlotProps, ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SlotComponent, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownDelegateProvider, useMarkdownDelegate } from '@dungsil/dsh-ui'
import { useMemo, type ReactNode } from 'react'
import { name, projection } from './protocol.js'

export { name }
export const inject = ['slots']

function ImageScope({ cwd, children }: { cwd?: string; children: ReactNode }) {
  const delegate = useMarkdownDelegate()
  const scoped = useMemo(() => {
    if (!cwd || !delegate.fileImages) return delegate
    const images = delegate.fileImages
    const absolute = (path: string) =>
      /^(?:[/\\]|[a-zA-Z][a-zA-Z\d+.-]*:)/.test(path) ? path : `${cwd.replace(/[/\\]+$/, '')}/${path}`
    return {
      ...delegate,
      fileImages: {
        ...images,
        resolve: (path: string) => images.resolve(absolute(path)),
        resourceAddress: images.resourceAddress ? (path: string) => images.resourceAddress!(absolute(path)) : undefined,
      },
      getTriggerProps: delegate.getTriggerProps
        ? (target: Parameters<NonNullable<typeof delegate.getTriggerProps>>[0]) =>
            delegate.getTriggerProps!(
              target.kind === 'image' && target.path ? { ...target, path: absolute(target.path) } : target
            )
        : undefined,
    }
  }, [cwd, delegate])
  return <MarkdownDelegateProvider {...scoped}>{children}</MarkdownDelegateProvider>
}

export function apply(ctx: Context) {
  const slot = 'conversation.chat.flow'
  ctx.slots.inject(slot, () => {
    const originals = new Map<StoredEntry, { original: unknown; wrapper: unknown }>()
    const refreshOutlet = () => null
    const sync = () => {
      const entries = ctx.slots.entries(slot).filter((entry) => entry.component !== refreshOutlet)
      for (const entry of originals.keys()) {
        if (!entries.includes(entry)) originals.delete(entry)
      }
      for (const entry of entries) {
        if (originals.has(entry)) continue
        const Original = entry.component as SlotComponent<ChatFlowSlotProps>
        function ImagePaths(props: ChatFlowSlotProps) {
          const directories = props.useProjection(projection)
          const renderSlot = useMemo<ChatFlowSlotProps['renderSlot']>(
            () => (childSlot, owner, options) => (
              <ImageScope
                cwd={directories?.findLast((change) => change.seq <= (owner as ChatNodeViewProps).node.anchorSeq)?.cwd}
              >
                {props.renderSlot(childSlot, owner, options)}
              </ImageScope>
            ),
            [directories, props.renderSlot]
          )
          return <Original {...props} renderSlot={renderSlot} />
        }
        // Keep the original entry's child-slot authorization, hooks, store and locale.
        originals.set(entry, { original: entry.component, wrapper: ImagePaths })
        entry.component = ImagePaths
      }
    }
    const unsubscribe = ctx.slots.subscribe(slot, sync)
    // This dormant entry invalidates mounted outlets on enable/disable without owning children.
    const disposeRefresh = ctx.slots.register({ name: slot, priority: Number.MAX_SAFE_INTEGER }, refreshOutlet)
    sync()
    return () => {
      unsubscribe()
      for (const [entry, { original, wrapper }] of originals) {
        if (entry.component === wrapper) entry.component = original
      }
      originals.clear()
      disposeRefresh()
    }
  })
}
