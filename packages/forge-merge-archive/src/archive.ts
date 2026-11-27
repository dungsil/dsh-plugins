import type { BindingOrigin, SessionChangeRequest } from '@deepseek-ai/dsh-experimental-forge-session'
import type { ChangeRequestState, ChangeRequestUpdate } from '@deepseek-ai/dsh-experimental-forge/types'

// Only an open request blocks archiving. A closed request is no longer work in progress.
const SETTLED_STATES: ReadonlySet<ChangeRequestState> = new Set<ChangeRequestState>(['merged', 'closed'])

// `created` and `discovered` are this session's own work. `referenced` comes from a lookup
// command and `tracked` from a manual link, so either can name somebody else's old request.
const OWN_ORIGINS: ReadonlySet<BindingOrigin> = new Set<BindingOrigin>(['created', 'discovered'])

export const stateOf = (entry: SessionChangeRequest): ChangeRequestState | undefined => {
  const update: ChangeRequestUpdate | undefined = entry.update ?? undefined
  if (update === undefined || !('snapshot' in update)) return undefined
  return update.snapshot?.state
}

/** Whether this binding was produced by the session itself and can count as archive evidence. */
export const countsTowardArchive = (entry: SessionChangeRequest): boolean =>
  entry.ref !== null && OWN_ORIGINS.has(entry.origin)

const knownStates = (entries: readonly SessionChangeRequest[]): (ChangeRequestState | undefined)[] =>
  entries.filter(countsTowardArchive).map(stateOf)

/** URLs of this session's merged requests, using the same filter as the decision. */
export const mergedUrls = (entries: readonly SessionChangeRequest[]): readonly string[] =>
  entries.filter((entry) => countsTowardArchive(entry) && stateOf(entry) === 'merged').map((entry) => entry.url)

/**
 * Decide whether the session can be archived now.
 * An unpolled or failed binding, or any still-open request, blocks the decision.
 */
export const archiveReady = (entries: readonly SessionChangeRequest[]): boolean => {
  const states = knownStates(entries)
  if (states.includes(undefined) || !states.includes('merged')) return false
  return states.every((state) => state !== undefined && SETTLED_STATES.has(state))
}
