import { useEffect } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { ModelDirectory, ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

const STORAGE_KEY = '@dungsil/dsh-ui-model-picker/last-selection/v1'

type Directory = Pick<ModelDirectory, 'store' | 'select'>
interface SelectionMemory {
  read(): ModelSelection | undefined
  write(selection: ModelSelection): void
}

const same = (left: ModelSelection | null | undefined, right: ModelSelection | null | undefined) =>
  left?.provider === right?.provider && left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort

function selection(value: unknown): ModelSelection | undefined {
  if (typeof value !== 'object' || value === null) return
  const { provider, model, reasoningEffort } = value as Record<string, unknown>
  if (typeof provider !== 'string' || !provider || typeof model !== 'string' || !model) return
  if (reasoningEffort !== undefined && typeof reasoningEffort !== 'string') return
  return { provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
}

export function selectionMemory(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined): SelectionMemory {
  let local: ModelSelection | undefined
  let volatile = storage === undefined
  return {
    read() {
      if (volatile) return local
      let raw: string | null | undefined
      try {
        raw = storage?.getItem(STORAGE_KEY)
      } catch {
        return local
      }
      // Removing or corrupting the key in another tab clears durable memory too.
      if (raw === null || raw === undefined) return undefined
      try {
        return selection(JSON.parse(raw))
      } catch {
        return undefined
      }
    },
    write(value) {
      local = { ...value }
      try {
        const raw = JSON.stringify(local)
        if (storage?.getItem(STORAGE_KEY) !== raw) storage?.setItem(STORAGE_KEY, raw)
      } catch {
        // A denied or full store still permits carry-over within this page.
        volatile = true
      }
    },
  }
}

function usable(value: ModelSelection | undefined, groups: ModelDirectoryState['groups']): ModelSelection | undefined {
  if (!value) return
  const model = groups.find((group) => group.id === value.provider)?.models.find((entry) => entry.id === value.model)
  if (!model) return
  if (
    value.reasoningEffort === undefined ||
    model.reasoning?.efforts.some((effort) => effort.id === value.reasoningEffort)
  )
    return value
  return { provider: value.provider, model: value.model }
}

const decisions = new WeakMap<Directory, { visited: boolean; awaitingProjection?: ModelSelection | null }>()

export function attachRetention(
  directory: Directory,
  isBlank: () => boolean | undefined,
  memory: SelectionMemory,
  subscribeBlank?: (listener: () => void) => () => void
) {
  let phase: 'deciding' | 'applying' | 'tracking' = 'deciding'
  let disposed = false
  const decision = decisions.get(directory) ?? { visited: false }
  decisions.set(directory, decision)
  let lastObserved: ModelSelection | undefined

  const sync = () => {
    const state = directory.store.getSnapshot()
    if (disposed || phase === 'applying' || state.status !== 'ready' || state.pending !== null || !state.current) return
    if (phase === 'deciding') {
      const blank = decision.visited ? false : isBlank()
      if (blank === undefined) return
      const remembered = blank ? memory.read() : undefined
      // A failed provider is not a removed model. Wait for its catalog before
      // replacing the browser's last choice with this session's default.
      if (remembered && state.failures.some((failure) => failure.id === remembered.provider)) return
      decision.visited = true
      phase = 'tracking'
      const target = blank ? usable(remembered, state.groups) : undefined
      if (target && !same(target, state.current)) {
        phase = 'applying'
        // Preserve the previous-choice guard across failure and remount, not
        // just successful RPC settlement. Only a real selection change can
        // replace the remembered model after an automatic carry-over attempt.
        decision.awaitingProjection = state.current
        void directory.select(target).then(
          () => {
            if (disposed) return
            phase = 'tracking'
            sync()
          },
          () => {
            if (disposed) return
            phase = 'tracking'
            sync()
          }
        )
        return
      }
    }
    if (decision.awaitingProjection !== undefined && same(decision.awaitingProjection, state.current)) return
    decision.awaitingProjection = undefined
    if (state.routable === true && !same(lastObserved, state.current)) {
      lastObserved = { ...state.current }
      memory.write(state.current)
    }
  }
  const unsubscribe = directory.store.subscribe(sync)
  const unsubscribeBlank = subscribeBlank?.(sync)
  sync()
  return () => {
    disposed = true
    unsubscribe()
    unsubscribeBlank?.()
  }
}

export function confirmedBlank(blank: boolean, metadata: unknown, selected: unknown): boolean | undefined {
  if (!blank || (typeof selected === 'object' && selected !== null && 'next' in selected && selected.next != null))
    return false
  if (typeof metadata === 'object' && metadata !== null && 'blank' in metadata && typeof metadata.blank === 'boolean')
    return metadata.blank
  return undefined
}

export function registerRetention(ctx: Context) {
  let storage: Storage | undefined
  try {
    storage = window.localStorage
  } catch {
    // Private browsing can deny even reading the storage property.
  }
  const memory = selectionMemory(storage)
  const Retention = ({ sessionId }: { sessionId: Parameters<typeof ctx.sessions.binding>[0] }) => {
    useEffect(() => {
      if (ctx.sessions.subagentAddress(sessionId) !== undefined) return
      const binding = ctx.sessions.binding(sessionId)
      if (!binding) return
      const metadata = binding.session.projections.faceOf('sessionListMetadata')
      const selected = binding.session.projections.faceOf('modelSelection')
      return attachRetention(
        ctx.modelDirectories.directoryFor(sessionId),
        () => {
          // Session.blank starts optimistically true before history arrives.
          // Only Host metadata may authorize a carry-over, and a durable explicit
          // selection always wins even if the conversation still has no message.
          return confirmedBlank(binding.session.getSnapshot().blank, metadata.getSnapshot(), selected.getSnapshot())
        },
        memory,
        (listener) => {
          const unsubscribeMetadata = metadata.subscribe(listener)
          const unsubscribeSelection = selected.subscribe(listener)
          return () => {
            unsubscribeMetadata()
            unsubscribeSelection()
          }
        }
      )
    }, [sessionId])
    return null
  }
  ctx.slots.inject('conversation.input.overlay', () =>
    ctx.slots.register({ id: 'dungsil-model-retention', name: 'conversation.input.overlay', order: -100 }, Retention)
  )
}
