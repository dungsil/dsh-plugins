import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

export interface NotificationState {
  readonly delivered: string[]
}

export const projection = {
  apply: (state, event) => {
    if (event.type !== 'agent/inbox/spliced') {
      return state
    }
    const keys = event.data.inserted.flatMap(({ source }) =>
      source.kind === 'forge-ci-notification' ? [source.dedupKey] : []
    )
    const added = keys.filter((key) => !state.delivered.includes(key))
    // 소비·취소 뒤에도 수락된 알림은 남아 있어야 재시작 때 다시 깨우지 않는다.
    return added.length === 0 ? state : { delivered: [...new Set([...state.delivered, ...added])] }
  },
  init: (): NotificationState => ({ delivered: [] }),
  key: 'forgeCiNotifications',
  stateSchema: z.object({ delivered: z.array(z.string()) }),
  stateVersion: 1,
} satisfies ProjectionDefinition<'forgeCiNotifications', NotificationState>
