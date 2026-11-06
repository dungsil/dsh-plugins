export const channel = '/api'
export const readMethod = 'dungsil-setting-vcs/read'
export const saveMethod = 'dungsil-setting-vcs/save'

export interface SettingsEntry {
  id: string
  kind: 'worktree' | 'panel'
  revision: string
  settings: { directory?: string; prefix: string }
}

export interface SettingsView {
  entries: SettingsEntry[]
}

export function validSettings(value: unknown, kind?: SettingsEntry['kind']): value is SettingsEntry['settings'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as Record<string, unknown>
  const target = kind ?? (Object.hasOwn(settings, 'directory') ? 'worktree' : 'panel')
  const keys = target === 'worktree' ? ['directory', 'prefix'] : ['prefix']
  if (Object.keys(settings).length !== keys.length || !keys.every((key) => Object.hasOwn(settings, key))) return false
  if (
    typeof settings.prefix !== 'string' ||
    settings.prefix.length > 100 ||
    (settings.prefix !== '' && (!/^[A-Za-z0-9_]/.test(settings.prefix) || /[^A-Za-z0-9_-]/.test(settings.prefix)))
  )
    return false
  if (target === 'panel') return true
  const directory = settings.directory
  return (
    typeof directory === 'string' &&
    directory.trim().length > 0 &&
    directory.length <= 4096 &&
    // Control characters cannot safely form a filesystem path.
    // oxlint-disable-next-line no-control-regex
    !/[\\\\:\x00-\x1f\x7f]/.test(directory) &&
    directory.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..')
  )
}

export interface SavePayload {
  id: string
  revision: string
  settings: SettingsEntry['settings']
}
