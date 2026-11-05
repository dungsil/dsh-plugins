import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as plugin from '../dist/index.js'
import { copy } from '../src/copy.ts'

await test('usage HTTP API accounts for original calls, routes, cache, attempts and local calendar days', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-04T13:00:00Z') })
  const home = await mkdtemp(join(tmpdir(), 'dsh-usage-'))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  const event = (type, data, time = '2026-11-04T12:00:00Z') => ({ type, data, time: Date.parse(time) })
  const route = (provider, model) => event('request/header', { header: { config: { provider, model } } })
  const message = (usage, time, provider = 'alpha') =>
    event(
      'assistant/message',
      {
        usage,
        stream: [],
        message: { role: 'assistant', source: { kind: 'model', provider, model: 'shared' }, content: [] },
      },
      time
    )
  const original = [
    route('alpha', 'shared'),
    message({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 50, cacheWriteTokens: 7, reasoningTokens: 11 }),
  ]
  let sessions = [
    { id: 'original', events: original },
    {
      id: 'fork',
      inheritedEventCount: 2,
      events: [
        ...original,
        message({ inputTokens: 3, outputTokens: 5 }),
        event('request/context', { provider: 'beta', model: 'shared' }),
        event('assistant/attempt', {
          stream: [
            { type: 'chunk', time: 1, chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } } },
            {
              type: 'chunk',
              time: 2,
              chunk: { type: 'usage', usage: { inputTokens: 9, outputTokens: 4, totalTokens: 19 } },
            },
          ],
        }),
        message(undefined, undefined, 'beta'),
      ],
    },
    {
      id: 'boundary',
      events: [
        route('stale', 'header'), // Assistant source metadata owns completed-call attribution.
        // Midnight on October 29 in Seoul is the inclusive start of the seven-day range.
        message({ inputTokens: 10, outputTokens: 2 }, '2026-10-28T15:00:00Z'),
        message({ inputTokens: 30, outputTokens: 6 }, '2026-10-28T14:59:59.999Z'),
        message({ inputTokens: 1000, outputTokens: 1 }, '2026-09-01T00:00:00Z'),
        message({ inputTokens: 9999, outputTokens: 1 }, '2026-11-04T14:00:00Z'),
      ],
    },
    { id: 'unreadable', error: true },
  ]
  ctx.provide('sessionQuery', {
    listSessions: async () => sessions.map(({ id }) => ({ header: { id } })),
    observeSession: async (id) => {
      const session = sessions.find((item) => item.id === id)
      if (session.error) throw new Error('private/path must never escape')
      return {
        inheritedEventCount: session.inheritedEventCount ?? 0,
        events: session.events.map((item, seq) => ({ ...item, seq })),
        [Symbol.dispose]() {},
      }
    },
  })
  await ctx.plugin(plugin)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const read = async (payload = { days: 7, timeZone: 'Asia/Seoul' }, principal = { kind: 'owner' }) => {
    const response = await handler.fetch(
      new Request('http://localhost/api/dungsil-usage/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'dungsil-usage/describe', payload }),
      }),
      { principal, interactions: 'deny' }
    )
    if (response.status !== 200) return { status: response.status }
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return (await response.json()).result
  }
  await t.test('fork history is excluded, inherited route retained, provider identities stay distinct', async () => {
    const result = await read()
    assert.equal(result.ok, true)
    assert.deepEqual(result.value.totals, {
      calls: 5,
      unreported: 1,
      input: 122,
      output: 31,
      cacheRead: 50,
      cacheWrite: 7,
      total: 216,
    })
    assert.equal(result.value.sessions, 3)
    assert.equal(result.value.unreadable, 1)
    assert.deepEqual(
      result.value.models.map(({ provider, model, total }) => ({ provider, model, total })),
      [
        { provider: 'alpha', model: 'shared', total: 197 },
        { provider: 'beta', model: 'shared', total: 19 },
      ]
    )
    assert.equal(result.value.days.length, 7)
    assert.deepEqual(result.value.days[0], { day: '2026-10-29', total: 12 })
    assert.deepEqual(result.value.days[1], { day: '2026-10-30', total: 0 })
    assert.deepEqual(result.value.days.at(-1), { day: '2026-11-04', total: 204 })
    assert.equal(JSON.stringify(result).includes('private/path'), false)
  })
  await t.test('30-day and all-time totals include older calls without growing the daily graph', async () => {
    assert.equal((await read({ days: 30, timeZone: 'Asia/Seoul' })).value.totals.total, 252)
    const result = await read({ days: 0, timeZone: 'Asia/Seoul' })
    assert.equal(result.value.totals.total, 1253)
    assert.equal(result.value.days.length, 30)
    assert.equal(
      result.value.days.reduce((sum, day) => sum + day.total, 0),
      252
    )
  })
  await t.test('anonymous reads and invalid queries are rejected', async () => {
    assert.deepEqual(await read(undefined, { kind: 'anonymous' }), { status: 403 })
    for (const payload of [
      null,
      {},
      { days: '7', timeZone: 'UTC' },
      { days: -1, timeZone: 'UTC' },
      { days: 7, timeZone: 'invalid' },
    ]) {
      assert.equal((await read(payload)).error.code, 'invalid')
    }
  })
  await t.test('empty corpus is a successful zero rather than a failure', async () => {
    sessions = []
    const result = await read()
    assert.equal(result.value.totals.total, 0)
    assert.equal(result.value.totals.calls, 0)
    assert.equal(result.value.sessions, 0)
    assert.deepEqual(result.value.models, [])
    assert.equal(result.value.days.length, 7)
  })
})

await test('all dashboard strings are available in English, Korean and Chinese', () => {
  for (const language of ['ko', 'zh']) {
    assert.deepEqual(Object.keys(copy[language]).sort(), Object.keys(copy.en).sort())
    for (const value of Object.values(copy[language])) assert.ok(value.trim())
  }
})
