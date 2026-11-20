import type { McpEntry } from './model.js'

export interface McpDraft {
  readonly name: string
  readonly transport: 'stdio' | 'streamable-http'
  readonly enabled: boolean
  readonly command: string
  readonly args: string
  readonly env: string
  readonly cwd: string
  readonly url: string
  readonly headers: string
}

export const draftOf = (name: string, entry?: McpEntry): McpDraft => ({
  args: JSON.stringify(entry?.args ?? []),
  command: entry?.command ?? '',
  cwd: entry?.cwd ?? '',
  enabled: entry?.enabled !== false,
  env: JSON.stringify(entry?.env ?? {}),
  headers: JSON.stringify(entry?.headers ?? {}),
  name,
  transport: entry?.transport ?? 'stdio',
  url: entry?.url ?? '',
})

const templatesValid = (value: string): boolean => !/\$\{(?!credential:[A-Za-z_]\w*\})/u.test(value)
const stringMap = (value: unknown): value is Record<string, string> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === 'string')

/** UI에서 보이지 않는 고급 필드는 보존하되 반대 연결 방식의 필드는 명시적으로 비운다. */
export const entryOf = (draft: McpDraft, original?: McpEntry): McpEntry | undefined => {
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(draft.name)) {
    return undefined
  }
  try {
    if (draft.transport === 'stdio') {
      const args: unknown = JSON.parse(draft.args)
      const env: unknown = JSON.parse(draft.env)
      if (
        !draft.command.trim() ||
        !Array.isArray(args) ||
        !args.every((item): item is string => typeof item === 'string') ||
        !stringMap(env)
      ) {
        return undefined
      }
      if (![draft.command, draft.cwd, ...args, ...Object.values(env)].every(templatesValid)) {
        return undefined
      }
      return {
        ...original,
        args,
        command: draft.command.trim(),
        cwd: draft.cwd,
        enabled: draft.enabled,
        env,
        headers: {},
        transport: 'stdio',
        url: '',
      }
    }
    const headers: unknown = JSON.parse(draft.headers)
    const url = new URL(draft.url)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !stringMap(headers) ||
      ![draft.url, ...Object.values(headers)].every(templatesValid)
    ) {
      return undefined
    }
    return {
      ...original,
      args: [],
      command: '',
      cwd: '',
      enabled: draft.enabled,
      env: {},
      headers,
      transport: 'streamable-http',
      url: draft.url.trim(),
    }
  } catch {
    return undefined
  }
}
