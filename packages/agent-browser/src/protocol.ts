export const name = 'dungsil-agent-browser'
export const method = 'dungsil-agent-browser/view'

export interface BrowserView {
  status: 'idle' | 'starting' | 'live' | 'closed' | 'error'
  command?: string
  image?: string
  sequence: number
  error?: 'unavailable' | 'command_failed' | 'stream_failed' | 'permission'
}
