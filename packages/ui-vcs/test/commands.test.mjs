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
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import * as plugin from '../dist/index.js'

async function fixture(t, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-vcs-command-'))
  const repo = join(home, 'repo')
  await mkdir(repo)
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  const git = (...args) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'feat/test')
  git('config', 'user.name', 'Test')
  git('config', 'user.email', 'test@example.invalid')
  await writeFile(join(repo, 'task.txt'), 'initial\n')
  await writeFile(join(repo, 'unrelated.txt'), 'initial\n')
  await writeFile(join(repo, 'AGENTS.md'), 'Commit subjects must be Korean Conventional Commits.\n')
  git('add', '.')
  git('commit', '-m', 'initial')
  await writeFile(join(repo, 'task.txt'), 'current task\n')
  await writeFile(join(repo, 'unrelated.txt'), 'another task\n')
  git('add', 'unrelated.txt')
  await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  await ctx.plugin(SubprocessLocal)
  await ctx.plugin(SandboxLocal)
  await ctx.plugin(SandboxPolicy, { mode: options.mode ?? 'danger-full-access' })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('vcs-command-test'), { provider: 'test', model: 'test' }, { cwd: repo })
  const requests = []
  class TextAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model, context: { contextWindow: 131072 }, defaultMaxTokens: 4096 }
    }
    async *stream(request) {
      requests.push(request)
      await options.onGenerate?.({ git, repo, agent, ctx })
      const answer = options.answer ?? {
        commitMessage: 'fix(ui): 작업 변경을 커밋한다',
        title: '',
        body: '',
        paths: ['task.txt'],
      }
      yield { type: 'text-delta', index: 0, text: typeof answer === 'string' ? answer : JSON.stringify(answer) }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['test'], new TextAdapter())
  ctx.provide('sessionController', {
    resolveAgent: async (id) => (id === agent.id ? { agent } : { error: { code: 'session/not-found' } }),
  })
  await ctx.plugin(plugin)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (overrides = {}, principal = { kind: 'owner' }) => {
    const method = 'dungsil-vcs/execute'
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method,
          payload: {
            sessionId: agent.id,
            cwd: repo,
            operation: 'commit',
            requestId: '11111111-1111-4111-8111-111111111111',
            ...overrides,
          },
        }),
      }),
      { principal, interactions: 'deny' }
    )
    return response.status === 200 ? (await response.json()).result : { status: response.status }
  }
  return { ctx, agent, repo, git, requests, rpc }
}

await test('commits only the generated plan, preserves unrelated staging, and never changes conversation or inbox', async (t) => {
  const { agent, git, requests, rpc } = await fixture(t)
  const messages = agent.session.deriveMessages()
  const nextTurn = [...agent.inbox.nextTurn]
  const nextStep = [...agent.inbox.nextStep]
  const index = git('diff', '--cached', '--binary')
  const initial = git('rev-parse', 'HEAD')
  const result = await rpc()
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.notEqual(result.value.commit, initial)
  assert.equal(git('show', '--format=', '--name-only', 'HEAD'), 'task.txt')
  assert.equal(git('diff', '--cached', '--binary'), index)
  assert.deepEqual(agent.session.deriveMessages(), messages)
  assert.deepEqual([...agent.inbox.nextTurn], nextTurn)
  assert.deepEqual([...agent.inbox.nextStep], nextStep)
  assert.equal(agent.status, 'idle')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].tools, undefined)
  const context = JSON.parse(requests[0].messages[0].content[0].text)
  assert.match(context.rules['AGENTS.md'], /Korean Conventional Commits/)
  assert.match(context.diff, /current task/)
  assert.deepEqual(await rpc(), result)
  assert.equal(requests.length, 1, 'same request ID returns its cached result')
})

await test('selected new files are committed without touching unrelated staged files', async (t) => {
  const { repo, git, rpc } = await fixture(t, {
    answer: { commitMessage: 'feat: 새 파일을 추가한다', title: '', body: '', paths: ['new file 한글.txt'] },
  })
  await writeFile(join(repo, 'new file 한글.txt'), 'new task\n')
  const index = git('diff', '--cached', '--binary')
  assert.equal((await rpc()).ok, true)
  assert.match(git('show', '--format=', '--name-only', 'HEAD'), /new file/)
  assert.equal(git('diff', '--cached', '--binary'), index)
  assert.match(git('diff', '--', 'task.txt'), /current task/)
})

await test('repository-relative plans work from a nested session directory and detached HEAD', async (t) => {
  const { ctx, agent, repo, git, rpc } = await fixture(t)
  const nested = join(repo, 'nested')
  await mkdir(nested)
  await ctx.workingDirectory.set(agent, nested, new AbortController().signal)
  git('checkout', '--detach')
  const result = await rpc({ cwd: nested })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.branch, '')
  assert.equal(git('show', '--format=', '--name-only', 'HEAD'), 'task.txt')
})

await test('literal leading-hyphen filenames cannot become Git options', async (t) => {
  const { repo, git, rpc } = await fixture(t, {
    answer: { commitMessage: 'feat: 새 파일을 추가한다', title: '', body: '', paths: ['-new.txt'] },
  })
  await writeFile(join(repo, '-new.txt'), 'literal path\n')
  assert.equal((await rpc()).ok, true)
  assert.equal(git('show', '--format=', '--name-only', 'HEAD'), '-new.txt')
})

await test('simultaneous commands return busy instead of starting another generation', async (t) => {
  let entered, release
  const started = new Promise((resolve) => {
    entered = resolve
  })
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  const { rpc, requests } = await fixture(t, {
    onGenerate: async () => {
      entered()
      await waiting
    },
  })
  const first = rpc()
  await started
  const second = await rpc({ requestId: '22222222-2222-4222-8222-222222222222' })
  release()
  assert.equal(second.error.code, 'busy')
  assert.equal((await first).ok, true)
  assert.equal(requests.length, 1)
})

await test('rejects partial staging and stale repository state without committing', async (t) => {
  for (const kind of ['partial', 'changed', 'branch']) {
    await t.test(kind, async (t) => {
      const options =
        kind === 'changed'
          ? { onGenerate: async ({ repo }) => writeFile(join(repo, 'task.txt'), 'concurrent change\n') }
          : kind === 'branch'
            ? { onGenerate: ({ git }) => git('switch', '-c', 'feat/other') }
            : {}
      const { repo, git, rpc } = await fixture(t, options)
      if (kind === 'partial') {
        git('add', 'task.txt')
        await writeFile(join(repo, 'task.txt'), 'unstaged tail\n')
      }
      const initial = git('rev-parse', 'HEAD')
      const result = await rpc()
      assert.equal(result.ok, false)
      assert.equal(result.error.code, kind === 'partial' ? 'partial_stage' : 'conflict')
      assert.equal(git('rev-parse', 'HEAD'), initial)
    })
  }
})

await test('rejects invalid plans, invalid model responses, and secrets before side effects', async (t) => {
  for (const kind of ['outside', 'malformed', 'secret']) {
    await t.test(kind, async (t) => {
      const options =
        kind === 'outside'
          ? { answer: { commitMessage: 'bad', title: '', body: '', paths: ['absent.txt'] } }
          : kind === 'malformed'
            ? { answer: 'not JSON' }
            : {}
      const { repo, git, rpc, requests } = await fixture(t, options)
      if (kind === 'secret') await writeFile(join(repo, '.env'), 'PRIVATE_TEST_PLACEHOLDER=not-a-real-secret\n')
      const initial = git('rev-parse', 'HEAD')
      const staged = git('diff', '--cached', '--binary')
      assert.equal((await rpc()).ok, false)
      assert.equal(git('rev-parse', 'HEAD'), initial)
      assert.equal(git('diff', '--cached', '--binary'), staged)
      if (kind === 'secret') assert.equal(requests.length, 0)
    })
  }
})

await test('read-only mode, wrong directories and unauthorized peers cannot request generation or writes', async (t) => {
  const { rpc, requests } = await fixture(t, { mode: 'read-only' })
  assert.equal((await rpc()).error.code, 'read_only')
  assert.deepEqual(await rpc({}, { kind: 'anonymous' }), { status: 403 })
  assert.equal((await rpc({ operation: 'shell' })).error.code, 'invalid')
  assert.equal((await rpc({ sessionId: 'missing' })).error.code, 'session_not_found')
  assert.equal(requests.length, 0)
})

await test('wrong cwd is rejected before generation and a busy source cannot be queued', async (t) => {
  const { agent, rpc, requests } = await fixture(t)
  assert.equal((await rpc({ cwd: '/not-current' })).error.code, 'conflict')
  let release
  const wait = new Promise((resolve) => {
    release = resolve
  })
  const maintenance = agent.runMaintenance(() => wait)
  const result = await rpc({ requestId: '22222222-2222-4222-8222-222222222222' })
  release()
  await maintenance
  assert.equal(result.ok, false)
  assert.equal(requests.length, 0)
})

await test('repository commit hooks remain active and failed hooks do not produce a success response', async (t) => {
  const { repo, git, rpc } = await fixture(t)
  const hook = join(repo, '.git', 'hooks', 'pre-commit')
  await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const before = git('rev-parse', 'HEAD')
  assert.equal((await rpc()).ok, false)
  assert.equal(git('rev-parse', 'HEAD'), before)
  assert.match(await readFile(join(repo, 'task.txt'), 'utf8'), /current task/)
})
