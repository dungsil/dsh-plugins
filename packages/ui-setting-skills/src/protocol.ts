export const channel = '/api'
export const method = 'dungsil-ui-setting-skills/list'

export interface SkillsView {
  skills: {
    name: string
    description: string
    source: 'user-agents' | 'user-dsh'
    path?: string
  }[]
  complete: boolean
}
