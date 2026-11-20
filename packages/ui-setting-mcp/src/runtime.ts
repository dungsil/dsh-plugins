export interface ConfigForm {
  getSnapshot(): {
    readonly status: string
    readonly base: unknown
    readonly user: unknown
    readonly value: unknown
    readonly writable: boolean
    readonly revision?: number
  }
  subscribe(listener: () => void): () => void
  mutate(changes: readonly (
    | { op: 'set'; path: readonly string[]; value: unknown }
    | { op: 'unset'; path: readonly string[] }
  )[], revision: number): Promise<boolean>
}
export type RemoteResult<T> = { ok: true; value: T } | { ok: false; error?: unknown }

export function hasSettingsOverride(input: unknown, keys: readonly string[]): boolean {
  let value: unknown = input
  for (const key of keys) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return false
    value = (value as Record<string, unknown>)[key]
  }
  return true
}
