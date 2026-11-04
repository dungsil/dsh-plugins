import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { WebError, type WebSearchSource } from '@deepseek-ai/dsh-web'
import { channel, endpointPrefix, type KagiSettings } from './protocol.js'

export const name = 'dungsil-web-search-kagi'
export const inject = ['web', 'credentials', 'connection']

const ref = credentialRef('KAGI_API_KEY')

export function apply(ctx: Context) {
  const environmentKey = () => launchEnvironmentOf(ctx).get(ref)?.value.trim() || undefined
  const settings = async (): Promise<KagiSettings> => {
    const environment = !!environmentKey()
    const info = await ctx.credentials.describe(ref)
    return { configured: environment || info.configured, environment, writable: !environment && info.writable }
  }

  ctx.web.registerSearchProvider({
    id: 'kagi',
    available: () => true,
    async search(request, signal) {
      try {
        signal?.throwIfAborted()
        const key = environmentKey() ?? (await ctx.credentials.resolve(ref))?.value
        if (!key)
          throw new WebError(
            'Kagi search needs KAGI_API_KEY. Enter an API key in Settings > Kagi web search on the DSH host.',
            'WEB_PROVIDER_CREDENTIAL_MISSING'
          )
        const response = await fetch('https://kagi.com/api/v1/search', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: request.query,
            ...(request.maxResults === undefined ? {} : { limit: Math.min(1024, request.maxResults) }),
          }),
          redirect: 'error',
          signal,
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw new WebError(`Kagi search failed (HTTP ${response.status}).`, 'WEB_PROVIDER_ERROR')
        }
        const body = await response.json()
        if (!body || body.error?.length || !Array.isArray(body.data?.search))
          throw new WebError('Kagi returned an invalid search response.', 'WEB_PROVIDER_ERROR')
        const sources: WebSearchSource[] = body.data.search.map((item: unknown) => {
          if (!item || typeof item !== 'object' || !('url' in item) || typeof item.url !== 'string')
            throw new WebError('Kagi returned an invalid search result.', 'WEB_PROVIDER_ERROR')
          return {
            url: item.url,
            ...('title' in item && typeof item.title === 'string' ? { title: item.title } : {}),
            ...('snippet' in item && typeof item.snippet === 'string' ? { snippet: item.snippet } : {}),
            ...('time' in item && typeof item.time === 'string' ? { publishedAt: item.time } : {}),
          }
        })
        return { sources, truncated: false }
      } catch (error) {
        if (signal?.aborted) throw new WebError('Kagi search was cancelled.', 'WEB_ABORTED')
        if (error instanceof WebError) throw error
        // Transport and response errors can contain credentials; do not expose their causes.
        throw new WebError('Kagi search could not be completed.', 'WEB_PROVIDER_ERROR')
      }
    },
  })

  for (const endpoint of ['describe', 'save']) {
    ctx.effect(() =>
      ctx.connection.fetch.register({
        path: `${channel}/${endpointPrefix}${endpoint}`,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          let body
          try {
            body = clientRequestSchema.safeParse(await request.json())
          } catch {
            return new Response('Invalid request', { status: 400 })
          }
          if (!body.success || body.data.method !== `${endpointPrefix}${endpoint}`)
            return new Response('Invalid request', { status: 400 })
          let result
          try {
            if (endpoint === 'save') {
              const payload = body.data.payload as { apiKey?: unknown } | null
              if (
                !payload ||
                typeof payload.apiKey !== 'string' ||
                !payload.apiKey.trim() ||
                payload.apiKey.length > 4096 ||
                /[\r\n]/.test(payload.apiKey) ||
                !(await settings()).writable
              )
                return new Response('Invalid request', { status: 400 })
              request.signal.throwIfAborted()
              await ctx.credentials.set(ref, payload.apiKey.trim())
            }
            result = { ok: true, value: await settings() }
          } catch {
            result = {
              ok: false,
              error: { code: 'settings_failed', message: 'Kagi settings could not be updated.', details: {} },
            }
          }
          return Response.json(
            { type: 'server-response', rpcId: body.data.rpcId, result },
            { headers: { 'Cache-Control': 'no-store' } }
          )
        },
      })
    )
  }
}
