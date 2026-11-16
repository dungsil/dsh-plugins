import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'

export const channel = '/api'
export const readMethod = 'dungsil-worktree-preference/read'
export const saveMethod = 'dungsil-worktree-preference/save'
export type Checkout = 'current' | 'worktree'
export const Config = z.object({ defaultCheckout: z.union(['current', 'worktree']).default('current').volatile() })
export interface Config {
  defaultCheckout: Volatile<Checkout>
}

export function installPreference(ctx: Context, config: Config) {
  for (const method of [readMethod, saveMethod])
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${method}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            let body
            try {
              body = clientRequestSchema.safeParse(await request.json())
            } catch {
              return new Response('Invalid request', { status: 400 })
            }
            if (!body.success || body.data.method !== method) return new Response('Invalid request', { status: 400 })
            let result
            try {
              let defaultCheckout = config.defaultCheckout.get()
              if (method === saveMethod) {
                const payload = body.data.payload
                if (
                  !payload ||
                  typeof payload !== 'object' ||
                  Array.isArray(payload) ||
                  Object.keys(payload).length !== 1 ||
                  !('defaultCheckout' in payload) ||
                  (payload.defaultCheckout !== 'current' && payload.defaultCheckout !== 'worktree')
                )
                  throw new Error('invalid_request')
                const entry = ctx.fiber.entry
                if (!entry) throw new Error('unavailable')
                await ctx.configEditor.edit(entry, (current, inherited) => ({
                  ...inherited,
                  ...current,
                  defaultCheckout: payload.defaultCheckout,
                }))
                defaultCheckout = payload.defaultCheckout
              }
              result = { ok: true as const, value: { defaultCheckout } }
            } catch {
              result = {
                ok: false as const,
                error: {
                  code: method === saveMethod ? 'save_failed' : 'load_failed',
                  message: 'Worktree preference operation failed.',
                  details: {},
                },
              }
            }
            return Response.json(
              { type: 'server-response', rpcId: body.data.rpcId, result },
              { headers: { 'Cache-Control': 'no-store' } }
            )
          },
        }),
      'ui-forge-worktree: owner-only preference'
    )
}
