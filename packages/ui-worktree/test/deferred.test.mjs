import assert from 'node:assert/strict'
import test from 'node:test'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { apply } from '../dist/index.js'

// These are Host state-machine tests, not substitutes for real Git/sandbox integration.
function fixture(t, config = {}) {
  const session = Session.create(SessionId('deferred-worktree'))
  let cwd = 'C:/repo'
  const routes = new Map()
  const listeners = new Map()
  const cleanups = []
  const commands = []
  const changes = []
  const work = []
  const effects = { ensure: 0, maintenance: 0, flush: 0, naming: 0 }
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    options: { provider: 'test', model: 'test' },
    inbox: { nextTurn: [], nextStep: [] },
    runMaintenance(task) {
      effects.maintenance++
      return task(new AbortController().signal)
    },
  }
  const ctx = {
    effect(start) {
      const cleanup = start()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    inject() {},
    on(name, listener) {
      listeners.set(name, listener)
    },
    workspaceRegistry: { archivedSessionIds: [] },
    agents: { get: () => agent },
    sessionController: { resolveAgent: async () => ({ agent }) },
    sessions: {
      async flush() {
        effects.flush++
      },
    },
    workingDirectory: {
      get: () => cwd,
      async ensure() {
        effects.ensure++
        return cwd
      },
      async set(_agent, path, signal) {
        signal.throwIfAborted()
        changes.push(path)
        cwd = path
        session.append('working-directory/change', { cwd })
        return cwd
      },
    },
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access', workspaceRoot: 'C:/repo', sessionId: agent.id }) },
    subprocess: {
      resolveExecutable: async (name) => name,
      spawn(spec) {
        commands.push(spec)
        const args = spec.argv
        let text = ''
        if (args.includes('list')) {
          text = 'worktree C:/repo\0branch refs/heads/main\0\0worktree C:/other\0branch refs/heads/feature/other\0\0'
        } else if (args.includes('rev-parse')) {
          text = args.includes('--show-toplevel') ? spec.cwd : 'abc123'
          text += '\n'
        } else if (args.includes('--input-type=module')) {
          text = JSON.stringify('C:/repo/.agents/worktrees/fix/deferred')
        }
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: { stdout: { readFrom: () => ({ text, lossy: false }) } },
          terminate() {},
          async waitForExit() {
            return true
          },
        }
      },
    },
    llm: {
      async prepareCall() {
        effects.naming++
        return {
          config: {},
          async *stream() {
            yield { type: 'text-delta', index: 0, text: 'fix/deferred' }
            yield { type: 'finish', reason: { kind: 'stop' } }
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
    ...config,
  })
  t.after(() => cleanups.reverse().forEach((cleanup) => cleanup()))
  const rpc = async (endpoint, payload = {}) => {
    const method = `dungsil-worktree/${endpoint}`
    const route = routes.get(`/api/${method}`)
    if (!route) return { status: 404 }
    const response = await route.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method,
          payload: { sessionId: agent.id, cwd, ...payload },
        }),
      })
    )
    return (await response.json()).result
  }
  const admit = (text = 'Implement the selected task', kind = 'user') => {
    const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind } })
    agent.inbox.nextTurn.push(message)
    listeners.get('agent/inbox/inserted')({ agent, message })
    return message
  }
  const enter = async (messages, decision = { kind: 'enter', messages, startsRequestSeries: true }) => {
    agent.inbox.nextTurn = agent.inbox.nextTurn.filter((message) => !messages.includes(message))
    for (const message of messages) listeners.get('agent/inbox/claimed')({ agent, message, turn: 1 })
    agent.status = 'running'
    try {
      const result = await listeners.get('agent/pre-step')(
        { agent, messages, signal: new AbortController().signal },
        async () => {
          if (decision instanceof Error) throw decision
          return decision
        }
      )
      if (result.kind === 'enter') work.push(cwd)
      return result
    } finally {
      agent.status = 'idle'
    }
  }
  const discard = (message) => {
    agent.inbox.nextTurn = agent.inbox.nextTurn.filter((entry) => entry !== message)
    listeners.get('agent/inbox/discarded')({ agent, message })
  }
  return {
    ctx,
    agent,
    session,
    commands,
    changes,
    work,
    effects,
    rpc,
    admit,
    enter,
    discard,
    get cwd() {
      return cwd
    },
  }
}

await test('새 워크트리와 현재 경로를 선택할 때는 값만 바꾸고 Git이나 유지 보수를 실행하지 않는다', async (t) => {
  const h = fixture(t)
  const before = h.session.snapshotEvents()
  const reserved = await h.rpc('select', { choice: 'new' })
  assert.deepEqual(reserved, { ok: true, value: { cwd: 'C:/repo', pendingCreation: { name: '', failed: false } } })
  assert.deepEqual(await h.rpc('select', { choice: 'current' }), { ok: true, value: { cwd: 'C:/repo' } })
  assert.equal(h.cwd, 'C:/repo')
  assert.deepEqual(h.commands, [])
  assert.deepEqual(h.effects, { ensure: 0, maintenance: 0, flush: 0, naming: 0 })
  assert.deepEqual(h.session.snapshotEvents(), before)
  await h.enter([h.admit()])
  assert.deepEqual(h.work, ['C:/repo'])
  assert.deepEqual(h.commands, [], 'Cancelling creation must not leave Git work for submission either')
})

await test('기존 워크트리 선택과 switch 경로는 부작용 없이 거부한다', async (t) => {
  const h = fixture(t)
  assert.equal((await h.rpc('select', { choice: 'existing', path: 'C:/other' })).error.code, 'invalid')
  assert.deepEqual(await h.rpc('switch', { path: 'C:/other' }), { status: 404 })
  assert.deepEqual(h.commands, [])
  assert.deepEqual(h.changes, [])
  const message = h.admit()
  const decision = { kind: 'enter', messages: [message], startsRequestSeries: true }
  assert.equal(await h.enter([message], decision), decision)
  assert.deepEqual(h.work, ['C:/repo'])
  assert.equal((await h.rpc('describe')).value.locked, true)
})

await test('새 워크트리는 전송 전에는 이름을 짓거나 생성하지 않고 진입할 때 한 번만 준비한다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  assert.equal(h.effects.naming, 0)
  assert.deepEqual(h.commands, [])
  assert.deepEqual(h.changes, [])
  await h.enter([h.admit()])
  assert.equal(h.effects.naming, 1)
  assert.equal(h.cwd, 'C:/repo/.agents/worktrees/fix/deferred')
  assert.deepEqual(h.work, [h.cwd])
  assert.equal(h.commands.filter(({ argv }) => argv.includes('worktree') && argv.includes('add')).length, 1)
  const count = h.commands.length
  await h.enter([h.admit('Continue')])
  assert.equal(h.commands.length, count)
  assert.equal(h.effects.naming, 1)
})

await test('실패한 생성 예약은 자동 재시도하지 않고 현재 선택으로 취소하면 위치를 고정한다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  h.ctx.llm.prepareCall = async () => {
    throw new Error('Naming unavailable')
  }
  await assert.rejects(h.enter([h.admit()]), /Worktree creation could not be confirmed/)
  assert.deepEqual(h.work, [])
  assert.deepEqual(h.changes, [])
  const failed = (await h.rpc('describe')).value
  assert.equal(failed.pendingCreation.failed, true)
  assert.equal(failed.locked, undefined)
  const count = h.commands.length
  await assert.rejects(h.enter([]), /needs confirmation/, 'Automatic continuation must not bypass a failed selection')
  await assert.rejects(h.enter([h.admit('Retry without confirmation')]), /needs confirmation/)
  assert.equal(h.commands.length, count, 'An uncertain creation must not run again automatically')
  assert.deepEqual(await h.rpc('select', { choice: 'current' }), { ok: true, value: { cwd: 'C:/repo', locked: true } })
  assert.equal((await h.rpc('select', { choice: 'new' })).error.code, 'conflict')
  assert.equal((await h.rpc('create', { name: 'retry' })).error.code, 'conflict')
  await h.enter([h.admit('Work here instead')])
  assert.deepEqual(h.work, ['C:/repo'])
})

await test('선택 뒤 소스 경로가 바뀌면 검증이나 작업을 시작하기 전에 전송을 거부한다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  await h.ctx.workingDirectory.set(h.agent, 'C:/moved', new AbortController().signal)
  await assert.rejects(h.enter([h.admit()]), /could not be confirmed/)
  assert.deepEqual(h.commands, [])
  assert.deepEqual(h.work, [])
})

await test('접수된 프롬프트 뒤의 선택은 거부하고 그 프롬프트에 확정된 위치를 유지한다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  const message = h.admit()
  assert.equal((await h.rpc('select', { choice: 'current' })).error.code, 'busy')
  await h.enter([message])
  assert.deepEqual(h.work, ['C:/repo/.agents/worktrees/fix/deferred'])
})

await test('입력 후속 훅이 프롬프트를 거부하거나 제외하면 워크트리 선택을 적용하지 않는다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  const message = h.admit()
  const rejection = { kind: 'reject' }
  assert.equal(await h.enter([message], rejection), rejection)
  assert.deepEqual(h.commands, [])
  const replacement = h.admit('A new prompt after rejection')
  const excluded = { kind: 'enter', messages: [] }
  assert.equal(await h.enter([replacement], excluded), excluded)
  assert.deepEqual(h.commands, [])
  await h.enter([h.admit('A new prompt after exclusion')])
  assert.equal(h.cwd, 'C:/repo/.agents/worktrees/fix/deferred')
})

await test('접수된 메시지를 버리면 선택 예약을 다음 프롬프트에서 사용할 수 있다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  h.discard(h.admit())
  assert.deepEqual(h.commands, [])
  await h.enter([h.admit('Replacement prompt')])
  assert.deepEqual(h.work, ['C:/repo/.agents/worktrees/fix/deferred'])
})

await test('한 선택을 여러 접수 메시지가 공유해도 같은 단계에서 생성을 한 번만 실행한다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  const first = h.admit('First')
  const second = h.admit('Second')
  await h.enter([first, second])
  assert.deepEqual(h.changes, ['C:/repo/.agents/worktrees/fix/deferred'])
  assert.deepEqual(h.work, ['C:/repo/.agents/worktrees/fix/deferred'])
})

await test('새 워크트리 선택에서 첫 접수 메시지를 버려도 이미 대기 중인 다음 메시지의 위치를 보존한다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  const first = h.admit('Discarded task')
  const second = h.admit('Already queued replacement')
  h.discard(first)
  assert.deepEqual(h.commands, [])
  await h.enter([second])
  assert.deepEqual(h.work, ['C:/repo/.agents/worktrees/fix/deferred'])
})

await test('생성 예약을 공유하는 대기 메시지가 각각 진입해도 완료된 준비를 다시 실행하지 않는다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  const first = h.admit('First task')
  const second = h.admit('Second task')
  await h.enter([first])
  const count = h.commands.length
  await h.enter([second])
  assert.equal(h.commands.length, count)
  assert.equal(h.changes.length, 1)
  assert.deepEqual(h.work, [h.cwd, h.cwd])
})

for (const kind of ['user', 'user-rpc']) {
  for (const decision of [new Error('Downstream failed'), { kind: 'reject' }, { kind: 'enter', messages: [] }]) {
    await test(`${kind} 입력 claim 후 pre-step이 ${decision instanceof Error ? '실패' : decision.kind === 'reject' ? '거부' : '제외'}해도 현재 위치를 고정한다`, async (t) => {
      const h = fixture(t, { defaultSelection: 'new' })
      const message = h.admit('First task', kind)
      if (decision instanceof Error) await assert.rejects(h.enter([message], decision), /Downstream failed/)
      else assert.equal(await h.enter([message], decision), decision)
      assert.equal(h.session.deriveMessages().length, 0)
      assert.deepEqual(h.commands, [])
      assert.equal((await h.rpc('describe')).value.locked, true)
      assert.equal((await h.rpc('initialize')).value.pendingCreation, undefined)
      for (const choice of ['current', 'new']) assert.equal((await h.rpc('select', { choice })).error.code, 'conflict')
      assert.equal((await h.rpc('create', { name: 'late' })).error.code, 'conflict')
    })
  }
}

await test('실패한 생성 예약은 새 예약으로 교체하여 다시 생성하고 완료 후 위치를 고정한다', async (t) => {
  const h = fixture(t)
  await h.rpc('select', { choice: 'new' })
  const prepare = h.ctx.llm.prepareCall.bind(h.ctx.llm)
  h.ctx.llm.prepareCall = async () => {
    throw new Error('Naming unavailable')
  }
  await assert.rejects(h.enter([h.admit()]), /creation could not be confirmed/)
  h.ctx.llm.prepareCall = prepare
  const retry = await h.rpc('select', { choice: 'new' })
  assert.deepEqual(retry.value.pendingCreation, { name: '', failed: false })
  await h.enter([h.admit('Retry in a new worktree')])
  assert.equal((await h.rpc('describe')).value.locked, true)
  assert.deepEqual(h.work, ['C:/repo/.agents/worktrees/fix/deferred'])
})

await test('현재 경로로 접수한 메시지는 뒤늦게 생성 예약이 생겨도 그 예약을 소비하지 않는다', async (t) => {
  const h = fixture(t)
  const message = h.admit()
  // A host may move already-admitted input out of its public pending list before pre-step.
  h.agent.inbox.nextTurn = []
  assert.equal((await h.rpc('select', { choice: 'new' })).ok, true)
  await h.enter([message])
  assert.deepEqual(h.commands, [])
  assert.deepEqual(h.work, ['C:/repo'])
  assert.equal((await h.rpc('describe')).value.pendingCreation.failed, false)
})

await test('선택값의 형식과 기준 경로가 잘못되면 아무 작업 없이 거부한다', async (t) => {
  const h = fixture(t)
  for (const payload of [
    { choice: 'unknown' },
    { choice: 'existing' },
    { choice: 'existing', path: '' },
    { choice: 'existing', path: 'C:/bad\0path' },
    { choice: 'new', name: 1 },
  ])
    assert.equal((await h.rpc('select', payload)).error.code, 'invalid')
  assert.equal((await h.rpc('select', { choice: 'new', cwd: 'C:/stale' })).error.code, 'conflict')
  assert.deepEqual(h.commands, [])
  assert.deepEqual(h.changes, [])
  assert.equal(h.effects.flush, 0)
})
