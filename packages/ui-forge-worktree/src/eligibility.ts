import { pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'
import { z } from 'zod'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    dungsilCheckoutTouched: SessionProjectionSummaryExcluded<boolean>
  }
}

/** Existing Forge events are the source of truth; no new session records are written. */
export const eligibilityProjection = {
  key: 'dungsilCheckoutTouched' as const,
  stateVersion: 1,
  stateSchema: z.boolean(),
  init: () => false,
  apply: (touched: boolean, event: SessionEvent) => {
    if (touched || event.type === 'turn/start' || event.type === 'step/start') return true
    const record = pluginRecordOf(event)
    return record?.type === 'plugin:client-ui-forge/worktree' || record?.type === 'plugin:worktree/created'
  },
  wire: { viewSchema: z.boolean(), view: (touched: boolean) => touched, summary: false as const },
}
