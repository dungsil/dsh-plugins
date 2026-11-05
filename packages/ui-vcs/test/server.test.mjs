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
import { SessionId } from '@deepseek-ai/dsh-session'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import * as plugin from '../dist/index.js'

await test('Git action follows the remote default branch and linked worktree without changing the repository', async (t) => {
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
  await ctx.plugin(LocalCredentialProvider, { path: join(home, '.git', 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(SandboxLocal)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('git-action-test'), { provider: 'test', model: 'test' }, { cwd: home })
  ctx.provide('sessionController', {
    resolveAgent: async (id) => (id === agent.id ? { agent } : { error: { code: 'session/not-found' } }),
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
