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
}

export interface ModelSettingsView {
  target: TitleTarget | null
  providers: { id: string; name: string; models: { id: string; name: string }[] }[]
  catalogError: boolean
}
