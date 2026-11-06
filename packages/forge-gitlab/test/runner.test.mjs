import assert from 'node:assert/strict'
import test from 'node:test'
import { createGlabRunner } from '../src/runner.ts'

const runner = (options = {}) =>
  createGlabRunner({ glabCommand: process.execPath, timeoutMs: 5000, maxOutputBytes: 4096, ...options })
test('파일과 diff의 마지막 LF를 제거하지 않는다', async () => {
  const result = await runner()(['-e', 'process.stdout.write("fixture\\n")'], new AbortController().signal)
  assert.equal(result.stdout, 'fixture\n')
})
test('부모 환경의 토큰과 임의 GitLab 호스트를 전달하지 않고 프롬프트를 비활성화한다', async (t) => {
  const previous = { token: process.env.GITLAB_TOKEN, host: process.env.GITLAB_HOST }
  process.env.GITLAB_TOKEN = 'fixture-token-not-a-secret'
  process.env.GITLAB_HOST = 'foreign.invalid'
  t.after(() => {
    if (previous.token === undefined) delete process.env.GITLAB_TOKEN
    else process.env.GITLAB_TOKEN = previous.token
    if (previous.host === undefined) delete process.env.GITLAB_HOST
    else process.env.GITLAB_HOST = previous.host
  })
  const result = await runner()(
    [
      '-e',
      'process.stdout.write(JSON.stringify({token:!!process.env.GITLAB_TOKEN,host:!!process.env.GITLAB_HOST,prompt:process.env.GLAB_PROMPT_DISABLED}))',
    ],
    new AbortController().signal
  )
  assert.deepEqual(JSON.parse(result.stdout), { token: false, host: false, prompt: '1' })
})
test('시간과 출력 상한을 초과한 CLI를 성공으로 반환하지 않는다', async () => {
  await assert.rejects(runner({ timeoutMs: 20 })(['-e', 'setTimeout(()=>{},5000)'], new AbortController().signal))
  await assert.rejects(
    runner({ maxOutputBytes: 16 })(['-e', 'process.stdout.write("a".repeat(4096))'], new AbortController().signal)
  )
})
test('호출 전에 취소된 신호는 자식 명령을 시작하지 않고 취소 이유를 반환한다', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(runner()(['-e', 'process.exit(0)'], controller.signal), /cancelled/)
})
