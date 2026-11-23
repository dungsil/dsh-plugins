import { pluginRecordOf } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'

/**
 * A merged request stays in the session log forever. Recording which URLs were used for an
 * archive stops a later unarchive-and-resume from archiving the same session again on the next
 * poll. A new merge adds a URL, which re-arms the row.
 */
export const ARCHIVED_RECORD = 'plugin:forge-merge-archive/archived'

export interface MergeArchiveState {
  readonly archived: string[]
}

const recordSchema = z.object({ urls: z.array(z.string()) })

export const mergeArchiveProjection = {
  apply: (state, event) => {
    const record = pluginRecordOf(event)
    if (record?.type !== ARCHIVED_RECORD) return state
    const parsed = recordSchema.safeParse(record.data)
    if (!parsed.success) return state
    const added = parsed.data.urls.filter((url) => !state.archived.includes(url))
    return added.length === 0 ? state : { archived: [...state.archived, ...added] }
  },
  init: (): MergeArchiveState => ({ archived: [] }),
  key: 'forgeMergeArchive',
  stateSchema: z.object({ archived: z.array(z.string()) }),
  stateVersion: 1,
} satisfies ProjectionDefinition<'forgeMergeArchive', MergeArchiveState>

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:forge-merge-archive/archived': { readonly urls: readonly string[] }
  }
}
