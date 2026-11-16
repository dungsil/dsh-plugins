import { z } from 'zod'

/** Conservative replay of the Forge worktree lifecycle; it never clears a started or created state. */
export interface SessionGuardState {
  readonly started: boolean
  readonly requested: boolean
  readonly created: boolean
}

type GuardEvent = { readonly type: string; readonly data?: unknown }

export function applySessionGuard(state: SessionGuardState, event: GuardEvent): SessionGuardState {
  if (event.type === 'turn/start' || event.type === 'step/start') return { ...state, started: true }
  if (event.type === 'plugin:worktree/created') return { ...state, created: true }
  if (event.type !== 'plugin:client-ui-forge/worktree') return state
  if (typeof event.data !== 'object' || event.data === null || !('action' in event.data)) {
    return { ...state, created: true }
  }
  switch (event.data.action) {
    case 'request':
      return { ...state, requested: true }
    case 'cancel':
      // Forge accepts only a strict one-field cancel record. An invalid record
      // must never clear a request which Forge still considers active.
      return Object.keys(event.data).length === 1 ? { ...state, requested: false } : { ...state, created: true }
    case 'created':
    case 'restoring':
    case 'restored':
      return { ...state, created: true }
    default:
      // An unknown lifecycle action may have settled the worktree. A later
      // cancel cannot prove it is safe to change directories.
      return { ...state, created: true }
  }
}

export const sessionGuardProjection = {
  key: 'dungsilWorktreePickerGuard',
  stateVersion: 2,
  stateSchema: z.object({ started: z.boolean(), requested: z.boolean(), created: z.boolean() }).strict(),
  init: (): SessionGuardState => ({ started: false, requested: false, created: false }),
  apply: applySessionGuard,
}

export function canEnter(state: SessionGuardState): boolean {
  return !state.started && !state.requested && !state.created
}
