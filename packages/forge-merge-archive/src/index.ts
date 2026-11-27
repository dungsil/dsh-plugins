/**
 * Archive a session when every change request it produced has been merged.
 *
 * `forgeSession` already polls the bindings attached to each session. This row rides on that
 * watcher: it checks whether the bindings settled through a merge and, if so, archives the
 * session through the public workspace registry. The switch is off by default and is read at
 * evaluation time, so installing the plugin never archives anything until the user opts in.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionChangeRequest } from '@deepseek-ai/dsh-experimental-forge-session'
import { appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'

import { archiveReady, mergedUrls } from './archive.js'
import { ARCHIVED_RECORD, mergeArchiveProjection } from './projection.js'

export const name = 'dungsil-forge-merge-archive'

export const Config = z.object({
  archiveOnMerge: z.boolean().default(false),
})

export interface Config {
  readonly archiveOnMerge?: boolean
}

export const inject = ['agents', 'forgeSession', 'sessionProjections', 'workspaceRegistry'] as const

/** Delay before retrying a deferred archive, and the cap for one merge observation. */
export const RETRY_DELAY_MS = 5000
export const MAX_RETRIES = 3

interface Watch {
  active: boolean
  queued: boolean
  unwatch: (() => void) | null
  readonly lifetime: AbortController
  archiving: boolean
  attempts: number
  retryTimer: ReturnType<typeof setTimeout> | null
}

export const apply = async (ctx: Context, config: Config = {}): Promise<void> => {
  if (config.archiveOnMerge !== true) return

  let active = true
  const watches = new Map<Agent, Watch>()
  const warn = (error: unknown): void => {
    ctx.logger.warn(`PR merge archive failed: ${String(error)}`)
  }
  const stop = (agent: Agent): void => {
    const watch = watches.get(agent)
    if (watch === undefined) return
    watch.active = false
    watch.lifetime.abort()
    if (watch.retryTimer !== null) {
      clearTimeout(watch.retryTimer)
      watch.retryTimer = null
    }
    watches.delete(agent)
    try {
      watch.unwatch?.()
    } catch (error) {
      warn(error)
    }
  }
  ctx.effect(() => () => {
    active = false
    for (const agent of watches.keys()) stop(agent)
  })

  const handle = await ctx.sessionProjections.register(mergeArchiveProjection)
  if (!active || ctx.fiber.uid === null) return
  const workspace: WorkspaceRegistry = ctx.workspaceRegistry

  const registered = (agent: Agent): boolean => agent.ctx.fiber.uid !== null && ctx.agents.get(agent.id) === agent
  const live = (agent: Agent, watch: Watch): boolean => {
    if (!active || ctx.fiber.uid === null || !watch.active || watch.lifetime.signal.aborted) return false
    return registered(agent)
  }

  const read = (agent: Agent): readonly SessionChangeRequest[] | undefined => {
    try {
      return ctx.forgeSession.changeRequests(agent.session)
    } catch (error) {
      warn(error)
      return undefined
    }
  }

  /** Whether this merge set was already archived, including after a manual unarchive. */
  const archivedFor = (agent: Agent, urls: readonly string[]): boolean => {
    const { archived } = handle.stateOf(agent.session)
    return urls.every((url) => archived.includes(url))
  }

  /** Evidence for archiving now, or undefined when there is no reason to archive. */
  const pendingMerge = (agent: Agent): readonly string[] | undefined => {
    const entries = read(agent)
    if (entries === undefined || !archiveReady(entries)) return undefined
    const urls = mergedUrls(entries)
    if (workspace.archivedSessionIds.includes(agent.session.id) || archivedFor(agent, urls)) return undefined
    return urls
  }

  /** Retry a deferred archive without joining the shared polling path. */
  const scheduleRetry = (agent: Agent, watch: Watch): void => {
    if (!live(agent, watch) || watch.retryTimer !== null || watch.attempts >= MAX_RETRIES) return
    watch.attempts += 1
    watch.retryTimer = setTimeout(() => {
      watch.retryTimer = null
      try {
        evaluate(agent, watch)
      } catch (error) {
        warn(error)
      }
    }, RETRY_DELAY_MS)
  }

  const archive = async (agent: Agent, watch: Watch): Promise<void> => {
    // The public status stays `idle` while maintenance runs; whenIdle also waits for queued input.
    await agent.whenIdle()
    if (!live(agent, watch)) return
    // A turn that started while waiting must not be interrupted.
    if (agent.status !== 'idle') {
      scheduleRetry(agent, watch)
      return
    }
    const urls = pendingMerge(agent)
    if (urls === undefined) {
      watch.attempts = 0
      return
    }
    // Never call stopActivity: a busy session defers the archive instead of losing work.
    await workspace.archiveSession(agent.session.id)
    watch.attempts = 0
    try {
      appendPluginRecord(agent.session, ARCHIVED_RECORD, { urls })
    } catch (error) {
      warn(error)
    }
  }

  const runArchive = async (agent: Agent, watch: Watch): Promise<void> => {
    try {
      await archive(agent, watch)
    } catch (error) {
      warn(error)
      scheduleRetry(agent, watch)
    } finally {
      watch.archiving = false
    }
  }

  const evaluate = (agent: Agent, watch: Watch): void => {
    if (!live(agent, watch)) {
      stop(agent)
      return
    }
    if (watch.archiving) return
    if (pendingMerge(agent) === undefined) {
      watch.attempts = 0
      return
    }
    watch.archiving = true
    void runArchive(agent, watch)
  }

  const attach = (agent: Agent, signal?: AbortSignal): void => {
    if (!active || ctx.fiber.uid === null || watches.has(agent)) return
    if (!registered(agent) || signal?.aborted === true) return
    const lifetime = new AbortController()
    const watch: Watch = {
      active: true,
      archiving: false,
      attempts: 0,
      lifetime,
      queued: false,
      retryTimer: null,
      unwatch: null,
    }
    watches.set(agent, watch)
    const schedule = (): void => {
      if (!watch.active || watch.queued) return
      watch.queued = true
      // Avoid synchronous re-entry from the watcher callback; archiving touches session and workspace.
      queueMicrotask(() => {
        watch.queued = false
        try {
          evaluate(agent, watch)
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
