import assert from 'node:assert/strict'
import test from 'node:test'
import { createTeaRunner } from '../dist/index.js'

const runner = (options = {}) =>
  createTeaRunner({ teaCommand: process.execPath, timeoutMs: 3000, maxOutputBytes: 1024, ...options })
await test('runner는 제한 시간을 넘는 자식을 종료하고 timeout으로 실패한다', async () => {
  await assert.rejects(
    runner({ timeoutMs: 100 })(['-e', 'setTimeout(() => {}, 10000)'], new AbortController().signal),
    /timed out/
  )
})
await test('runner는 출력 상한을 넘는 자식을 종료하고 too-large로 실패한다', async () => {
  await assert.rejects(
    runner()(['-e', 'process.stdout.write("x".repeat(4096))'], new AbortController().signal),
    (error) => error.code === 'too-large'
  )
})
await test('runner는 파일과 diff의 마지막 개행을 제거하지 않는다', async () => {
  const result = await runner()(['-e', 'process.stdout.write("fixture\\n")'], new AbortController().signal)
  assert.equal(result.stdout, 'fixture\n')
})
await test('runner는 잘못된 실행 설정을 프로세스 시작 전에 거부한다', () => {
  for (const timeoutMs of [0, 1.5, 2147483648]) assert.throws(() => runner({ timeoutMs }), /timeoutMs/)
  for (const maxOutputBytes of [0, 1.5, Number.POSITIVE_INFINITY])
    assert.throws(() => runner({ maxOutputBytes }), /maxOutputBytes/)
  assert.throws(() => runner({ teaCommand: ' ' }), /teaCommand/)
})
await test('runner는 이미 취소된 호출을 시작하지 않고 원래 취소 이유를 전파한다', async () => {
  const abort = new AbortController()
  const reason = new Error('취소')
  abort.abort(reason)
  await assert.rejects(runner()(['-e', 'process.exit(0)'], abort.signal), (error) => error === reason)
})
