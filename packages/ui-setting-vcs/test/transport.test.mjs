import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { channel, readMethod, saveMethod } from '../src/protocol.ts'

await test('설정 조회와 저장은 실제 브라우저 RPC 채널 검증을 통과한다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const calls = []
  installConnection(ctx, {
    transport: {
      async fetch(url, options) {
        const request = JSON.parse(options.body)
        calls.push({ url, method: request.method })
        return Response.json({
          type: 'server-response',
          rpcId: request.rpcId,
          result: { ok: true, value: { entries: [] } },
        })
      },
    },
  })
  for (const method of [readMethod, saveMethod]) {
    const result = await ctx.get('connection').rpc.call(channel, method, {})
    assert.equal(result.ok, true)
  }
  assert.deepEqual(
    calls,
    [readMethod, saveMethod].map((method) => ({ url: `api/${method}`, method }))
  )
})
