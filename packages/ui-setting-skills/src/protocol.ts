export const channel = '/api'
export const method = 'dungsil-ui-setting-skills/list'
export const saveMethod = 'dungsil-ui-setting-skills/save'
export const translateMethod = 'dungsil-ui-setting-skills/translate'
export const openFolderMethod = 'dungsil-ui-setting-skills/open-folder'
export const sourceMethod = 'dungsil-ui-setting-skills/source'

export interface SkillsView {
  translationAvailable: boolean
  folderOpenAvailable: boolean
  disabled: string[]
  skills: {
    name: string
    description: string
    display?: { name?: string; description?: string }
    source: 'user-agents' | 'user-dsh'
    path?: string
  }[]
  complete: boolean
  catalogError?: boolean
  contexts?: {
    workspaces: { id: string; title: string; path: string }[]
    presets: { id: string; name?: string; broken?: string }[]
    workspaceId: string
    presetId: string
    cwd: string
  }
  catalog?: {
    complete: boolean
    skills: {
      name: string
      description: string
      source: string
      provider: string
      path?: string
      display?: { name?: string; description?: string }
    }[]
  }
}
