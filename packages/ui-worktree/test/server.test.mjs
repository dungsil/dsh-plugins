import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import Worktrees from '@deepseek-ai/dsh-experimental-worktree'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }

async function fixture(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-worktree-'))
  const repo = join(home, 'source')
  const other = join(home, 'existing space\n한글')
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  await mkdir(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial')
  git('worktree', 'add', '--detach', other)
  await writeFile(join(repo, 'draft.txt'), 'unsaved source file')
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(SandboxLocal)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access' })
  await ctx.plugin(Worktrees)
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('worktree-ui-test'), options, { cwd: repo })
  ctx.provide('sessionController', {
    resolveAgent: async (id) =>
      id === agent.id ? { agent } : { error: { code: 'session/not-found', message: 'Missing' } },
  })
  await ctx.plugin(plugin)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (endpoint, payload = {}, peer = owner) => {
    const method = `dungsil-worktree/${endpoint}`
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method,
          payload: { sessionId: agent.id, ...payload },
        }),
      }),
      peer
    )
    if (response.status !== 200) return { status: response.status }
    return (await response.json()).result
  }
  return { ctx, agent, repo, other, git, rpc }
}

await test('owner UI API lists, creates and switches real worktrees without a model or consuming source files', async (t) => {
  const { ctx, agent, repo, other, git, rpc } = await fixture(t)
  const initial = await rpc('describe')
  assert.equal(initial.ok, true)
  assert.deepEqual(initial.value, {
    cwd: repo,
    worktrees: [
      { path: repo, branch: 'main' },
      { path: other, branch: null },
    ],
  })
  const created = await rpc('create', { cwd: repo, name: 'fix/login-ui' })
  assert.equal(created.ok, true)
  const path = join(repo, '.agents/worktrees/fix/login-ui')
  assert.equal(created.value.cwd, path)
  assert.ok(created.value.worktrees.some((entry) => entry.path === path && entry.branch === 'fix/login-ui'))
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  assert.equal(git('rev-parse', 'refs/heads/fix/login-ui'), git('rev-parse', 'HEAD'))
  assert.equal(await readFile(join(repo, 'draft.txt'), 'utf8'), 'unsaved source file')
  await assert.rejects(readFile(join(path, 'draft.txt')), { code: 'ENOENT' })

  assert.equal((await rpc('switch', { cwd: repo, path: other })).error.code, 'conflict')
  assert.equal((await rpc('switch', { cwd: path, path: tmpdir() })).error.code, 'invalid')
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  const switched = await rpc('switch', { cwd: path, path: other })
  assert.equal(switched.ok, true)
  assert.equal(switched.value.cwd, other)
  assert.equal((await rpc('switch', { cwd: other, path: repo })).ok, true)
  assert.equal((await rpc('create', { cwd: repo, name: 'fix/login-ui' })).ok, false)
  assert.equal(ctx.workingDirectory.get(agent.session), repo, 'an existing branch cannot change the checkout')
  assert.equal((await rpc('create', { cwd: repo, name: '../escape' })).ok, false)
  assert.equal((await rpc('create', { cwd: repo })).ok, false, 'an empty name requires a selected model')
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter((event) => event.type === 'request/header' || event.type === 'user/message').length, 0)
  assert.equal(events.filter((event) => event.type === 'working-directory/change').length, 3)
})

await test('only an empty name uses the selected model before real creation, without tools or a conversation turn', async (t) => {
  const { ctx, agent, repo, git, rpc } = await fixture(t, { provider: 'fallback', model: 'fallback-model' })
  const requests = []
  let answer = 'fix-session-isolation'
  let reason = { kind: 'stop' }
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream(options) {
      requests.push(options)
      yield { type: 'text-delta', index: 0, text: answer }
      yield { type: 'finish', reason }
    }
  }
  ctx.llm.registerAdapter(['conversation', 'fallback'], new NamingAdapter())
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'Fix session isolation when switching worktrees' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' }
  )
  agent.session.append('request/header', {
    header: { config: { provider: 'conversation', model: 'selected-model' } },
    reason: 'initial',
  })
  const named = await rpc('create', { cwd: repo, name: ' manual-name ' })
  assert.equal(named.ok, true)
  assert.equal(requests.length, 0, 'a supplied name must not incur a model request')
  assert.equal((await rpc('switch', { cwd: named.value.cwd, path: repo })).ok, true)
  const before = agent.session.deriveMessages()
  const generated = await rpc('create', { cwd: repo, name: '  ' })
  assert.equal(generated.ok, true)
  assert.equal(generated.value.cwd, join(repo, '.agents/worktrees/fix-session-isolation'))
  assert.equal(git('rev-parse', 'refs/heads/fix-session-isolation'), git('rev-parse', 'HEAD'))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].provider, 'conversation')
  assert.equal(requests[0].model, 'selected-model')
  assert.equal(requests[0].tools, undefined)
  assert.match(requests[0].messages[0].content[0].text, /Fix session isolation/)
  assert.deepEqual(agent.session.deriveMessages(), before, 'naming must not append a conversation turn')
  const cwd = generated.value.cwd
  for (const invalid of ['not a branch', 'git worktree add /tmp/evil', '../escape', '']) {
    answer = invalid
    assert.equal((await rpc('create', { cwd })).ok, false)
  }
  answer = 'truncated-name'
  reason = { kind: 'max-tokens' }
  assert.equal((await rpc('create', { cwd })).ok, false)
  assert.equal(ctx.workingDirectory.get(agent.session), cwd)
  assert.deepEqual((await rpc('describe')).value.worktrees.map((entry) => entry.branch).sort(), [
    'fix-session-isolation',
    'main',
    'manual-name',
    null,
  ])
})

await test('refuses non-owners, malformed input, concurrent maintenance, and read-only creation', async (t) => {
  const { ctx, agent, repo, rpc } = await fixture(t)
  for (const endpoint of ['describe', 'create', 'switch']) {
    assert.equal(
      (
        await rpc(
          endpoint,
          { cwd: repo, name: 'unauthorized', path: repo },
          { principal: { kind: 'anonymous' }, interactions: 'deny' }
        )
      ).status,
      403
    )
  }
  assert.equal((await rpc('create', { name: 'missing-cwd' })).error.code, 'invalid')
  assert.equal((await rpc('create', { cwd: repo, name: 42 })).error.code, 'invalid')
  assert.equal((await rpc('describe', { sessionId: 'missing' })).error.code, 'session/not-found')
  let finish
  const maintenance = agent.runMaintenance(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const refused = await rpc('create', { cwd: repo, name: 'busy' })
  assert.equal(refused.ok, false)
  finish()
  await maintenance
  const results = await Promise.all([
    rpc('create', { cwd: repo, name: 'single-creation' }),
    rpc('create', { cwd: repo, name: 'must-not-create' }),
  ])
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.find((result) => !result.ok).error.code, 'busy')
  const cwd = ctx.workingDirectory.get(agent.session)
  assert.equal((await rpc('switch', { cwd, path: repo })).ok, true)
  setSandboxMode(agent.session, 'read-only')
  assert.equal((await rpc('describe')).ok, true, 'read-only policy still permits listing')
  assert.equal((await rpc('create', { cwd: repo, name: 'read-only' })).ok, false)
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.equal(
    (await rpc('describe')).value.worktrees.some((entry) => entry.branch === 'read-only'),
    false
  )
})
