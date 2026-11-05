export const channel = '/api'
export const endpointPrefix = 'dungsil-model-settings/'

export interface Route {
  provider: string
  model: string
}

export type LocalizedText = Record<'en' | 'ko' | 'zh', string>

export type ModelSelection =
  | { mode: 'conversation' }
  | { mode: 'auxiliary' }
  | { mode: 'model'; route: Route; reasoningEffort: string | null }

export interface TaskSnapshot {
  id: string
  revision: string
  key: string
  owner: { entryId: string; packageName: string }
  label: LocalizedText
  description: LocalizedText
  automaticReasoningLabel: LocalizedText
  instructionsHint?: LocalizedText
  selection: ModelSelection
  instructions: string
  defaultInstructions: string
}

export interface ModelSettingsViewV2 {
  auxiliary: TaskSnapshot | null
  tasks: TaskSnapshot[]
  providers: ModelSettingsView['providers']
  catalogError: boolean
}

export interface TitleTarget {
  id: string
  revision: string
  route: Route | null
  reasoningEffort: string | null
  useAuxiliary?: boolean
  instructions: string
  defaultInstructions: string
}

export interface ModelSettingsView {
  auxiliary: TitleTarget | null
  target: TitleTarget | null
  worktree?: TitleTarget | null
  yoonmoon?: TitleTarget | null
  providers: {
    id: string
    name: string
    models: { id: string; name: string; efforts: { id: string; name: string }[] }[]
  }[]
  catalogError: boolean
}
