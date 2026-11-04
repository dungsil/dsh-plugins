export const channel = '/api'
export const endpointPrefix = 'dungsil-kagi/'

/** Credential metadata only; never return the key to the browser or model. */
export interface KagiSettings {
  configured: boolean
  environment: boolean
  writable: boolean
}
