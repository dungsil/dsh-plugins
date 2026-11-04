export const channel = '/api'
export const method = 'dungsil-ui-setting-skills/list'
export const saveMethod = 'dungsil-ui-setting-skills/save'
export const translateMethod = 'dungsil-ui-setting-skills/translate'

export interface SkillsView {
  translationAvailable: boolean
  disabled: string[]
  skills: {
    name: string
    description: string
    source: 'user-agents' | 'user-dsh'
    path?: string
  }[]
  complete: boolean
}
