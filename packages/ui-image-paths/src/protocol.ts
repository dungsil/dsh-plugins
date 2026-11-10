import type { SessionProjectionSummaryExcluded } from '@deepseek-ai/dsh-session-projection/types'

export const name = 'dungsil-ui-image-paths'
export const projection = 'dungsil.imageDirectories'

export interface DirectoryChange {
  seq: number
  cwd: string
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    [projection]: SessionProjectionSummaryExcluded<DirectoryChange[]>
  }
}
