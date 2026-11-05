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
  await ctx.plugin(plugin, options.config)
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

await test('생성된 계획만 커밋하고 관련 없는 스테이징은 보존하며 대화나 받은편지함은 절대 바꾸지 않는다', async (t) => {
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

await test('선택한 새 파일은 관련 없는 스테이징된 파일을 건드리지 않고 커밋한다', async (t) => {
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

await test('저장소 기준 계획은 중첩된 세션 디렉터리와 분리된 HEAD에서도 동작한다', async (t) => {
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

await test('하이픈으로 시작하는 리터럴 파일 이름은 Git 옵션이 될 수 없다', async (t) => {
  const { repo, git, rpc } = await fixture(t, {
    answer: { commitMessage: 'feat: 새 파일을 추가한다', title: '', body: '', paths: ['-new.txt'] },
  })
  await writeFile(join(repo, '-new.txt'), 'literal path\n')
  assert.equal((await rpc()).ok, true)
  assert.equal(git('show', '--format=', '--name-only', 'HEAD'), '-new.txt')
})

await test('동시 명령은 다른 생성을 시작하지 않고 바쁨을 반환한다', async (t) => {
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

await test('부분 스테이징과 오래된 저장소 상태는 커밋 없이 거부한다', async (t) => {
  for (const kind of ['partial', 'changed', 'branch']) {
    await t.test(
      { partial: '부분 스테이징을 거부한다', changed: '변경된 파일을 거부한다', branch: '변경된 브랜치를 거부한다' }[
        kind
      ],
      async (t) => {
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
      }
    )
  }
})

await test('잘못된 계획, 잘못된 모델 응답, 비밀은 부작용 전에 거부한다', async (t) => {
  for (const kind of ['outside', 'malformed', 'secret']) {
    await t.test(
      {
        outside: '계획에 없는 파일을 거부한다',
        malformed: '잘못된 모델 응답을 거부한다',
        secret: '비밀 파일을 거부한다',
      }[kind],
      async (t) => {
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
      }
    )
  }
})

await test('읽기 전용 모드, 잘못된 디렉터리, 권한 없는 피어는 생성이나 쓰기를 요청할 수 없다', async (t) => {
  const { rpc, requests } = await fixture(t, { mode: 'read-only' })
  assert.equal((await rpc()).error.code, 'read_only')
  assert.deepEqual(await rpc({}, { kind: 'anonymous' }), { status: 403 })
  assert.equal((await rpc({ operation: 'shell' })).error.code, 'invalid')
  assert.equal((await rpc({ sessionId: 'missing' })).error.code, 'session_not_found')
  assert.equal(requests.length, 0)
})

await test('잘못된 cwd는 생성 전에 거부되고 바쁜 소스는 대기열에 넣을 수 없다', async (t) => {
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

await test('저장소 커밋 훅은 계속 활성 상태이고 실패한 훅은 성공 응답을 만들지 않는다', async (t) => {
  const { repo, git, rpc } = await fixture(t)
  const hook = join(repo, '.git', 'hooks', 'pre-commit')
  await writeFile(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const before = git('rev-parse', 'HEAD')
  assert.equal((await rpc()).ok, false)
  assert.equal(git('rev-parse', 'HEAD'), before)
  assert.match(await readFile(join(repo, 'task.txt'), 'utf8'), /current task/)
})

await test('UI 커밋에만 작성자와 서명 비활성화를 적용하고 Git 설정과 커미터는 바꾸지 않는다', async (t) => {
  const { repo, git, rpc } = await fixture(t, {
    config: { authorName: 'UI 작성자', authorEmail: 'ui@example.invalid', noSign: true },
  })
  git('config', 'commit.gpgSign', 'true')
  git('config', 'gpg.program', 'dsh-nonexistent-signing-program')
  const config = await readFile(join(repo, '.git/config'), 'utf8')
  assert.equal((await rpc()).ok, true)
  assert.equal(
    git('log', '-1', '--format=%an <%ae>|%cn <%ce>|%G?'),
    'UI 작성자 <ui@example.invalid>|Test <test@example.invalid>|N'
  )
  assert.equal(await readFile(join(repo, '.git/config'), 'utf8'), config)
  assert.throws(() => git('commit', '--allow-empty', '-m', 'outside UI'))
  git('-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'outside UI')
  assert.equal(git('log', '-1', '--format=%an <%ae>'), 'Test <test@example.invalid>')
})

await test('작성자를 비워 두면 기존 작성자를 사용하고 서명 비활성화를 끄면 Git 서명 설정을 따른다', async (t) => {
  const { git, rpc } = await fixture(t)
  git('config', 'commit.gpgSign', 'true')
  git('config', 'gpg.program', 'dsh-nonexistent-signing-program')
  const before = git('rev-parse', 'HEAD')
  assert.equal((await rpc()).ok, false)
  assert.equal(git('rev-parse', 'HEAD'), before)
  git('config', 'commit.gpgSign', 'false')
  assert.equal((await rpc({ requestId: '22222222-2222-4222-8222-222222222222' })).ok, true)
  assert.equal(git('log', '-1', '--format=%an <%ae>'), 'Test <test@example.invalid>')
})

await test('불완전하거나 제어 문자가 있는 작성자는 변경 사항을 스테이징하기 전에 거부한다', async (t) => {
  for (const config of [
    { authorName: 'Name', authorEmail: '' },
    { authorName: '', authorEmail: 'ui@example.invalid' },
    { authorName: 'Name\nInjected', authorEmail: 'ui@example.invalid' },
    { authorName: 'Name', authorEmail: 'ui@example.invalid\0' },
  ]) {
    const { git, rpc, requests } = await fixture(t, { config })
    const before = git('rev-parse', 'HEAD')
    const staged = git('diff', '--cached', '--binary')
    assert.equal((await rpc()).error.code, 'invalid')
    assert.equal(git('rev-parse', 'HEAD'), before)
    assert.equal(git('diff', '--cached', '--binary'), staged)
    assert.equal(requests.length, 0)
  }
})
