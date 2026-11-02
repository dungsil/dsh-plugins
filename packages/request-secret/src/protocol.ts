export const channel = '/api'
export const endpointPrefix = 'dungsil-secrets/'
export const maxSecretLength = 65_536

/** Public metadata only. Never add the submitted value to this view. */
export interface SecretRequest {
  id: string
  ref: string
  label: string
  reason: string
  sessionId: string
  configured: boolean
}

export type SecretStatus = 'saved' | 'declined' | 'cancelled' | 'timed_out' | 'unavailable'
