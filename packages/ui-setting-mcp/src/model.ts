export interface McpEntry {
  readonly transport: "stdio" | "streamable-http'
  readonly enabled?: boolean
  readonly command?: string
  readonly args?: readonly string[]
  readonly env?: Readonly<Record<string, string>>
  readonly cwd?: string
  readonly url?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly [key: string]: unknown
}

export interface McpStatus {
  readonly name: string
  readonly origin: "config" | "plugin'
  readonly state: string
  readonly toolCount?: number
  readonly configured?: boolean
  readonly cleanupFailed?: boolean
}

export interface McpSnapshot {
  readonly revision: number
  readonly writable: boolean
  readonly entries: Readonly<Record<string, McpEntry>>
  readonly statuses: readonly McpStatus[]
  readonly inherited: readonly string[]
  readonly enabledOverrides: readonly string[]
}

export interface McpSource {
  readonly read: () => Promise<McpSnapshot>
  readonly watch: (listener: (statuses: readonly McpStatus[]) => void, onError: () => void) => () => void
  readonly save: (snapshot: McpSnapshot, name: string, entry: McpEntry, create: boolean) => Promise<void>
  readonly setEnabled: (snapshot: McpSnapshot, name: string, enabled: boolean) => Promise<void>
  readonly resetEnabled: (snapshot: McpSnapshot, name: string) => Promise<void>
  readonly remove: (snapshot: McpSnapshot, name: string) => Promise<void>
  readonly restart: (name: string) => Promise<void>
  readonly probe: (name: string) => Promise<{ ok: boolean; toolCount?: number; cleanupFailed?: boolean }>
}

export const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/u
export const isMcpName = (name: string): boolean => MCP_NAME_PATTERN.test(name)
