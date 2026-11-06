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
import { isValidDateRange, maxRangeDays } from '../src/protocol.ts'

await test('사용량 HTTP API는 원본 호출, 라우트, 캐시, 시도, 로컬 달력 날짜를 반영한다', async (t) => {
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
  await t.test('포크 기록은 제외되고 상속된 라우트는 유지되며 공급자 식별자는 구분된다', async () => {
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
    assert.equal(result.value.calls.length, 5)
    assert.equal(
      result.value.calls.some((call) => call.session === 'fork' && call.seq < 2),
      false
    )
    assert.equal(result.value.calls.at(-1).time, Date.parse('2026-10-28T15:00:00Z'))
    assert.equal(result.value.calls.find((call) => call.session === 'original').total, 177)
    assert.equal(result.value.calls.find((call) => call.session === 'fork' && call.seq === 5).unreported, 1)
    assert.equal(JSON.stringify(result).includes('private/path'), false)
  })
  await t.test('30일과 전체 기간 합계는 일별 그래프를 키우지 않고 더 오래된 호출을 포함한다', async () => {
    assert.equal((await read({ days: 30, timeZone: 'Asia/Seoul' })).value.totals.total, 252)
    const result = await read({ days: 0, timeZone: 'Asia/Seoul' })
    assert.equal(result.value.totals.total, 1253)
    assert.equal(result.value.days.length, 30)
    assert.equal(
      result.value.days.reduce((sum, day) => sum + day.total, 0),
      252
    )
  })
  await t.test('사용자 지정 기간은 시작일과 종료일을 포함하고 해당 기간 전체를 그래프로 반환한다', async () => {
    const result = await read({ startDate: '2026-10-28', endDate: '2026-10-29', timeZone: 'Asia/Seoul' })
    assert.equal(result.ok, true)
    assert.equal(result.value.totals.calls, 2)
    assert.equal(result.value.totals.total, 48)
    assert.equal(result.value.sessions, 1)
    assert.deepEqual(result.value.days, [
      { day: '2026-10-28', total: 36 },
      { day: '2026-10-29', total: 12 },
    ])
    assert.equal(result.value.calls[0].time, Date.parse('2026-10-28T15:00:00Z'))
    assert.equal(result.value.calls[1].time, Date.parse('2026-10-28T14:59:59.999Z'))
  })
  await t.test('동일한 날짜 범위도 요청한 시간대의 달력 날짜로 호출을 포함한다', async () => {
    const payload = { startDate: '2026-10-28', endDate: '2026-10-28' }
    const seoul = await read({ ...payload, timeZone: 'Asia/Seoul' })
    const utc = await read({ ...payload, timeZone: 'UTC' })
    assert.equal(seoul.value.totals.total, 36)
    assert.equal(utc.value.totals.total, 48)
    assert.deepEqual(seoul.value.days, [{ day: '2026-10-28', total: 36 }])
    assert.deepEqual(utc.value.days, [{ day: '2026-10-28', total: 48 }])
  })
  await t.test('미래 날짜도 그래프에 포함하지만 오늘 이후와 오늘의 미래 호출은 집계하지 않는다', async () => {
    const result = await read({ startDate: '2026-11-04', endDate: '2026-11-06', timeZone: 'Asia/Seoul' })
    assert.equal(result.value.totals.total, 204)
    assert.deepEqual(result.value.days, [
      { day: '2026-11-04', total: 204 },
      { day: '2026-11-05', total: 0 },
      { day: '2026-11-06', total: 0 },
    ])
    assert.ok(result.value.calls.every(({ time }) => time <= result.value.updatedAt))
    const future = await read({ startDate: '2026-11-05', endDate: '2026-11-06', timeZone: 'Asia/Seoul' })
    assert.equal(future.value.totals.calls, 0)
    assert.deepEqual(future.value.days, [
      { day: '2026-11-05', total: 0 },
      { day: '2026-11-06', total: 0 },
    ])
  })
  await t.test('시작일과 종료일을 포함하여 최대 366일의 윤년 범위를 허용한다', async () => {
    const result = await read({ startDate: '2024-01-01', endDate: '2024-12-31', timeZone: 'UTC' })
    assert.equal(result.ok, true)
    assert.equal(result.value.days.length, 366)
    assert.deepEqual(result.value.days[0], { day: '2024-01-01', total: 0 })
    assert.deepEqual(result.value.days.at(-1), { day: '2024-12-31', total: 0 })
  })
  await t.test('존재하지 않는 날짜와 역순 및 366일 초과 범위와 혼합된 기간 쿼리는 거부된다', async () => {
    const valid = { startDate: '2026-10-28', endDate: '2026-10-29', timeZone: 'UTC' }
    for (const payload of [
      { ...valid, startDate: '2026-02-29' },
      { ...valid, startDate: '2026-02-30' },
      { ...valid, startDate: '2026-13-01' },
      { ...valid, startDate: '2026-00-01' },
      { ...valid, startDate: '2026-10-00' },
      { ...valid, endDate: '2026-10-32' },
      { ...valid, startDate: '2026-1-01' },
      { ...valid, endDate: '2026-10-29T00:00:00Z' },
      { ...valid, startDate: '2026-10-30' },
      { ...valid, startDate: '2024-01-01', endDate: '2025-01-01' },
      { ...valid, days: 7 },
      { ...valid, days: 30 },
      { ...valid, days: 0 },
      { ...valid, startDate: null },
      { ...valid, endDate: 20261029 },
      { startDate: valid.startDate, timeZone: 'UTC' },
      { endDate: valid.endDate, timeZone: 'UTC' },
      { ...valid, timeZone: 'invalid' },
    ]) {
      const result = await read(payload)
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'invalid')
    }
  })
  await t.test('익명 읽기와 잘못된 쿼리는 거부된다', async () => {
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
  await t.test(
    '최근 100건의 상태와 토큰만 반환하며 본문과 오류 내용은 노출하지 않고 전체 집계는 유지한다',
    async () => {
      const finish = (kind) => ({
        type: 'chunk',
        time: 1,
        chunk: { type: 'finish', reason: { kind, failure: { message: 'private failure body' } } },
      })
      sessions = [
        {
          id: 'recent',
          events: [
            route('beta', 'retry-model'),
            ...Array.from({ length: 105 }, () => message({ inputTokens: 3, outputTokens: 5 })),
            event('assistant/attempt', {
              stream: [
                {
                  type: 'chunk',
                  time: 0,
                  chunk: { type: 'usage', usage: { inputTokens: 9, outputTokens: 4, totalTokens: 19 } },
                },
                finish('error'),
              ],
            }),
            event('assistant/attempt', { stream: [finish('aborted')] }),
            event('assistant/message', {
              message: { source: { provider: 'alpha', model: 'shared' }, content: ['private response body'] },
              usage: { inputTokens: 1, outputTokens: 2 },
              interrupted: true,
              stream: [],
            }),
            event('assistant/attempt', { stream: [] }),
          ],
        },
      ]
      const result = await read()
      assert.equal(result.value.totals.calls, 109)
      assert.equal(result.value.totals.total, 862)
      assert.equal(result.value.calls.length, 100)
      assert.deepEqual(
        result.value.calls
          .slice(0, 5)
          .map(({ seq, status, total, unreported }) => ({ seq, status, total, unreported })),
        [
          { seq: 109, status: 'unknownStatus', total: 0, unreported: 1 },
          { seq: 108, status: 'interrupted', total: 3, unreported: 0 },
          { seq: 107, status: 'interrupted', total: 0, unreported: 1 },
          { seq: 106, status: 'failure', total: 19, unreported: 0 },
          { seq: 105, status: 'success', total: 8, unreported: 0 },
        ]
      )
      assert.equal(result.value.calls.at(-1).seq, 10)
      assert.equal(result.value.calls[3].provider, 'beta')
      assert.equal(result.value.calls[3].model, 'retry-model')
      assert.equal(JSON.stringify(result).includes('private'), false)
    }
  )
  await t.test('빈 코퍼스는 실패가 아니라 성공적인 0이다', async () => {
    sessions = []
    const result = await read()
    assert.equal(result.value.totals.total, 0)
    assert.equal(result.value.totals.calls, 0)
    assert.equal(result.value.sessions, 0)
    assert.deepEqual(result.value.models, [])
    assert.deepEqual(result.value.calls, [])
    assert.equal(result.value.days.length, 7)
  })
})

await test('공유 날짜 검증은 실제 날짜와 순서 및 양 끝을 포함한 최대 366일을 검증한다', () => {
  assert.equal(maxRangeDays, 366)
  for (const [start, end] of [
    ['2024-02-29', '2024-02-29'],
    ['2024-01-01', '2024-12-31'],
    ['2026-01-01', '2027-01-01'],
  ]) {
    assert.equal(isValidDateRange(start, end), true)
  }
  for (const [start, end] of [
    ['2026-02-29', '2026-03-01'],
    ['2026-01-01', '2026-02-30'],
    ['2026-1-01', '2026-01-02'],
    ['2026-01-01', '2026-00-01'],
    ['2026-01-02', '2026-01-01'],
    ['2024-01-01', '2025-01-01'],
    ['', '2026-01-01'],
  ]) {
    assert.equal(isValidDateRange(start, end), false)
  }
})

await test('모든 대시보드 문자열을 지원하는 아홉 언어로 사용할 수 있다', () => {
  for (const language of ['ko', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']) {
    assert.deepEqual(Object.keys(copy[language]).sort(), Object.keys(copy.en).sort())
    for (const value of Object.values(copy[language])) assert.ok(value.trim())
  }
})
