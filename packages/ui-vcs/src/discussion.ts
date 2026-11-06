import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { hostApi } from './forge-providers.js'
import { inspectSession } from './inspect-session.js'
import { readQueue } from './read-queue.js'
import { readDiscussion, type Discussion } from './discussion-read.js'

export const name = 'dungsil-vcs-discussion'
export const inject = ['connection', 'forge', 'forgeSession', 'sessionPersistence', 'sessionController', 'subprocess']
export function apply(ctx: Context) {
  const lifetime = new AbortController()
  const read = readQueue(ctx.subprocess)
  ctx.effect(() => () => lifetime.abort())
  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: '/api/dungsil-vcs/discussion',
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        let rpcId = ''
        let result: unknown = {
          ok: false,
          error: { code: 'unavailable', message: 'Discussion unavailable', details: {} },
        }
        try {
          const body = clientRequestSchema.parse(await request.json())
          rpcId = body.rpcId
          const payload = body.payload as { sessionId?: unknown }
          if (
            body.method !== 'dungsil-vcs/discussion' ||
            !payload ||
            typeof payload.sessionId !== 'string' ||
            !payload.sessionId ||
            payload.sessionId.length > 256 ||
            Object.keys(payload).some((key) => key !== 'sessionId')
          )
            throw new Error('invalid')
          const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(60_000)])
          const documents = await read(signal, async () => {
            const session = await inspectSession(ctx, SessionId(payload.sessionId as string), signal)
            const refs = ctx.forgeSession.changeRequests(session).filter((entry) => entry.ref)
            if (refs.length > 8) throw new Error('too_many_requests')
            const result: Discussion[] = []
            for (const entry of refs) {
              const ref = entry.ref!
              const forge = ref.repository.forge
              if (!['github', 'gitlab', 'gitea', 'forgejo'].includes(forge)) continue
              result.push({
                url: ctx.forge.changeRequestUrl(ref),
                ...(await readDiscussion(
                  ref,
                  hostApi(ctx, forge as 'github' | 'gitlab' | 'gitea' | 'forgejo'),
                  signal
                )),
              })
              if (JSON.stringify(result).length > 4_194_304) throw new Error('too_large')
            }
            return result
          })
          result = { ok: true, value: documents }
        } catch {
          /* Never return CLI stderr, credentials, or partial pagination as a complete discussion. */
        }
        return Response.json({ type: 'server-response', rpcId, result }, { headers: { 'Cache-Control': 'no-store' } })
      },
    })
  )
}
