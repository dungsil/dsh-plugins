import assert from 'node:assert/strict'
import test from 'node:test'
import { createTaskQueue } from '../src/index.ts'

function deferred() {
  return Promise.withResolvers()
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

await test('동시 실행 수를 제한하고 먼저 대기한 작업부터 실행한다', async () => {
  const run = createTaskQueue({ concurrency: 2, maxPending: 100 })
  const signal = new AbortController().signal
  const started = []
  let active = 0
  let peak = 0
  const gates = Array.from({ length: 20 }, deferred)
  const tasks = gates.map((gate, index) =>
    run(signal, async () => {
      started.push(index)
      peak = Math.max(peak, ++active)
      await gate.promise
      active--
      return index
    })
  )
  assert.deepEqual(started, [0, 1])
  for (const gate of gates) {
    gate.resolve()
    await tick()
  }
  assert.deepEqual(
    await Promise.all(tasks),
    gates.map((_, index) => index)
  )
  assert.deepEqual(
    started,
    gates.map((_, index) => index)
  )
  assert.equal(peak, 2)
})

await test('실행 중인 작업을 취소해도 종료 정리가 끝나기 전에는 슬롯을 반환하지 않는다', async () => {
  const run = createTaskQueue({ concurrency: 1, maxPending: 2 })
  const controller = new AbortController()
  const cleanup = deferred()
  let entered = false
  const first = run(controller.signal, async () => {
    await cleanup.promise
    controller.signal.throwIfAborted()
  })
  const rejected = assert.rejects(first, { name: 'AbortError' })
  controller.abort()
  const second = run(new AbortController().signal, async () => {
    entered = true
  })
  await tick()
  assert.equal(entered, false)
  cleanup.resolve()
  await rejected
  await second
  assert.equal(entered, true)
})

await test('대기 중 취소한 작업은 실행하지 않고 대기 한도를 반환한다', async () => {
  const run = createTaskQueue({ concurrency: 1, maxPending: 1 })
  const gate = deferred()
  const first = run(new AbortController().signal, () => gate.promise)
  const controller = new AbortController()
  let entered = false
  const cancelled = run(controller.signal, async () => {
    entered = true
  })
  const rejected = assert.rejects(cancelled, { name: 'AbortError' })
  controller.abort()
  await rejected
  const next = run(new AbortController().signal, async () => 'next')
  gate.resolve()
  await first
  assert.equal(await next, 'next')
  assert.equal(entered, false)
})

await test('대기열이 가득 차면 추가 작업을 실행하지 않고 busy로 거부한다', async () => {
  const run = createTaskQueue({ concurrency: 1, maxPending: 0 })
  const gate = deferred()
  const first = run(new AbortController().signal, () => gate.promise)
  await assert.rejects(
    run(new AbortController().signal, async () => assert.fail()),
    /busy/
  )
  gate.resolve()
  await first
})

await test('이미 취소된 작업은 빈 큐에서도 실행하지 않는다', async () => {
  const run = createTaskQueue({ concurrency: 1, maxPending: 0 })
  await assert.rejects(
    run(AbortSignal.abort(), async () => assert.fail()),
    { name: 'AbortError' }
  )
  assert.equal(await run(new AbortController().signal, async () => 'ready'), 'ready')
})

await test('동기 예외와 비동기 거부 뒤에도 다음 작업을 실행한다', async () => {
  const run = createTaskQueue({ concurrency: 1, maxPending: 2 })
  const signal = new AbortController().signal
  await assert.rejects(
    run(signal, () => {
      throw new Error('sync')
    }),
    /sync/
  )
  const gate = deferred()
  const first = run(signal, async () => {
    await gate.promise
    throw new Error('async')
  })
  const rejected = assert.rejects(first, /async/)
  const next = run(signal, async () => 'ready')
  gate.resolve()
  await rejected
  assert.equal(await next, 'ready')
})

await test('잘못된 동시 실행 수와 대기 한도를 허용하지 않는다', () => {
  for (const concurrency of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => createTaskQueue({ concurrency, maxPending: 1 }), RangeError)
  for (const maxPending of [-1, 1.5, NaN, Infinity])
    assert.throws(() => createTaskQueue({ concurrency: 1, maxPending }), RangeError)
})
