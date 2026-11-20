import assert from 'node:assert/strict'
import test from 'node:test'
import { draftOf, entryOf } from '../src/draft.ts'
import { isMcpName } from '../src/model.ts'
import { hasSettingsOverride } from '../src/runtime.ts'

await test('서버 이름은 안전한 문자만 허용한다', () => {
  assert.equal(isMcpName('server_1'), true)
  assert.equal(isMcpName('../oops'), false)
  assert.equal(isMcpName(''), false)
  assert.equal(isMcpName('a'.repeat(33)), false)
})

await test('기존의 고급 설정과 명시적 비밀값을 보존한다', () => {
  const original = { transport: 'stdio', command: 'node', env: { TOKEN: 'value' }, reconnect: { maxAttempts: 2 } }
  const result = entryOf({ ...draftOf('good', original), command: 'npx' }, original)
  assert.equal(result.command, 'npx')
  assert.deepEqual(result.reconnect, { maxAttempts: 2 })
  assert.deepEqual(result.env, { TOKEN: 'value' })
})

await test('HTTP 전환은 이전 stdio 필드를 비운다', () => {
  const original = { transport: 'stdio', command: 'node', args: ['-y'], env: { SECRET: 'unused' } }
  const draft = { ...draftOf('server', original), transport: 'streamable-http', url: 'https://example.com/mcp' }
  const result = entryOf(draft, original)
  assert.equal(result.transport, 'streamable-http')
  assert.equal(result.command, '')
  assert.deepEqual(result.args, [])
  assert.deepEqual(result.env, {})
})

await test('잘못된 인수와 환경 템플릿을 거부한다', () => {
  assert.equal(entryOf({ ...draftOf('ok'), command: 'node', args: '{"bad":true}' }), undefined)
  assert.equal(entryOf({ ...draftOf('ok'), command: 'echo ${HOME}' }), undefined)
  assert.equal(
    entryOf({ ...draftOf('ok'), command: 'node', args: '["x"]', env: '{"K":"${credential:REF}"}' })?.command,
    'node'
  )
})

await test('false 및 사용자 제공 설정을 올바르게 재정의로 인식한다', () => {
  assert.equal(hasSettingsOverride({ servers: { a: { enabled: false } } }, ['servers', 'a', 'enabled']), true)
  assert.equal(hasSettingsOverride({ servers: { a: {} } }, ['servers', 'a', 'enabled']), false)
  assert.equal(hasSettingsOverride({}, ['servers', 'constructor']), false)
})
