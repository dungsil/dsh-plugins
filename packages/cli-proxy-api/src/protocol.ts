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

export const providerFamilies = [
  'gemini',
  'interactions',
  'codex',
  'meta',
  'xai',
  'claude',
  'vertex',
  'openai-compatibility',
] as const

export interface ProviderView {
  revision: string
  groups: { family: string; name: string; keys: number }[]
}

export interface QuotaAccount extends ProxyAccount {
  supported: boolean
}

export type { QuotaResult } from './quota.js'

export const oauthProviders = ['claude', 'codex', 'antigravity', 'kimi', 'kimi-ai', 'xai', 'devin', 'meta'] as const

export interface OAuthSession {
  provider: string
  url: string
  state: string
  userCode?: string
}
