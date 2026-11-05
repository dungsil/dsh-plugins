import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { Session, type SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'

export async function inspectSession(ctx: Context, id: SessionId, signal: AbortSignal): Promise<Session> {
  signal.throwIfAborted()
  const live = ctx.get('agents')?.get(id)
  if (live) return live.session
  const handle = await ctx.sessionPersistence.open(id, 'read', { signal })
  try {
    const { events } = await handle.read(undefined, undefined, { signal })
    signal.throwIfAborted()
    return Session.create(id, events, handle.header, handle.inheritedEventCount)
  } finally {
    await handle.close()
  }
}
