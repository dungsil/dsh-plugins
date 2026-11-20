/* oxlint-disable promise/avoid-new -- Settings 스키마와 구독 기반 로딩을 동적 경계에서 연결한다. */
import type { ConfigForm, RemoteResult } from './runtime.js'
import { hasSettingsOverride } from './runtime.js'

import { isMcpName } from './model.js'
import type { McpEntry, McpSnapshot, McpSource, McpStatus } from './model.js'

interface View {
  readonly name: string
  readonly configured: boolean
  readonly status: {
    readonly state: string
    readonly toolCount?: number
    readonly reason?: string
    readonly result?: { readonly closeConfirmed: boolean; readonly cleanupError?: string }
  }
}
interface Stream extends AsyncIterable<readonly View[]> {
  readonly dispose: () => void
}
export interface McpRemote {
  watch: (signal?: AbortSignal) => Stream
  restart: (name: string) => Promise<RemoteResult<void>>
  probe: (
    name: string,
    signal?: AbortSignal
  ) => Promise<
    RemoteResult<{
      readonly ok: boolean
      readonly toolNames?: readonly string[]
      readonly truncated?: boolean
      readonly closeConfirmed: boolean
      readonly cleanupError?: string
    }>
  >
}

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {}
const servers = (value: unknown): Readonly<Record<string, McpEntry>> =>
  record(record(value).servers) as Readonly<Record<string, McpEntry>>
const own = (value: object, key: string): boolean => Object.hasOwn(value, key)

// 마스킹된 값이 실제 설정을 덮어쓰지 않도록 차단한다.
const containsRedaction = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value === '********' || value === '[REDACTED]' || value === '<redacted>'
  }
  if (Array.isArray(value)) {
    return value.some(containsRedaction)
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(containsRedaction)
  }
  return false
}

const hasCleanupFailed = (status: View['status']): boolean => {
  if (status.reason === 'cleanup' || status.reason === 'unclosed-generation') {
    return true
  }
  return status.result !== undefined && (!status.result.closeConfirmed || status.result.cleanupError !== undefined)
}
const REJECTED = 'MCP operation rejected'
const requireEntry = (snapshot: McpSnapshot, name: string): McpEntry => {
  const entry = snapshot.entries[name]
  if (!snapshot.writable || !isMcpName(name) || !own(snapshot.entries, name) || entry === undefined) {
    throw new Error(REJECTED)
  }
  return entry
}

export const createMcpSource = (form: ConfigForm, remote: McpRemote): McpSource => {
  let views: readonly View[] = []
  const probes = new Set<AbortController>()
  const statuses = (): readonly McpStatus[] => {
    const entries = servers(form.getSnapshot().value)
    return views.map(({ name, configured, status }) => ({
      configured,
      name,
      origin: own(entries, name) ? 'config' : 'plugin',
      state: status.state,
      ...(status.toolCount === undefined ? {} : { toolCount: status.toolCount }),
      ...(hasCleanupFailed(status) ? { cleanupFailed: true } : {}),
    }))
  }
  const mutate = async (
    snapshot: McpSnapshot,
    op: { op: 'set'; path: readonly string[]; value: unknown } | { op: 'unset'; path: readonly string[] }
  ): Promise<void> => {
    const current = form.getSnapshot()
    if (
      current.status !== 'ready' ||
      !current.writable ||
      !snapshot.writable ||
      !(await form.mutate([op], snapshot.revision))
    ) {
      throw new Error(REJECTED)
    }
  }
  return {
    async probe(name) {
      const abort = new AbortController()
      probes.add(abort)
      try {
        const result = await remote.probe(name, abort.signal)
        if (!result.ok) {
          throw new Error('MCP operation failed')
        }
        return {
          ok: result.value.ok,
          ...(result.value.toolNames === undefined || result.value.truncated === true
            ? {}
            : { toolCount: result.value.toolNames.length }),
          ...(!result.value.closeConfirmed || result.value.cleanupError !== undefined ? { cleanupFailed: true } : {}),
        }
      } finally {
        probes.delete(abort)
      }
    },
    async read() {
      let current = form.getSnapshot()
      if (current.status === 'loading') {
        await new Promise<void>((resolve) => {
          const dispose = form.subscribe(() => {
            if (form.getSnapshot().status !== 'loading') {
              dispose()
              resolve()
            }
          })
          if (form.getSnapshot().status !== 'loading') {
            dispose()
            resolve()
          }
        })
        current = form.getSnapshot()
      }
      if (current.status !== 'ready' || current.revision === undefined) {
        throw new Error('MCP settings unavailable')
      }
      return {
        enabledOverrides: Object.keys(servers(current.value)).filter((name) =>
          hasSettingsOverride(current.user, ['servers', name, 'enabled'])
        ),
        entries: servers(current.value),
        inherited: Object.keys(servers(current.base)),
        revision: current.revision,
        statuses: statuses(),
        writable: current.writable,
      }
    },
    async remove(snapshot, name) {
      requireEntry(snapshot, name)
      if (snapshot.inherited.includes(name)) {
        throw new Error('Inherited MCP entries cannot be removed')
      }
      await mutate(snapshot, { op: 'unset', path: ['servers', name] })
    },
    async resetEnabled(snapshot, name) {
      requireEntry(snapshot, name)
      if (!snapshot.enabledOverrides.includes(name)) {
        throw new Error(REJECTED)
      }
      await mutate(snapshot, { op: 'unset', path: ['servers', name, 'enabled'] })
    },
    async restart(name) {
      const result = await remote.restart(name)
      if (!result.ok) {
        throw new Error('MCP operation failed')
      }
    },
    async save(snapshot, name, entry, create) {
      if (!snapshot.writable || !isMcpName(name)) {
        throw new Error(REJECTED)
      }
      const exists = own(snapshot.entries, name)
      if (create ? exists || views.some((view) => view.name === name) : !exists) {
        throw new Error(REJECTED)
      }
      const previous = exists ? snapshot.entries[name] : undefined
      const defined = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined))
      const merged = {
        ...previous,
        ...defined,
        ...(entry.transport === 'stdio' ? { headers: {}, url: '' } : { args: [], command: '', cwd: '', env: {} }),
      }
      if (containsRedaction(merged)) {
        throw new Error(REJECTED)
      }
      await mutate(snapshot, { op: 'set', path: ['servers', name], value: merged })
    },
    async setEnabled(snapshot, name, enabled) {
      requireEntry(snapshot, name)
      await mutate(snapshot, { op: 'set', path: ['servers', name, 'enabled'], value: enabled })
    },
    watch(listener, onError) {
      const abort = new AbortController()
      let stream: Stream | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const connect = (): void => {
        if (abort.signal.aborted) {
          return
        }
        try {
          stream = remote.watch(abort.signal)
          const active = stream
          void (async () => {
            try {
              for await (const next of active) {
                if (abort.signal.aborted) {
                  return
                }
                views = next
                listener(statuses())
              }
            } catch {
              /* 전송 진단을 화면에 노출하지 않는다. */
            }
            if (!abort.signal.aborted) {
              active.dispose()
              onError()
              timer = setTimeout(connect, 1000)
            }
          })()
        } catch {
          onError()
          timer = setTimeout(connect, 1000)
        }
      }
      const unsubscribe = form.subscribe(() => {
        listener(statuses())
      })
      connect()
      return () => {
        unsubscribe()
        for (const probe of probes) {
          probe.abort()
        }
        probes.clear()
        abort.abort()
        stream?.dispose()
        if (timer !== undefined) {
          clearTimeout(timer)
        }
      }
    },
  }
}
