import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
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
const gitPath = (path) => (process.platform === 'win32' ? path.replaceAll('\\', '/') : path)

async function fixture(t, options = {}, config = {}) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-worktree-')))
  const repo = join(home, 'source')
  const other = join(home, process.platform === 'win32' ? 'existing space 한글' : 'existing space\n한글')
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
  const requests = []
  class WorkAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream(request) {
      requests.push({ ...request, cwd: ctx.workingDirectory.get(agent.session) })
      yield { type: 'text-delta', index: 0, text: 'Finished' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['test'], new WorkAdapter())
  const agent = await harness.create(
    SessionId('worktree-ui-test'),
    { provider: 'test', model: 'test-model', ...options },
    { cwd: repo }
  )
  ctx.provide('sessionController', {
    resolveAgent: async (id) =>
      id === agent.id ? { agent } : { error: { code: 'session/not-found', message: 'Missing' } },
  })
  const fiber = await ctx.plugin(plugin, config)
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
  const submit = async (text = 'Implement the current task') => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  return { ctx, agent, repo, other, git, rpc, requests, submit, harness, fiber }
}

await test('reserves without side effects, creates before prompt work, and keeps existing switches immediate', async (t) => {
  const { ctx, agent, repo, other, git, rpc, requests, submit } = await fixture(t)
  agent.inject(
    createUserMessage({
      content: [{ type: 'text', text: 'The approval policy changed from "ask" to "never" (changed by the user).' }],
      source: { kind: 'user-approval' },
    })
  )
  const initial = await rpc('describe')
  assert.equal(initial.ok, true)
  assert.deepEqual(initial.value, {
    cwd: repo,
    worktrees: [
      { path: gitPath(repo), branch: 'main' },
      { path: gitPath(other), branch: null },
    ],
  })
  const mainPath = initial.value.worktrees.find((entry) => entry.branch === 'main').path
  const otherPath = initial.value.worktrees.find((entry) => entry.branch === null).path
  const reserved = await rpc('create', { cwd: repo, name: 'fix/login-ui' })
  assert.equal(reserved.ok, true)
  assert.deepEqual(reserved.value, { ...initial.value, pendingCreation: { name: 'fix/login-ui', failed: false } })
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.equal(requests.length, 0, 'reserving must not call a model')
  assert.equal(git('branch', '--list', 'fix/login-ui'), '', 'reserving must not create a branch')
  assert.deepEqual((await rpc('describe')).value, reserved.value, 'reloading must retain the reservation')
  await submit('Fix the login UI in the reserved checkout')
  const created = await rpc('describe')
  assert.equal(created.ok, true)
  assert.equal(created.value.pendingCreation, undefined)
  const path = join(repo, '.agents/worktrees/fix/login-ui')
  assert.equal(created.value.cwd, path)
  assert.ok(created.value.worktrees.some((entry) => entry.path === gitPath(path) && entry.branch === 'fix/login-ui'))
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  assert.ok(requests.length > 0)
  assert.ok(
    requests.every((request) => request.cwd === path),
    'all work calls must run in the new checkout'
  )
  assert.match(JSON.stringify(requests[0].messages), /Fix the login UI in the reserved checkout/)
  assert.ok(
    requests[0].messages.some((message) =>
      message.content.some(
        (block) => block.type === 'text' && block.text.includes(`Current working directory: ${JSON.stringify(path)}`)
      )
    ),
    'the first work call must see the new directory in model context'
  )
  assert.equal(git('rev-parse', 'refs/heads/fix/login-ui'), git('rev-parse', 'HEAD'))
  assert.equal(await readFile(join(repo, 'draft.txt'), 'utf8'), 'unsaved source file')
  await assert.rejects(readFile(join(path, 'draft.txt')), { code: 'ENOENT' })

  assert.equal((await rpc('switch', { cwd: repo, path: otherPath })).error.code, 'conflict')
  assert.equal((await rpc('switch', { cwd: path, path: tmpdir() })).error.code, 'invalid')
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  const switched = await rpc('switch', { cwd: path, path: otherPath })
  assert.equal(switched.ok, true)
  assert.equal(switched.value.cwd, other)
  assert.equal((await rpc('switch', { cwd: switched.value.cwd, path: mainPath })).ok, true)
  const count = requests.length
  assert.equal((await rpc('create', { cwd: repo, name: 'fix/login-ui' })).ok, true)
  await submit()
  assert.equal(requests.length, count, 'an existing branch must stop work, not run in the source checkout')
  assert.equal(ctx.workingDirectory.get(agent.session), repo, 'an existing branch cannot change the checkout')
  assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
  await submit('Do not retry the failed creation')
  assert.equal(requests.length, count)
  assert.equal((await rpc('switch', { cwd: repo, path: mainPath })).ok, true)
  assert.equal(
    (await rpc('describe')).value.pendingCreation,
    undefined,
    'selecting the current checkout cancels a reservation'
  )
  const events = agent.session.snapshotEvents()
  assert.ok(events.some((event) => event.type === 'user/message'))
  assert.equal(events.filter((event) => event.type === 'working-directory/change').length, 3)
})

await test('reservations are session-local, cancellable, and refuse a source directory changed before submission', async (t) => {
  const { ctx, agent, repo, other, git, rpc, requests, submit, harness } = await fixture(t)
  assert.equal((await rpc('create', { cwd: repo, name: 'cancelled-task' })).ok, true)
  const unrelated = await harness.create(
    SessionId('another-session'),
    { provider: 'test', model: 'test-model' },
    { cwd: repo }
  )
  unrelated.followup(
    createUserMessage({ content: [{ type: 'text', text: 'Another session task' }], source: { kind: 'user' } })
  )
  await unrelated.whenIdle()
  assert.equal(git('branch', '--list', 'cancelled-task'), '', 'another session must not consume the reservation')
  assert.equal((await rpc('describe')).value.pendingCreation.name, 'cancelled-task')
  const main = (await rpc('describe')).value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd: repo, path: main })).ok, true)
  await submit()
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.equal(git('branch', '--list', 'cancelled-task'), '', 'cancelling before submission must never create a branch')

  assert.equal((await rpc('create', { cwd: repo, name: 'stale-source' })).ok, true)
  await agent.runMaintenance((signal) => ctx.workingDirectory.set(agent, other, signal))
  const count = requests.length
  await submit()
  assert.equal(requests.length, count, 'a changed source must stop before either naming or work')
  assert.equal(git('branch', '--list', 'stale-source'), '')
  assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
})

await test('an empty reserved name uses the newly submitted prompt, not earlier history, only for naming', async (t) => {
  const { ctx, agent, repo, git, rpc, submit } = await fixture(t, { provider: 'fallback', model: 'fallback-model' })
  const requests = []
  let answer = 'fix-session-isolation'
  let reason = { kind: 'stop' }
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream(options) {
      requests.push(options)
      const naming = options.maxTokens === 256
      yield { type: 'text-delta', index: 0, text: naming ? answer : 'Finished' }
      yield { type: 'finish', reason: naming ? reason : { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['conversation', 'fallback'], new NamingAdapter())
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'Earlier unrelated task' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' }
  )
  const named = await rpc('create', { cwd: repo, name: ' manual-name ' })
  assert.equal(named.ok, true)
  assert.equal(requests.length, 0, 'a supplied name must not incur a model request')
  await submit()
  assert.ok(
    requests.every((request) => request.maxTokens !== 256),
    'a supplied name bypasses naming'
  )
  const mainPath = named.value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd: ctx.workingDirectory.get(agent.session), path: mainPath })).ok, true)
  requests.length = 0
  agent.session.append('request/header', {
    header: { config: { provider: 'conversation', model: 'selected-model' } },
    reason: 'initial',
  })
  assert.equal((await rpc('create', { cwd: repo, name: '  ' })).ok, true)
  assert.equal(requests.length, 0, 'an empty name must wait for the submitted prompt too')
  await submit('Fix session isolation when switching worktrees')
  const generated = await rpc('describe')
  assert.equal(generated.ok, true)
  assert.equal(generated.value.cwd, join(repo, '.agents/worktrees/fix-session-isolation'))
  assert.equal(git('rev-parse', 'refs/heads/fix-session-isolation'), git('rev-parse', 'HEAD'))
  assert.equal(requests.filter((request) => request.maxTokens === 256).length, 1)
  assert.equal(requests[0].provider, 'conversation')
  assert.equal(requests[0].model, 'selected-model')
  assert.equal(requests[0].tools, undefined)
  assert.match(requests[0].messages[0].content[0].text, /Fix session isolation/)
  assert.doesNotMatch(requests[0].messages[0].content[0].text, /Earlier unrelated task/)
  assert.equal(
    agent.session
      .deriveMessages()
      .filter(
        (message) =>
          message.role === 'user' &&
          message.content.some(
            (block) => block.type === 'text' && block.text === 'Fix session isolation when switching worktrees'
          )
      ).length,
    1,
    'naming must not duplicate the submitted message'
  )
  const cwd = generated.value.cwd
  for (const invalid of ['not a branch', 'git worktree add /tmp/evil', '../escape', '']) {
    answer = invalid
    assert.equal((await rpc('create', { cwd })).ok, true)
    const before = requests.length
    await submit()
    assert.equal(requests.length, before + 1, 'an invalid generated name must never start work')
    assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
    await submit()
    assert.equal(requests.length, before + 1, 'failed naming must not automatically retry')
  }
  answer = 'truncated-name'
  reason = { kind: 'max-tokens' }
  assert.equal((await rpc('create', { cwd })).ok, true)
  await submit()
  assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
  assert.equal(ctx.workingDirectory.get(agent.session), cwd)
  assert.deepEqual((await rpc('describe')).value.worktrees.map((entry) => entry.branch).sort(), [
    'fix-session-isolation',
    'main',
    'manual-name',
    null,
  ])
})

await test('refuses non-owners, malformed input, concurrent maintenance, and read-only creation', async (t) => {
  const { ctx, agent, repo, rpc, requests, submit } = await fixture(t)
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
  const queued = createUserMessage({ content: [{ type: 'text', text: 'Queued task' }], source: { kind: 'user' } })
  agent.inbox.append('next-turn', queued)
  assert.equal((await rpc('create', { cwd: repo, name: 'queued-task' })).error.code, 'busy')
  agent.inbox.remove(queued.id)
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
  assert.equal(cwd, repo, 'concurrent reservations must not create anything')
  const mainPath = results.find((result) => result.ok).value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd, path: mainPath })).ok, true)
  setSandboxMode(agent.session, 'read-only')
  assert.equal((await rpc('describe')).ok, true, 'read-only policy still permits listing')
  assert.equal((await rpc('create', { cwd: repo, name: 'read-only' })).ok, true)
  await submit()
  assert.equal(requests.length, 0, 'read-only creation failure must stop work')
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.equal(
    (await rpc('describe')).value.worktrees.some((entry) => entry.branch === 'read-only'),
    false
  )
})

await test('uses the configured naming model, then follows the conversation again after reset', async (t) => {
  const route = { provider: 'naming', model: 'small' }
  const { ctx, agent, repo, rpc, fiber, submit } = await fixture(
    t,
    { provider: 'conversation', model: 'selected' },
    route
  )
  const requests = []
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream(options) {
      const naming = options.maxTokens === 256
      if (naming) requests.push(options)
      yield { type: 'text-delta', index: 0, text: naming ? `branch-${requests.length}` : 'Finished' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['naming', 'conversation'], new NamingAdapter())
  const named = await rpc('create', { cwd: repo, name: 'manual' })
  assert.equal(named.ok, true)
  assert.equal(requests.length, 0)
  await submit()
  assert.equal(requests.length, 0, 'explicit names must still skip the configured naming model')
  assert.equal((await rpc('create', { cwd: ctx.workingDirectory.get(agent.session) })).ok, true)
  assert.equal(requests.length, 0, 'the configured model must wait for prompt submission')
  await submit()
  assert.equal(requests[0].provider, 'naming')
  assert.equal(requests[0].model, 'small')
  assert.equal(requests[0].tools, undefined)
  assert.deepEqual(agent.session.requestHeader().config, { provider: 'conversation', model: 'selected' })
  await fiber.dispose()
  await ctx.plugin(plugin, {})
  const inherited = await rpc('create', { cwd: ctx.workingDirectory.get(agent.session) })
  assert.equal(inherited.ok, true)
  await submit()
  assert.equal(requests[1].provider, 'conversation')
  assert.equal(requests[1].model, 'selected')
})
