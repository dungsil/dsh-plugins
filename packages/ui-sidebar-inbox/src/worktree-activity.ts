import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session-status/client'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Only a directly submitted human message can begin first-turn worktree creation. */
export const hasPendingHumanInput = (inbox: unknown): boolean => {
  if (!isRecord(inbox)) return false
  return ['next-turn', 'next-step'].some((target) => {
    const messages = inbox[target]
    return (
      Array.isArray(messages) &&
      messages.some((message: unknown) => {
        if (
          !isRecord(message) ||
          message.role !== 'user' ||
          !isRecord(message.source) ||
          message.source.kind !== 'user' ||
          !Array.isArray(message.content)
        )
          return false
        return message.content.some(
          (block: unknown) =>
            isRecord(block) &&
            (block.type === 'image' ||
              block.type === 'file' ||
              (block.type === 'text' &&
                typeof block.text === 'string' &&
                block.text.replaceAll(/[\p{Cc}\p{Cf}\s]/gu, '').length > 0))
        )
      })
    )
  })
}

/** 생성은 목록 투영에 없으므로 첫 턴 이전의 대기 입력이 있는 동안만 패널을 읽는다. */
export interface WorktreePanelStream extends AsyncIterable<{
  readonly worktree: {
    readonly creation: {
      readonly phase: 'name' | 'prepare' | 'checkout'
      readonly branch: string | null
      readonly from: string | null
      readonly held: boolean
    } | null
  }
}> {
  readonly dispose: () => void
}

interface WorktreeContext {
  readonly remote: {
    readonly forgePanel: { readonly follow: (id: string, signal: AbortSignal) => WorktreePanelStream }
  }
  readonly on: (event: 'connection/reset', listener: () => void) => () => void
}
interface Watch {
  readonly controller: AbortController
  stream: WorktreePanelStream | null
}

export const WORKTREE_INJECT = ['remote', 'remote.forgePanel']

/** 세션을 보유하지 않고 실제 생성 중인 행만 추적한다. 종료된 구독은 연결 재설정 때만 재개한다. */
export const createWorktreeActivity = (changed: () => void) => {
  const active = new Set<string>()
  const watches = new Map<string, Watch>()
  let follow: WorktreeContext['remote']['forgePanel']['follow'] | null = null
  let candidates = new Set<string>()
  let disposed = false

  const publish = (id: string, running: boolean) => {
    if (active.has(id) === running) {
      return
    }
    if (running) {
      active.add(id)
    } else {
      active.delete(id)
    }
    changed()
  }

  const release = (watch: Watch) => {
    const { stream } = watch
    watch.stream = null
    try {
      stream?.dispose()
    } catch {
      // 스트림 정리 실패가 나머지 구독의 해제를 막으면 안 된다.
    }
  }

  const observe = async (id: string, watch: Watch) => {
    try {
      const stream = follow?.(id, watch.controller.signal)
      if (stream === undefined) {
        return
      }
      watch.stream = stream
      for await (const panel of stream) {
        if (watch.controller.signal.aborted || watches.get(id) !== watch) {
          break
        }
        publish(id, panel.worktree.creation !== null)
      }
    } catch {
      // 표시용 읽기 실패는 실행 상태를 추측하지 않고 다음 연결을 기다린다.
    } finally {
      release(watch)
      if (watches.get(id) === watch) {
        publish(id, false)
      }
    }
  }

  const stop = (id: string): boolean => {
    const watch = watches.get(id)
    watches.delete(id)
    watch?.controller.abort()
    if (watch !== undefined) {
      release(watch)
    }
    return active.delete(id)
  }

  const sync = (): boolean => {
    let cleared = false
    for (const id of watches.keys()) {
      if (!candidates.has(id) || follow === null) {
        cleared = stop(id) || cleared
      }
    }
    if (follow !== null) {
      for (const id of candidates) {
        if (!watches.has(id)) {
          const watch: Watch = { controller: new AbortController(), stream: null }
          watches.set(id, watch)
          void observe(id, watch)
        }
      }
    }
    return cleared
  }

  const reset = () => {
    let cleared = false
    for (const id of watches.keys()) {
      cleared = stop(id) || cleared
    }
    sync()
    if (cleared) {
      changed()
    }
  }

  return {
    active,
    attach: (child: object): (() => void) => {
      if (disposed) {
        return () => {
          // 이미 해제된 마운트에는 정리할 구독이 없다.
        }
      }
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- WORKTREE_INJECT가 제공한 하위 컨텍스트다.
      const scoped = child as WorktreeContext
      follow = (id, signal) => scoped.remote.forgePanel.follow(id, signal)
      const unsubscribe = scoped.on('connection/reset', reset)
      sync()
      return () => {
        follow = null
        unsubscribe()
        if (sync()) {
          changed()
        }
      }
    },
    dispose: () => {
      disposed = true
      candidates.clear()
      follow = null
      sync()
    },
    reconcile: (list: SessionListState, statuses: SessionStatusSnapshot) => {
      if (disposed) {
        return
      }
      candidates = new Set(
        list.ids.filter((id) => {
          const row = list.byId[id]
          if (
            row === undefined ||
            row.blank ||
            row.origin === 'subagent' ||
            (statuses.get(id)?.running ?? row.running)
          ) {
            return false
          }
          const values = list.projectionsBySession[id]?.values ?? {}
          const projections: Readonly<Record<string, unknown>> = values
          if (isRecord(projections.forgeWorktree) || values.sessionListMetadata?.blank === false) {
            return false
          }
          return hasPendingHumanInput(projections.inbox)
        })
      )
      sync()
    },
  }
}
