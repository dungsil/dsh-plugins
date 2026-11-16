import type { ScheduleSnapshot, WakeTask } from './schedule-link.ts'
import type { SnoozeState } from './snooze-state.ts'
import { untilVerdict } from './snooze.ts'
import type { SnoozeVerdict } from './snooze.ts'

/** How long to wait after a request for the agent turn to start. Without a turn by then, it counts as over. */
export const AGENT_START_GRACE_MS = 60_000
/** How long to wait after a turn ends for the automation list refresh to arrive. */
export const AGENT_SETTLE_MS = 5000

/** The request sent to the agent. A model-facing instruction, so it stays in English. */
export const AGENT_PROMPT = [
  '[Sidebar snooze] I snoozed this conversation in the sidebar. Decide when it should come back to my attention.',
  'Choose the time from the state of the work in this conversation, for example when a running job should be finished or a follow-up is due.',
  'Create exactly one one-time scheduled task that is delivered to this session at that time (schedule_create with target this_session). Its prompt must say what to check or continue then.',
  'Do not start other work now. Reply with one short sentence in the language of this conversation that states the chosen time.',
].join('\n')

export interface AgentWakeOptions {
  readonly schedule: () => ScheduleSnapshot
  /** Whether an agent turn is running in the session. */
  readonly busy: (sessionId: string) => boolean
}

export interface AgentWake {
  /** Judges agent entries. Inject it into the snooze state as is. */
  readonly judge: (sessionId: string, requestedAt: number, now: number) => SnoozeVerdict
  /** Whether an active automation task already delivers to this session. If so, the agent is not asked. */
  readonly hasPlan: (sessionId: string) => boolean
}

export interface AgentChoiceOptions {
  readonly state: Pick<SnoozeState, 'getSnapshot' | 'snoozeAgent' | 'wake'>
  readonly hasPlan: (sessionId: string) => boolean
  /** Send a message to the agent. False when the host refuses it. */
  readonly request: (sessionId: string, text: string) => Promise<boolean>
}

/**
 * Menu action for the agent choice. If a task already delivers to this session, its time
 * is followed; otherwise the agent is asked to decide. A refused request undoes the snooze,
 * unless the user picked another duration for the entry in the meantime.
 */
export function createAgentChoice({ hasPlan, request, state }: AgentChoiceOptions) {
  return async (sessionId: string): Promise<void> => {
    state.snoozeAgent(sessionId)
    if (hasPlan(sessionId)) return
    const entry = state.getSnapshot().get(sessionId)
    const accepted = await request(sessionId, AGENT_PROMPT)
    if (!accepted) {
      if (state.getSnapshot().get(sessionId) === entry) state.wake(sessionId)
      throw new Error('Agent snooze request was not accepted')
    }
  }
}

/** Earliest run time among the active tasks delivered to this session. */
export function nextWake(tasks: readonly WakeTask[], sessionId: string): number | undefined {
  let earliest: number | undefined
  for (const task of tasks) {
    if (task.sessionId === sessionId && task.active) {
      earliest = earliest === undefined ? task.scheduledAt : Math.min(earliest, task.scheduledAt)
    }
  }
  return earliest
}

/**
 * Decides when an agent snooze ends. The wake time is the next run of an automation
 * task delivered to the session, and one delivery after the request wakes it at once;
 * a recurring task moves to its next time after delivery, so ignoring delivery records
 * would hide the row again. With no task, it waits for the agent turn to end and then
 * wakes, so a row the agent never scheduled is not lost.
 */
export function createAgentWake({ busy, schedule }: AgentWakeOptions): AgentWake {
  /**
   * Sessions whose turn was seen running after the request. `idleAt` is when the turn was first
   * seen ended, or null while running. Keyed with the request time so a request made after
   * showing the row again does not read the earlier turn.
   */
  const turns = new Map<string, { readonly requestedAt: number; readonly idleAt: number | null }>()

  const wake = (sessionId: string): SnoozeVerdict => {
    turns.delete(sessionId)
    return { wake: true }
  }

  return {
    hasPlan: (sessionId) => {
      const { settled, tasks } = schedule()
      return settled && nextWake(tasks, sessionId) !== undefined
    },
    judge: (sessionId, requestedAt, now) => {
      const { settled, tasks } = schedule()
      // Before the list is read, "no task" cannot be asserted, so hold.
      if (!settled) return { wake: false }
      const delivered = tasks.some(
        (task) => task.sessionId === sessionId && task.deliveredAt !== undefined && task.deliveredAt >= requestedAt
      )
      if (delivered) return wake(sessionId)
      const next = nextWake(tasks, sessionId)
      if (next !== undefined) {
        const verdict = untilVerdict(next, now)
        return verdict.wake ? wake(sessionId) : verdict
      }
      if (busy(sessionId)) {
        turns.set(sessionId, { idleAt: null, requestedAt })
        return { wake: false }
      }
      const turn = turns.get(sessionId)
      const idleAt = turn?.requestedAt === requestedAt ? turn.idleAt : undefined
      if (idleAt === null) {
        turns.set(sessionId, { idleAt: now, requestedAt })
        return { recheckAt: now + AGENT_SETTLE_MS, wake: false }
      }
      const deadline = idleAt === undefined ? requestedAt + AGENT_START_GRACE_MS : idleAt + AGENT_SETTLE_MS
      return now >= deadline ? wake(sessionId) : { recheckAt: deadline, wake: false }
    },
  }
}
