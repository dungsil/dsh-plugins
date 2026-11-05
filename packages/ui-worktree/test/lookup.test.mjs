import assert from 'node:assert/strict'
import test from 'node:test'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { apply } from '../dist/index.js'

const output = 'worktree C:/repo\0HEAD abc\0branch refs/heads/main\0\0'

// Keep lifecycle and policy regressions independent of local Git and filesystem permissions.
function fixture(t, { mode = 'workspace-write', confine, spawn } = {}) {
  const session = Session.create(SessionId('lookup-test'))
  const policy = { mode, workspaceRoot: 'C:/repo', sessionId: session.id }
  const routes = new Map()
  const cleanups = []
  const confinements = []
  const children = []
  const ctx = {
    effect(start) {
      const cleanup = start()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    on() {},
    workspaceRegistry: { archivedSessionIds: [] },
    agents: { get: () => ({ session }) },
    workingDirectory: { get: () => 'C:/repo' },
    sandboxPolicy: { resolve: () => policy },
    sandbox: {
      async confine(argv, resolved, signal) {
        confinements.push({ argv, policy: resolved, signal })
        return confine ? confine(argv, resolved, signal) : { argv: ['sandbox', ...argv] }
      },
    },
    subprocess: {
      async resolveExecutable() {
        return 'git'
      },
      spawn(spec) {
        const state = { spec, terminated: false, waited: false }
        children.push(state)
        const child = spawn?.(spec, state) ?? {}
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text: output, lossy: false }) } },
          ...child,
          terminate() {
            state.terminated = true
            child.terminate?.()
          },
          async waitForExit() {
            const result = await child.waitForExit?.()
            state.waited = true
            return result ?? true
          },
        }
      },
    },
    connection: {
      fetch: {
        register(route) {
          routes.set(route.path, route)
        },
      },
    },
  }
  apply(ctx, {
    defaultSelection: 'current',
    directory: '.agents/worktrees',
    remote: false,
    deleteOnArchive: false,
    naming: 'semantic',
    prefix: '',
  })
  const dispose = () =>
    cleanups
      .splice(0)
      .reverse()
      .forEach((cleanup) => cleanup())
  t.after(dispose)
  const lookup = async (signal) => {
    const method = 'dungsil-worktree/describe'
    const response = await routes.get(`/api/${method}`).fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        signal,
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload: { sessionId: session.id } }),
      })
    )
    return (await response.json()).result
  }
  return { session, policy, confinements, children, lookup, dispose }
}

for (const mode of ['read-only', 'workspace-write', 'danger-full-access']) {
  await test(`${mode} 세션의 조회는 기존 정책을 바꾸지 않고 필요한 읽기 격리만 적용한다`, async (t) => {
    const h = fixture(t, { mode })
    const before = h.session.snapshotEvents()
    const result = await h.lookup()
    assert.equal(result.ok, true)
    assert.deepEqual(result.value.worktrees, [{ path: 'C:/repo', branch: 'main' }])
    assert.equal(h.policy.mode, mode)
    assert.deepEqual(h.session.snapshotEvents(), before)
    assert.equal(h.confinements.length, mode === 'danger-full-access' ? 0 : 1)
    if (h.confinements.length) assert.deepEqual(h.confinements[0].policy, { ...h.policy, mode: 'read-only' })
    assert.equal(h.children[0].spec.argv[0], mode === 'danger-full-access' ? 'git' : 'sandbox')
    assert.equal(h.children[0].terminated, true)
    assert.equal(h.children[0].waited, true)
  })
}

await test('이미 취소된 조회는 격리 준비나 자식 실행을 시작하지 않는다', async (t) => {
  const h = fixture(t)
  const before = h.session.snapshotEvents()
  const controller = new AbortController()
  controller.abort()
  assert.equal((await h.lookup(controller.signal)).ok, false)
  assert.equal(h.confinements.length, 0)
  assert.equal(h.children.length, 0)
  assert.deepEqual(h.session.snapshotEvents(), before)
})

await test('읽기 격리에 실패한 조회는 쓰기 모드나 비격리 실행으로 재시도하지 않는다', async (t) => {
  const h = fixture(t, {
    confine() {
      throw new Error('Sandbox unavailable')
    },
  })
  assert.equal((await h.lookup()).error.code, 'operation_failed')
  assert.equal(h.confinements.length, 1)
  assert.equal(h.confinements[0].policy.mode, 'read-only')
  assert.equal(h.children.length, 0)
})

await test('한 조회를 취소해도 동시 조회는 취소하지 않으며 두 자식의 종료를 기다린다', async (t) => {
  const started = Promise.withResolvers()
  const finish = Promise.withResolvers()
  const h = fixture(t, {
    spawn(spec) {
      started.resolve()
      return {
        done: new Promise((resolve, reject) => {
          spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true })
          finish.promise.then(() => resolve({ exitCode: 0, signal: null }))
        }),
      }
    },
  })
  const controller = new AbortController()
  const cancelled = h.lookup(controller.signal)
  const concurrent = h.lookup()
  await started.promise
  controller.abort()
  finish.resolve()
  assert.equal((await cancelled).ok, false)
  assert.equal((await concurrent).ok, true)
  assert.equal(h.confinements.length, 2)
  assert.ok(h.confinements.every(({ policy }) => policy.mode === 'read-only'))
  assert.equal(h.children[0].spec.signal.aborted, true)
  assert.equal(h.children[1].spec.signal.aborted, false)
  assert.ok(h.children.every((child) => child.terminated && child.waited))
})

await test('자식 종료를 기다리는 중 취소된 조회는 성공 응답을 반환하지 않는다', async (t) => {
  const waiting = Promise.withResolvers()
  const exited = Promise.withResolvers()
  const h = fixture(t, {
    spawn() {
      return {
        waitForExit() {
          waiting.resolve()
          return exited.promise
        },
      }
    },
  })
  const controller = new AbortController()
  const pending = h.lookup(controller.signal)
  await waiting.promise
  controller.abort()
  exited.resolve(true)
  assert.equal((await pending).ok, false)
  assert.equal(h.children[0].waited, true)
})

await test('플러그인이 해제되면 진행 중인 조회를 취소하고 자식 종료를 기다린다', async (t) => {
  const started = Promise.withResolvers()
  const h = fixture(t, {
    spawn(spec) {
      started.resolve()
      return {
        done: new Promise((_, reject) => {
          spec.signal.addEventListener('abort', () => reject(spec.signal.reason), { once: true })
        }),
      }
    },
  })
  const pending = h.lookup()
  await started.promise
  h.dispose()
  assert.equal((await pending).ok, false)
  assert.equal(h.children[0].spec.signal.aborted, true)
  assert.equal(h.children[0].terminated, true)
  assert.equal(h.children[0].waited, true)
})
