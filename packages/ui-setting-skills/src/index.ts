import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { channel, method, type SkillsView } from './protocol.js'

export const name = 'dungsil-ui-setting-skills'
export const inject = ['connection']

export function apply(ctx: Context) {
  const lifetime = new AbortController()
  // Web profiles mount filesystem skills inside agent scopes, not the global registry.
  // Reuse host discovery without registering a provider or changing any agent's skills.
  const provider = new FileSystemSkillProvider(ctx, { signal: lifetime.signal, invalidate() {} }, { watch: false })
  ctx.effect(
    () => async () => {
      lifetime.abort()
      await provider.dispose()
    },
    'ui-setting-skills: dispose discovery'
  )
  // Exact Connection routes are owner-only, unlike shared session RPC handlers.
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
            const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(15_000)])
            // No cwd: project skills are intentionally outside this settings page.
            const observation = await provider.list({ signal })
            signal.throwIfAborted()
            const skills = 'candidates' in observation ? observation.candidates : observation
            const value: SkillsView = {
              complete: 'candidates' in observation ? observation.complete : true,
              skills: skills.flatMap((skill) =>
                skill.source === 'user-agents' || skill.source === 'user-dsh'
                  ? [
                      {
                        name: skill.name,
                        description: skill.description,
                        source: skill.source === 'user-agents' ? 'user-agents' : 'user-dsh',
                        path: skill.path,
                      },
                    ]
                  : []
              ),
            }
            result = { ok: true as const, value }
          } catch {
            result = {
              ok: false as const,
              error: { code: 'load_failed', message: 'Could not load skills.', details: {} },
            }
          }
          return Response.json(
            { type: 'server-response', rpcId: body.data.rpcId, result },
            { headers: { 'Cache-Control': 'no-store' } }
          )
        },
      }),
    'ui-setting-skills: owner-only list'
  )
}
