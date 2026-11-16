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
}
