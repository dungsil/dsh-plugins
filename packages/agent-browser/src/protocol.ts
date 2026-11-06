export const name = 'dungsil-agent-browser'
export const method = 'dungsil-agent-browser/view'
export const controlMethod = 'dungsil-agent-browser/control'

export interface BrowserView {
  status: 'idle' | 'starting' | 'live' | 'closed' | 'error'
  command?: string
  image?: string
  sequence: number
  url?: string
  title?: string
  canGoBack?: boolean
  canGoForward?: boolean
  width?: number
  height?: number
  error?: 'unavailable' | 'command_failed' | 'stream_failed' | 'permission'
}
