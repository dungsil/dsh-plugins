import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply } from '../dist/index.js'

async function setup(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-picker-test-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const origin = join(temporary, 'origin')
  const target = join(temporary, 'registered')
  const other = join(temporary, 'unregistered')
  await Promise.all([origin, target, other].map((path) => mkdir(path)))
  const canonical = await Promise.all([origin, target, other].map((path) => realpath(path)))
  const session = { id: 'one', header: { cwd: origin } }
  const agent = {
    session,
    status: 'idle',
    async runMaintenance(task) {
      if (this.maintenance) throw Error('busy')
      this.maintenance = true
      try {
        return await task(new AbortController().signal)
      } finally {
        this.maintenance = false
      }
    },
  }
  const hostConnection = new HostConnectionService(new Context(), [], {})
  const handler = hostConnection.createSharedFetchHandler('/api')
  let current = canonical[0]
  let attached = true
  let state = { started: false, requested: false, created: false }
  let listener
  let beforeSet
  let mapping = (path) => path
  let execution = (path) => path
  let policy = { mode: 'danger-full-access' }
  let confineError = false
  let wrongRoot = false
  let exitCode = 0
  const calls = { spawn: [], confine: [], terminate: 0, wait: 0 }
  let differentRepository = false
  let git = `worktree ${origin}\0HEAD a\0branch refs/heads/main\0\0worktree ${target}\0HEAD b\0branch refs/heads/feature\0\0`
  const ctx = {
    agents: { get: (id) => (id === 'one' ? agent : undefined) },
    sessions: { get: (id) => (id === 'one' && attached ? session : undefined) },
    sessionProjections: { register: async () => ({ stateOf: () => state }) },
    workingDirectory: {
      get: () => current,
      async set(_agent, path, signal) {
        beforeSet?.()
        signal.throwIfAborted()
        current = path
        return path
      },
    },
    fs: {
      resolve: async (path) => realpath(path),
      processPath: (path) => execution(path),
      processPathFromHostPath: (path) => mapping(path),
    },
    sandboxPolicy: { resolve: () => policy },
    sandbox: {
      confine: async (argv, received, signal) => {
        calls.confine.push({ argv, policy: received, signal })
        if (confineError) throw Error('denied')
        return { argv: ['confined', ...argv] }
      },
    },
    subprocess: {
      resolveExecutable: async () => 'git',
      spawn: (spec) => {
        calls.spawn.push(spec)
        const selected = spec.cwd === execution(canonical[1])
        const text = spec.argv.includes('list')
          ? git
          : spec.argv.includes('--show-toplevel')
            ? selected && !wrongRoot
              ? canonical[1]
              : canonical[0]
            : differentRepository && selected
              ? canonical[1]
              : canonical[0]
        return {
          done: Promise.resolve({ exitCode }),
          collected: { stdout: { readFrom: () => ({ text, lossy: false }) } },
          terminate() {
            calls.terminate++
          },
          async waitForExit() {
            calls.wait++
          },
        }
      },
    },
    connection: hostConnection,
    effect: (fn) => fn(),
    inject: () => {},
    on: (_event, fn) => {
      listener = fn
      return () => {
        listener = undefined
      }
    },
  }
  await apply(ctx, { defaultCheckout: { get: () => 'current' } })
  let connection
  installConnection(
    {
      provide: (_name, handle) => {
        connection = handle
      },
    },
    {
      transport: {
        fetch: async (path, init) => {
          const request = new Request(new URL(path, 'http://localhost/'), init)
          const response = await handler.fetch(request, { principal: { kind: 'owner' } })
          assert.equal(response.headers.get('cache-control'), 'no-store')
          return response
        },
      },
    }
  )
  const call = (method, payload) => connection.rpc.call('/api', `dungsil-worktree-picker/${method}`, payload)
  return {
    agent,
    session,
    call,
    handler,
    canonical,
    calls,
    setMapping: (value) => {
      mapping = value
    },
    setExecution: (value) => {
      execution = value
    },
    setPolicy: (value) => {
      policy = value
    },
    rejectConfine: () => {
      confineError = true
    },
    setWrongRoot: () => {
      wrongRoot = true
    },
    failGit: () => {
      exitCode = 1
    },
    replaceRepository: () => {
      differentRepository = true
    },
    detach: () => {
      attached = false
    },
    setState: (value) => {
      state = value
    },
    setGit: (value) => {
      git = value
    },
    setBeforeSet: (fn) => {
      beforeSet = fn
    },
    emit: (event) => listener?.(session, event),
    getCurrent: () => current,
  }
}

await test('소유자가 아닌 연결은 목록과 진입 경로에 접근하지 못한다', async (t) => {
  const h = await setup(t)
  for (const method of ['list', 'enter']) {
    const request = new Request(`http://localhost/api/dungsil-worktree-picker/${method}`, { method: 'POST' })
    const response = await h.handler.fetch(request, { principal: { kind: 'remote' } })
    assert.equal(response.status, 403)
  }
  assert.equal(h.getCurrent(), h.canonical[0])
})

await test('파일시스템 실행 세계의 매핑이 없거나 일치하지 않으면 목록과 진입을 거부한다', async (t) => {
  const h = await setup(t)
  for (const mapping of [() => undefined, (path) => `${path}-different`]) {
    h.setMapping(mapping)
    assert.equal((await h.call('list', { sessionId: 'one' })).ok, false)
    assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
    assert.equal(h.getCurrent(), h.canonical[0])
  }
})

await test('원래 디렉터리가 상위 저장소의 워크트리 루트가 아니면 목록과 진입을 거부한다', async (t) => {
  const h = await setup(t)
  const parent = dirname(h.canonical[0])
  h.setGit(
    `worktree ${parent}\0HEAD a\0branch refs/heads/main\0\0worktree ${h.canonical[1]}\0HEAD b\0branch refs/heads/feature\0\0`
  )
  assert.equal((await h.call('list', { sessionId: 'one' })).ok, false)
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
  assert.equal(h.getCurrent(), h.canonical[0])
})

await test('등록된 경로가 다른 저장소로 교체되면 진입을 거부한다', async (t) => {
  const h = await setup(t)
  h.replaceRepository()
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
  assert.equal(h.getCurrent(), h.canonical[0])
})

await test('실행 세계 경로가 호스트 경로와 다르면 Git과 디렉터리 변경에 실행 경로를 사용한다', async (t) => {
  const h = await setup(t)
  const mapped = (path) => `exec:${path}`
  h.setMapping(mapped)
  h.setExecution(mapped)
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, true)
  assert.equal(h.getCurrent(), mapped(h.canonical[1]))
  assert.deepEqual(
    h.calls.spawn.map((s) => s.cwd),
    [mapped(h.canonical[0]), mapped(h.canonical[0]), mapped(h.canonical[1]), mapped(h.canonical[1])]
  )
})

await test('제한된 세션의 Git 명령은 동일한 정책으로 감싸고 거부되면 실행하지 않는다', async (t) => {
  const h = await setup(t)
  const policy = { mode: 'read-only', workspaceRoot: h.canonical[0], sessionId: 'one' }
  h.setPolicy(policy)
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, true)
  assert.equal(h.calls.confine.length, 4)
  for (let i = 0; i < h.calls.confine.length; i++) {
    const call = h.calls.confine[i]
    assert.equal(call.policy, policy)
    assert.ok(call.signal instanceof AbortSignal)
    assert.deepEqual(call.argv.slice(0, 6), [
      'git',
      '--no-optional-locks',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
    ])
    assert.deepEqual(h.calls.spawn[i].argv, ['confined', ...call.argv])
  }
  const other = await setup(t)
  other.setPolicy(policy)
  other.rejectConfine()
  assert.equal((await other.call('list', { sessionId: 'one' })).ok, false)
  assert.equal((await other.call('enter', { sessionId: 'one', path: other.canonical[1] })).ok, false)
  assert.equal(other.calls.spawn.length, 0)
  assert.equal(other.getCurrent(), other.canonical[0])
})

await test('공통 Git 디렉터리가 같아도 최상위 디렉터리가 다르면 진입을 거부한다', async (t) => {
  const h = await setup(t)
  h.setWrongRoot()
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
  assert.equal(h.getCurrent(), h.canonical[0])
})

await test('Git 환경에서 저장소 선택자를 지우고 실패해도 프로세스를 정리한다', async (t) => {
  const h = await setup(t)
  h.failGit()
  assert.equal((await h.call('list', { sessionId: 'one' })).ok, false)
  const spec = h.calls.spawn[0]
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR']) {
    assert.ok(Object.hasOwn(spec.env, key))
    assert.equal(spec.env[key], undefined)
  }
  assert.equal(spec.env.GIT_CONFIG_COUNT, '0')
  assert.equal(h.calls.terminate, 1)
  assert.equal(h.calls.wait, 1)
})

await test('등록된 워크트리만 진입하고 임의 경로는 거부한다', async (t) => {
  const h = await setup(t)
  const list = await h.call('list', { sessionId: 'one' })
  assert.equal(list.ok, true)
  assert.deepEqual(
    list.value.worktrees.map((row) => row.path),
    [h.canonical[1]]
  )
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[2] })).ok, false)
  assert.equal(h.getCurrent(), h.canonical[0])
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, true)
  assert.equal(h.getCurrent(), h.canonical[1])
})

await test('실행 중이거나 시작된 세션과 요청이 남은 세션의 진입을 거부한다', async (t) => {
  const h = await setup(t)
  h.agent.status = 'running'
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
  h.agent.status = 'idle'
  h.setState({ started: true, requested: false, created: false })
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
  h.setState({ started: false, requested: true, created: false })
  assert.equal((await h.call('list', { sessionId: 'one' })).ok, true)
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
})

await test('진입 중 새 Forge 요청이 생기면 디렉터리 변경을 중단한다', async (t) => {
  const h = await setup(t)
  h.setBeforeSet(() => h.emit({ type: 'plugin:client-ui-forge/worktree', data: { action: 'request' } }))
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
  assert.equal(h.getCurrent(), h.canonical[0])
})

await test('등록 해제된 세션은 실행 가능한 Agent가 남아 있어도 진입을 거부한다', async (t) => {
  const h = await setup(t)
  h.detach()
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
  assert.equal(h.getCurrent(), h.canonical[0])
})

await test('최신 Git 목록에서 제거된 경로는 이전 목록이 있더라도 거부한다', async (t) => {
  const h = await setup(t)
  assert.equal((await h.call('list', { sessionId: 'one' })).ok, true)
  h.setGit(`worktree ${h.canonical[0]}\0HEAD a\0branch refs/heads/main\0\0`)
  assert.equal((await h.call('enter', { sessionId: 'one', path: h.canonical[1] })).ok, false)
  assert.equal(h.getCurrent(), h.canonical[0])
})
