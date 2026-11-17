import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'

/** A parsed owner-only fetch request, ready for endpoint-owned payload validation. */
export interface RpcRequest {
  /** Correlation id from the client request envelope. */
  rpcId: string
  /** Endpoint payload; its shape belongs to the endpoint owner. */
  payload: unknown
}

/**
 * Parse a Connection fetch request against one exact method. Returns null for
 * anything the envelope rejects, so the caller answers 400; payload validation
 * stays with the endpoint owner.
 */
export async function parseRpcRequest(request: Request, method: string): Promise<RpcRequest | null> {
  let parsed
  try {
    parsed = clientRequestSchema.safeParse(await request.json())
  } catch {
    return null
  }
  if (!parsed.success || parsed.data.method !== method) return null
  return { rpcId: parsed.data.rpcId, payload: parsed.data.payload }
}

/**
 * Reply to a parsed request with the server-response envelope. Cache-control
 * keeps proxies and caches from reusing one RPC result for another request.
 */
export function rpcResponse(rpcId: string, result: unknown): Response {
  return Response.json({ type: 'server-response', rpcId, result }, { headers: { 'Cache-Control': 'no-store' } })
}
