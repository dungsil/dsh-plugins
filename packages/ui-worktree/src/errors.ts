export const failureCodes = [
  'busy',
  'conflict',
  'invalid',
  'operation_failed',
  'session_not_found',
  'forbidden',
  'auth_required',
  'endpoint_missing',
  'client_unavailable',
  'invalid_response',
  'connection_error',
  'timeout',
] as const

export type FailureCode = (typeof failureCodes)[number]
export type WorktreeOperation = 'describe' | 'initialize' | 'create' | 'switch' | 'select'
export interface WorktreeFailure {
  operation: WorktreeOperation
  code: FailureCode
  uncertain: boolean
}

export function failureCode(error: unknown): FailureCode {
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout'
  if (error && typeof error === 'object' && 'code' in error) {
    const code = error.code === 'session/not-found' ? 'session_not_found' : error.code
    if (failureCodes.includes(code as FailureCode)) return code as FailureCode
    return 'operation_failed'
  }
  if (error instanceof Error) {
    const status = error.message.match(/\bHTTP (\d{3})\b/)?.[1]
    if (status === '401') return 'auth_required'
    if (status === '403') return 'forbidden'
    if (status === '404') return 'endpoint_missing'
  }
  return 'connection_error'
}
