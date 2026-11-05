import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { lastAssistantStreamChunk, type TokenUsage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import { callLimit, method, type UsageTotals, type UsageView } from './protocol.js'

export const name = 'dungsil-ui-usage'
export const inject = ['connection', 'sessionQuery']

const empty = (): UsageTotals => ({
  calls: 0,
  unreported: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
})

function add(totals: UsageTotals, usage: TokenUsage | undefined) {
  totals.calls++
  if (!usage) {
    totals.unreported++
    return
  }
  totals.input += usage.inputTokens
  totals.output += usage.outputTokens
  totals.cacheRead += usage.cacheReadTokens ?? 0
  totals.cacheWrite += usage.cacheWriteTokens ?? 0
  // Reasoning is already included in output; cache counts are disjoint from input.
  totals.total +=
    usage.totalTokens ??
    usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `/api/${method}`,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          let rpcId = ''
          const failure = (code: string) => ({
            ok: false as const,
            error: { code, message: 'Usage unavailable', details: {} },
          })
          let result: { ok: true; value: UsageView } | ReturnType<typeof failure>
          try {
            const body = clientRequestSchema.parse(await request.json())
            rpcId = body.rpcId
            const input = body.payload as { days?: unknown; timeZone?: unknown } | null
            if (
              body.method !== method ||
              !input ||
              ![7, 30, 0].includes(input.days as number) ||
              typeof input.timeZone !== 'string'
            ) {
              return Response.json(
                { type: 'server-response', rpcId, result: failure('invalid') },
                { headers: { 'Cache-Control': 'no-store' } }
              )
            }
            let formatter: Intl.DateTimeFormat
            try {
              formatter = new Intl.DateTimeFormat('en-CA', {
                timeZone: input.timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })
            } catch {
              return Response.json(
                { type: 'server-response', rpcId, result: failure('invalid') },
                { headers: { 'Cache-Control': 'no-store' } }
              )
            }
            const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60_000)])
            const updatedAt = Date.now()
            const today = formatter.format(updatedAt)
            const start =
              input.days === 0
                ? ''
                : new Date(Date.parse(`${today}T00:00:00Z`) - ((input.days as number) - 1) * 86_400_000)
                    .toISOString()
                    .slice(0, 10)
            const view: UsageView = {
              totals: empty(),
              models: [],
              calls: [],
              days: [],
              sessions: 0,
              unreadable: 0,
              updatedAt,
              timeZone: input.timeZone,
            }
            const models = new Map<string, UsageView['models'][number]>()
            const days = new Map<string, number>()
            const records = await ctx.sessionQuery.listSessions(signal)
            // Bounded parallel reads; never make cold sessions live or retain their logs.
            let index = 0
            await Promise.all(
              Array.from({ length: Math.min(4, records.length) }, async () => {
                while (index < records.length) {
                  signal.throwIfAborted()
                  const record = records[index++]
                  try {
                    using observation = await ctx.sessionQuery.observeSession(record.header.id, {
                      signal,
                      projectionMode: 'none',
                    })
                    let provider = ''
                    let model = ''
                    let included = false
                    for (const event of observation.events) {
                      if (event.type === 'request/context') ({ provider, model } = event.data)
                      if (event.type === 'request/header') ({ provider, model } = event.data.header.config)
                      // Inherited headers still establish the route, but inherited calls aren't new usage.
                      if (event.seq < observation.inheritedEventCount || event.time > updatedAt) continue
                      if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
                      const day = formatter.format(event.time)
                      if (day < start || day > today) continue
                      const usage =
                        event.type === 'assistant/message'
                          ? event.data.usage
                          : lastAssistantStreamChunk(event.data.stream, 'usage')?.usage
                      const route = event.type === 'assistant/message' ? event.data.message.source : { provider, model }
                      const key = JSON.stringify([route.provider, route.model])
                      let row = models.get(key)
                      if (!row) models.set(key, (row = { provider: route.provider, model: route.model, ...empty() }))
                      const before = row.total
                      add(row, usage)
                      add(view.totals, usage)
                      const finish = lastAssistantStreamChunk(event.data.stream, 'finish')?.reason.kind
                      const call: UsageView['calls'][number] = {
                        ...empty(),
                        session: record.header.id,
                        seq: event.seq,
                        time: event.time,
                        provider: route.provider,
                        model: route.model,
                        status:
                          finish === 'error'
                            ? 'failure'
                            : finish === 'aborted' || (event.type === 'assistant/message' && event.data.interrupted)
                              ? 'interrupted'
                              : event.type === 'assistant/message'
                                ? 'success'
                                : 'unknownStatus',
                      }
                      add(call, usage)
                      // Keep response size and retained metadata bounded, independently of corpus size.
                      view.calls.push(call)
                      view.calls.sort((a, b) => b.time - a.time || a.session.localeCompare(b.session) || b.seq - a.seq)
                      if (view.calls.length > callLimit) view.calls.pop()
                      days.set(day, (days.get(day) ?? 0) + row.total - before)
                      included = true
                    }
                    if (included) view.sessions++
                  } catch {
                    signal.throwIfAborted()
                    view.unreadable++
                  }
                }
              })
            )
            view.models = [...models.values()].sort(
              (a, b) => b.total - a.total || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model)
            )
            // Keep the graph bounded even for an all-time query; totals and model rows remain all-time.
            const chartStart =
              start || new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)
            for (
              let date = Date.parse(`${chartStart}T00:00:00Z`);
              date <= Date.parse(`${today}T00:00:00Z`);
              date += 86_400_000
            ) {
              const day = new Date(date).toISOString().slice(0, 10)
              view.days.push({ day, total: days.get(day) ?? 0 })
            }
            result = { ok: true, value: view }
          } catch {
            result = failure('unavailable')
          }
          return Response.json({ type: 'server-response', rpcId, result }, { headers: { 'Cache-Control': 'no-store' } })
        },
      }),
    'usage: owner-only session accounting'
  )
}
