import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'deny' }
const tick = () => new Promise((resolve) => setImmediate(resolve))

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-vcs-limits-'))
  const ctx = new Context()
  ctx.provide('forge', { register() {} })
  ctx.provide('forgeSession', { changeRequests: () => [] })
  let released = false
  let active = 0
  let peak = 0
  const children = []
  const inspections = []
  const reads = []
  const closes = []
  t.after(async () => {
    released = true
    for (const child of children) child.release()
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  ctx.provide('subprocess', {
    resolveExecutable: async (_command, _env, signal) => {
      signal.throwIfAborted()
      return 'git'
    },
    spawn(spec) {
      spec.signal.throwIfAborted()
      const exit = Promise.withResolvers()
      const child = { release: () => exit.resolve(), terminated: false, spec }
      children.push(child)
      peak = Math.max(peak, ++active)
      return {
        done: Promise.resolve({ exitCode: 2, signal: null }),
        collected: { stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
        terminate: () => {
          child.terminated = true
        },
        async waitForExit() {
          if (!released) await exit.promise
          active--
          return true
        },
      }
    },
  })
  ctx.provide('workingDirectory', { get: () => home })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) })
  ctx.provide('sandbox', {})
  ctx.provide('sessionController', {
    resolveAgent: () => assert.fail('읽기 조회는 Agent를 활성화하지 않는다'),
  })
  ctx.provide('sessionPersistence', {
    open: async (id, access, { signal }) => {
      assert.equal(access, 'read')
      signal.throwIfAborted()
      inspections.push(id)
      return {
        header: { version: SESSION_FORMAT_VERSION, id, cwd: home, createdAt: 0, isSeeded: false },
        inheritedEventCount: 0,
        read: async (start, end, options) => {
          assert.equal(start, undefined)
          assert.equal(end, undefined)
          assert.equal(options.signal, signal)
          signal.throwIfAborted()
          reads.push(id)
          return { events: [] }
        },
        close: async () => {
          closes.push(id)
        },
      }
    },
  })
  const fork = ctx.plugin(plugin, { provider: 'auto' })
  await fork
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (method, id, signal) => {
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: id, method, payload: { sessionId: id, summary: true } }),
      }),
      owner
    )
    assert.equal(response.status, 200)
    return (await response.json()).result
  }
  return {
    rpc,
    children,
    inspections,
    reads,
    closes,
    fork,
    peak: () => peak,
    active: () => active,
    release() {
      released = true
      for (const child of children) child.release()
    },
  }
}
const describe = 'dungsil-vcs/describe'
const list = 'dungsil-vcs/describe'

await test('Git 문맥 조회는 실행 한도를 지키고 자식 종료 정리 전에는 다음 조회를 시작하지 않는다', async (t) => {
  const f = await fixture(t)
  const requests = Array.from({ length: 24 }, (_, index) => f.rpc(index % 2 ? list : describe, `session-${index}`))
  await tick()
  assert.equal(f.children.length, 2)
  assert.equal(f.active(), 2)
  assert.equal(f.inspections.length, 2)
  assert.ok(f.children.every((child) => child.terminated))
  f.release()
  const results = await Promise.all(requests)
  assert.ok(results.every((result) => !result.ok))
  assert.equal(f.children.length, 24)
  assert.equal(f.peak(), 2)
  assert.equal(f.active(), 0)
  assert.deepEqual(f.reads, f.inspections)
  assert.deepEqual(f.closes, f.inspections)
})

await test('대기 중 취소된 VCS 조회는 세션 검사와 자식 프로세스를 시작하지 않는다', async (t) => {
  const f = await fixture(t)
  const first = f.rpc(describe, 'first')
  const second = f.rpc(list, 'second')
  await tick()
  const controller = new AbortController()
  const cancelled = f.rpc(list, 'cancelled', controller.signal)
  await tick()
  controller.abort()
  assert.equal((await cancelled).ok, false)
  assert.deepEqual(f.inspections, ['first', 'second'])
  assert.deepEqual(f.closes, ['first', 'second'])
  assert.equal(f.children.length, 2)
  f.release()
  await Promise.all([first, second])
})

await test('플러그인을 해제하면 실행 중인 Git 문맥을 취소하고 대기 조회는 시작하지 않는다', async (t) => {
  const f = await fixture(t)
  const first = f.rpc(describe, 'first')
  const second = f.rpc(list, 'second')
  await tick()
  const queued = f.rpc(describe, 'queued')
  await tick()
  const disposing = f.fork.dispose()
  await tick()
  assert.ok(f.children.every((child) => child.spec.signal.aborted))
  assert.equal((await queued).ok, false)
  assert.equal(f.children.length, 2)
  f.release()
  await Promise.all([first, second, disposing])
})
