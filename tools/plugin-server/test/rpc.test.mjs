import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRpcRequest, rpcResponse } from '../src/rpc.ts'

const envelope = (method, rpcId = 'rpc-1', payload = { a: 1 }) =>
  new Request('https://host/api/x', {
    method: 'POST',
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    headers: { 'content-type': 'application/json' },
  })

await test('유효한 요청 봉투는 rpcId와 payload를 그대로 전달한다', async () => {
  const parsed = await parseRpcRequest(envelope('plugin/read'), 'plugin/read')
  assert.deepEqual(parsed, { rpcId: 'rpc-1', payload: { a: 1 } })
})

await test('JSON을 해석할 수 없으면 null을 반환한다', async () => {
  const request = new Request('https://host/api/x', {
    method: 'POST',
    body: '{oops',
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(await parseRpcRequest(request, 'plugin/read'), null)
})

await test('메서드가 일치하지 않으면 null을 반환한다', async () => {
  assert.equal(await parseRpcRequest(envelope('plugin/save'), 'plugin/read'), null)
})

await test('봉투 스키마를 벗어나면 null을 반환한다', async () => {
  const request = new Request('https://host/api/x', {
    method: 'POST',
    body: JSON.stringify({ type: 'server-response', rpcId: 'rpc-1', result: { ok: true, value: null } }),
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(await parseRpcRequest(request, 'plugin/read'), null)
})

await test('응답 봉투는 server-response와 no-store 캐시 헤더를 유지한다', () => {
  const response = rpcResponse('rpc-1', { ok: true, value: 7 })
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return response.json().then((body) => {
    assert.deepEqual(body, { type: 'server-response', rpcId: 'rpc-1', result: { ok: true, value: 7 } })
  })
})
