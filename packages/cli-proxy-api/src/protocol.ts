export const channel = '/api'
export const endpointPrefix = 'dungsil-cli-proxy-api/'

export interface ConnectionView {
  baseURL: string
  revision: string
  apiKeySaved: boolean
  managementKeySaved: boolean
}

export interface ProxyModel {
  id: string
  name: string
}

export interface ProxyAccount {
  name: string
  provider: string
  status: string
  disabled: boolean
  authIndex: string
  editable: boolean
}

export interface ManagementView {
  accounts: ProxyAccount[]
  strategy: string
  requestRetry: number
}

export const oauthProviders = ['claude', 'codex', 'antigravity', 'kimi', 'kimi-ai', 'xai', 'devin', 'meta'] as const

export interface OAuthSession {
  provider: string
  url: string
  state: string
  userCode?: string
}
