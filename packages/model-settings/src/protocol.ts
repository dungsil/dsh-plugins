export const channel = '/api'
export const endpointPrefix = 'dungsil-model-settings/'

export interface Route {
  provider: string
  model: string
}

export interface TitleTarget {
  id: string
  revision: string
  route: Route | null
  reasoningEffort: string | null
  useAuxiliary?: boolean
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
