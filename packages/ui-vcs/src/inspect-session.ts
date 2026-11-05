import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { Session, type SessionId } from '@deepseek-ai/dsh-session'

export async function inspectSession(ctx: Context, id: SessionId, signal: AbortSignal): Promise<Session> {
  signal.throwIfAborted()
  const live = ctx.get('agents')?.get(id)
  if (live) return live.session
  const inspection = await ctx.sessionController.inspect(id, signal)
  signal.throwIfAborted()
  return Session.create(id, inspection.events, inspection.meta, inspection.inheritedEventCount)
}
