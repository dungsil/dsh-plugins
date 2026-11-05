import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import * as plugin from '../dist/index.js'

await test('Git 작업은 저장소를 바꾸지 않고 리모트 기본 브랜치와 연결된 워크트리를 따른다', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-git-action-'))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const git = (...args) =>
    execFileSync('git', args, { cwd: home, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'trunk')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial')
  git('remote', 'add', 'upstream', join(home, 'unused-remote'))
  git('update-ref', 'refs/remotes/upstream/trunk', 'HEAD')
  git('symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/trunk')
  const initial = git('rev-parse', 'HEAD')
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(SessionPersistenceJsonl, { root: join(home, '.git', 'sessions') })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.git', 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(SandboxLocal)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('git-action-test'), { provider: 'test', model: 'test' }, { cwd: home })
  const id = SessionId('cold-session')
  const cold = Session.create(id, agent.session.snapshotEvents(), {
    ...agent.session.header,
    id,
    cwd: join(home, 'old'),
  })
  cold.append('working-directory/change', { cwd: home })
  cold.append('turn/start', { turn: 1 })
  cold.append('step/start', { turn: 1, step: 1 })
  const events = cold.snapshotEvents()
  const stored = await ctx.sessionPersistence.create(cold.header, { inheritedEventCount: cold.inheritedEventCount })
  try {
    await stored.append(events)
  } finally {
    await stored.close()
  }
  ctx.provide('sessionController', {
    resolveAgent: () => assert.fail('읽기 조회는 Agent를 활성화하지 않는다'),
  })
  await ctx.plugin(plugin)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const read = async (sessionId = agent.id, principal = { kind: 'owner' }) => {
    const method = 'dungsil-vcs/describe'
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload: { sessionId } }),
      }),
      { principal, interactions: 'deny' }
    )
    if (response.status !== 200) return { status: response.status }
    return (await response.json()).result
  }
  assert.deepEqual(await read(), { ok: true, value: { operation: 'push', headSha: initial, dirty: false } })
  const before = agent.session.snapshotEvents()
  assert.deepEqual(await read('cold-session'), {
    ok: true,
    value: { operation: 'push', headSha: initial, dirty: false },
  })
  const persisted = await ctx.sessionPersistence.open(id, 'read')
  try {
    assert.deepEqual((await persisted.read()).events, events)
    assert.equal(persisted.header.cwd, join(home, 'old'))
  } finally {
    await persisted.close()
  }
  assert.deepEqual(cold.snapshotEvents(), events)
  assert.deepEqual(agent.session.snapshotEvents(), before)
  assert.equal(ctx.agents.get('cold-session'), undefined)
  git('switch', '-c', 'main') // A familiar name is not necessarily the default branch.
  assert.deepEqual(await read(), { ok: true, value: { operation: 'pr', headSha: initial, dirty: false } })
  await writeFile(join(home, 'change.txt'), 'new file')
  assert.equal((await read()).value.dirty, true) // Untracked files need an update too.
  git('add', 'change.txt')
  assert.equal((await read()).value.dirty, true)
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'change')
  assert.deepEqual((await read()).value, { operation: 'pr', headSha: git('rev-parse', 'HEAD'), dirty: false })
  await writeFile(join(home, 'change.txt'), 'modified file')
  assert.equal((await read()).value.dirty, true)
  git('reset', '--hard', initial)
  const linked = join(home, 'linked')
  git('worktree', 'add', linked, 'trunk')
  await ctx.workingDirectory.set(agent, linked, new AbortController().signal)
  assert.deepEqual(await read(), { ok: true, value: { operation: 'pr', headSha: initial, dirty: false } }) // Worktree takes precedence over trunk.
  git('-C', linked, 'checkout', '--detach')
  assert.deepEqual(await read(), { ok: true, value: { operation: 'pr', headSha: initial, dirty: false } })
  await ctx.workingDirectory.set(agent, home, new AbortController().signal)
  git('symbolic-ref', '--delete', 'refs/remotes/upstream/HEAD')
  assert.equal((await read()).ok, false) // Do not guess a default when its metadata is absent.
  git('checkout', '--detach')
  assert.equal((await read()).ok, false)
  assert.equal((await read('missing')).ok, false)
  assert.deepEqual(await read(agent.id, { kind: 'anonymous' }), { status: 403 })
  assert.equal(git('rev-parse', 'HEAD'), initial)
  assert.equal(git('rev-parse', 'refs/remotes/upstream/trunk'), initial)
})
