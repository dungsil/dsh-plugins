import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-working-directory'
import { z } from 'zod'
import { name, projection } from './protocol.js'

export { name }
export const inject = ['sessionProjections']

export async function apply(ctx: Context) {
  const schema = z.array(z.object({ seq: z.number().int(), cwd: z.string() }))
  await ctx.sessionProjections.register({
    key: projection,
    stateVersion: 1,
    stateSchema: schema,
    init: (header) => (header.cwd ? [{ seq: -1, cwd: header.cwd }] : []),
    apply: (state, event) =>
      event.type === 'working-directory/change' ? [...state, { seq: event.seq, cwd: event.data.cwd }] : state,
    // Full history, not the paginated chat window; never add it to Session list summaries.
    wire: { viewSchema: schema, view: (state) => state, summary: false },
  })
}
