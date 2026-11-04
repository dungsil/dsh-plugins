export const channel = '/api'
export const method = 'dungsil-ui-setting-skills/list'
export const saveMethod = 'dungsil-ui-setting-skills/save'

export interface SkillsView {
  disabled: string[]
  skills: {
    name: string
    description: string
    source: 'user-agents' | 'user-dsh'
    path?: string
  }[]
  complete: boolean
}
