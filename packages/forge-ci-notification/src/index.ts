import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { changeRequestKey } from '@deepseek-ai/dsh-experimental-forge'
import type { SessionChangeRequest } from '@deepseek-ai/dsh-experimental-forge-session'

import { failureNotice } from './notice.js'
import { projection } from './projection.js'

export const name = 'dungsil-forge-ci-notification'

export const Config = z.object({
  mode: z.union(['off', 'next-turn', 'wake']).default('off'),
})
export type DeliveryMode = 'off' | 'next-turn' | 'wake'
export interface Config {
  readonly mode?: DeliveryMode
}

export const inject = ['agents', 'forgeSession', 'sessionProjections'] as const

interface Watch {
  active: boolean
  queued: boolean
  unwatch: (() => void) | null
  readonly signal?: AbortSignal
  readonly sending: Set<string>
}

export const apply = async (ctx: Context, config: Config = {}): Promise<void> => {
  // Installed plugins do not silently wake or modify running agents.
  if (config.mode !== 'next-turn' && config.mode !== 'wake') return
  let active = true
  const watches = new Map<Agent, Watch>()
  const warn = (error: unknown): void => {
    ctx.logger.warn(`PR CI notification failed: ${String(error)}`)
  }
  const stop = (agent: Agent): void => {
    const watch = watches.get(agent)
    if (watch === undefined) {
      return
    }
    watch.active = false
    watches.delete(agent)
    try {
      watch.unwatch?.()
    } catch (error) {
      warn(error)
    }
  }
  ctx.effect(() => () => {
    active = false
    for (const agent of watches.keys()) {
      stop(agent)
    }
  })
  const handle = await ctx.sessionProjections.register(projection)
  if (!active || ctx.fiber.uid === null) {
    return
  }

  const registered = (agent: Agent): boolean => agent.ctx.fiber.uid !== null && ctx.agents.get(agent.id) === agent
  const live = (agent: Agent, watch: Watch): boolean => {
    if (!active || ctx.fiber.uid === null || !watch.active || watch.signal?.aborted === true) {
      return false
    }
    return registered(agent)
  }

  const deliverEntry = (agent: Agent, watch: Watch, entry: SessionChangeRequest): void => {
    if (!live(agent, watch)) {
      stop(agent)
      return
    }
    if (entry.ref === null || entry.update === null || !('snapshot' in entry.update)) {
      return
    }
    const { snapshot } = entry.update
    const key = changeRequestKey(entry.ref)
    if (entry.update.key !== key || changeRequestKey(snapshot.ref) !== key) {
      return
    }
    if (snapshot.state !== 'open' || snapshot.checksRollup !== 'failure' || snapshot.headSha.trim().length === 0) {
      return
    }
    const dedupKey = JSON.stringify([key, snapshot.headSha])
    if (watch.sending.has(dedupKey) || handle.stateOf(agent.session).delivered.includes(dedupKey)) {
      return
    }
    const notice = failureNotice(snapshot, dedupKey)
    // send는 종료 여부를 검사하지 않으므로 로그 쓰기 직전에 동일한 Agent인지 재확인한다.
    if (!live(agent, watch)) {
      stop(agent)
      return
    }
    watch.sending.add(dedupKey)
    try {
      agent.send(notice, 'next-turn', config.mode === 'wake')
    } catch (error) {
      // 수락 뒤 wake가 실패해도 로그 투영이 중복을 막는다. 미수락은 다음 polling에서 재시도한다.
      warn(error)
    } finally {
      watch.sending.delete(dedupKey)
    }
  }
  const deliver = (agent: Agent, watch: Watch): void => {
    if (!live(agent, watch)) {
      stop(agent)
      return
    }
    for (const entry of ctx.forgeSession.changeRequests(agent.session)) {
      deliverEntry(agent, watch, entry)
    }
  }
  const attach = (agent: Agent, signal?: AbortSignal): void => {
    if (!active || ctx.fiber.uid === null || watches.has(agent)) {
      return
    }
    if (!registered(agent) || signal?.aborted === true) {
      return
    }
    const watch: Watch = {
      active: true,
      queued: false,
      sending: new Set(),
      unwatch: null,
      ...(signal === undefined ? {} : { signal }),
    }
    watches.set(agent, watch)
    const schedule = (): void => {
      if (!watch.active || watch.queued) {
        return
      }
      watch.queued = true
      // watch의 동기 콜백 재진입을 피한다. 생성 중 wake는 Agent의 maintenance 장벽이 보류한다.
      queueMicrotask(() => {
        watch.queued = false
        try {
          deliver(agent, watch)
        } catch (error) {
          warn(error)
        }
      })
    }
    try {
      const unwatch = ctx.forgeSession.watch(agent.session, schedule)
      watch.unwatch = unwatch
      if (!watch.active || !active) {
        unwatch()
        return
      }
      schedule()
    } catch (error) {
      stop(agent)
      warn(error)
    }
  }
  ctx.on('agent/created', ({ agent, signal }) => {
    attach(agent, signal)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    stop(agent)
  })
  for (const agent of ctx.agents.list()) {
    attach(agent)
  }
}
