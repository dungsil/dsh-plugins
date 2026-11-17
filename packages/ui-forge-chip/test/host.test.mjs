import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply } from '../dist/index.js'

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-forge-chip-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const remote = join(root, 'remote.git')
  const repo = join(root, 'repo')
  sh(root, 'init', '--quiet', '--bare', remote)
  sh(root, 'init', '--quiet', '-b', 'main', repo)
  for (const [key, value] of [
    ['user.name', 'Test'],
    ['user.email', 'test@example.com'],
  ])
    sh(repo, 'config', key, value)
  await writeFile(join(repo, 'a.txt'), 'a\n')
  sh(repo, 'add', '.')
  sh(repo, 'commit', '--quiet', '-m', 'feat: 첫 커밋을 추가한다')
  if (options.remote !== false) sh(repo, 'remote', 'add', 'origin', remote)

  const llmRequests = []
  const discovered = []
  const tracked = []
  const spawned = []
  let reply = options.reply ?? '```\nfeat: 파일을 추가한다\n```'
  const session = { id: 'one', requestHeader: () => ({ config: { provider: 'p', model: 'conversation' } }) }
  const agent = {
    session,
    status: 'idle',
    options: {},
    maintenance: 0,
    async runMaintenance(task) {
      this.maintenance++
      return await task(new AbortController().signal)
    },
  }
  const connection = new HostConnectionService(new Context(), [], {})
  const handler = connection.createSharedFetchHandler('/api')
  const ctx = {
    connection,
    agents: { get: (id) => (id === 'one' ? agent : undefined) },
    sessions: { get: (id) => (id === 'one' ? session : undefined) },
    workingDirectory: { get: () => repo },
    sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) },
    sandbox: { confine: async () => assert.fail('full access never confines') },
    subprocess: {
      resolveExecutable: async (name) => name,
      spawn(spec) {
        spawned.push(spec.argv)
        let stdout = ''
        const child = spawn(spec.argv[0], spec.argv.slice(1), {
          cwd: spec.cwd,
          env: Object.fromEntries(Object.entries({ ...process.env, ...spec.env }).filter(([, v]) => v !== undefined)),
        })
        child.stdout.on('data', (data) => (stdout += data))
        const done = new Promise((resolve) => child.on('close', (exitCode) => resolve({ exitCode })))
        return {
          done,
          collected: { stdout: { readFrom: () => ({ text: stdout, lossy: false }) } },
          terminate() {},
          waitForExit: () => done,
        }
      },
    },
    llm: {
      async prepareCall(route, _signal, configure) {
        const config = configure(route, {})
        return {
          config,
          async *stream(request) {
            llmRequests.push(request)
            yield { type: 'block-start', index: 0, blockType: 'text' }
            yield { type: 'text-delta', index: 0, text: reply }
            yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
          },
        }
      },
    },
    forge: {
      repositoryFromRemote: (url) =>
        url ? { forge: options.forge ?? 'github', host: 'h', owner: 'o', name: 'n' } : undefined,
      findByHead: async (_repository, branch) => (options.existing ? [{ branch }] : []),
      changeRequestUrl: (ref) => `https://h/o/n/pull/${ref.branch}`,
    },
    forgeSession: {
      track: (_session, url) => tracked.push(url),
      discoverBranch: async (_session, url, branch) => discovered.push([url, branch]),
    },
    configEditor: {},
    fiber: {},
    effect: (fn) => fn(),
    inject: () => {},
  }
  apply(ctx, { defaultAction: { get: () => 'commit' } })
  let client
  installConnection(
    { provide: (_name, handle) => (client = handle) },
    {
      transport: {
        fetch: (path, init) =>
          handler.fetch(new Request(new URL(path, 'http://localhost/'), init), { principal: { kind: 'owner' } }),
      },
    }
  )
  const call = (method, payload) => client.rpc.call('/api', `dungsil-forge-chip/${method}`, payload)
  return {
    repo,
    remote,
    agent,
    call,
    llmRequests,
    discovered,
    tracked,
    spawned,
    setReply: (value) => (reply = value),
  }
}

await test('커밋은 스테이징이 없으면 모든 변경을 커밋하고 보조 모델 메시지를 정규화해 사용하며 푸시하지 않는다', async (t) => {
  const h = await setup(t)
  await writeFile(join(h.repo, 'b.txt'), 'b\n')
  await writeFile(join(h.repo, 'a.txt'), 'changed\n')
  const result = await h.call('commit', { sessionId: 'one', push: false })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.value.subject, 'feat: 파일을 추가한다')
  assert.equal(result.value.pushed, false)
  assert.equal(sh(h.repo, 'log', '-1', '--format=%B'), 'feat: 파일을 추가한다')
  assert.equal(sh(h.repo, 'status', '--porcelain'), '')
  assert.equal(sh(h.remote, 'branch', '--list'), '')
  const input = h.llmRequests[0].messages[0].content[0].text
  assert.match(input, /feat: 첫 커밋을 추가한다/)
  assert.match(input, /b\.txt/)
  assert.equal(h.agent.maintenance, 1)
})

await test('일부만 스테이징했으면 스테이징한 변경만 커밋한다', async (t) => {
  const h = await setup(t)
  await writeFile(join(h.repo, 'b.txt'), 'b\n')
  await writeFile(join(h.repo, 'c.txt'), 'c\n')
  sh(h.repo, 'add', 'b.txt')
  assert.equal((await h.call('commit', { sessionId: 'one', push: false })).ok, true)
  assert.equal(sh(h.repo, 'show', '--name-only', '--format=', 'HEAD'), 'b.txt')
  assert.equal(sh(h.repo, 'status', '--porcelain'), '?? c.txt')
})

await test('커밋 & 푸시는 upstream이 없으면 origin에 upstream을 설정해 푸시하고 브랜치 PR을 찾게 한다', async (t) => {
  const h = await setup(t)
  sh(h.repo, 'switch', '--quiet', '-c', 'topic')
  await writeFile(join(h.repo, 'b.txt'), 'b\n')
  const result = await h.call('commit', { sessionId: 'one', push: true })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(sh(h.remote, 'rev-parse', 'topic'), sh(h.repo, 'rev-parse', 'HEAD'))
  assert.equal(sh(h.repo, 'rev-parse', '--abbrev-ref', '@{upstream}'), 'origin/topic')
  assert.deepEqual(h.discovered, [[h.remote, 'topic']])
  const push = h.spawned.find((argv) => argv.includes('push'))
  assert.ok(push.includes('core.hooksPath=/dev/null'), 'push runs no repository hook')
  const commit = h.spawned.find((argv) => argv.includes('commit'))
  assert.ok(!commit.includes('core.hooksPath=/dev/null'), 'commit keeps repository hooks')
})

await test('변경이 없거나 메시지가 비정상이거나 원격이 없으면 각각의 오류 코드로 거부한다', async (t) => {
  const h = await setup(t)
  assert.equal((await h.call('commit', { sessionId: 'one', push: false })).error.code, 'nothing-to-commit')
  await writeFile(join(h.repo, 'b.txt'), 'b\n')
  h.setReply('   ')
  assert.equal((await h.call('commit', { sessionId: 'one', push: false })).error.code, 'message-failed')
  h.setReply('x'.repeat(200))
  assert.equal((await h.call('commit', { sessionId: 'one', push: false })).error.code, 'message-failed')
  assert.equal(sh(h.repo, 'rev-list', '--count', 'HEAD'), '1')
  h.agent.status = 'running'
  assert.equal((await h.call('commit', { sessionId: 'one', push: false })).error.code, 'unavailable')
  const offline = await setup(t, { remote: false })
  await writeFile(join(offline.repo, 'b.txt'), 'b\n')
  const result = await offline.call('commit', { sessionId: 'one', push: true })
  assert.equal(result.error.code, 'no-remote')
  assert.equal(sh(offline.repo, 'rev-list', '--count', 'HEAD'), '2', 'the commit stays when no remote exists')
})

await test('PR 생성은 커밋·푸시하지 않고 푸시되지 않은 커밋이 있으면 거부하며 기존 PR을 재사용한다', async (t) => {
  const h = await setup(t, { existing: true })
  sh(h.repo, 'switch', '--quiet', '-c', 'topic')
  assert.equal((await h.call('pr', { sessionId: 'one' })).error.code, 'no-remote')
  sh(h.repo, 'push', '--quiet', '-u', 'origin', 'topic')
  await writeFile(join(h.repo, 'b.txt'), 'b\n')
  sh(h.repo, 'add', '.')
  sh(h.repo, 'commit', '--quiet', '-m', 'local')
  assert.equal((await h.call('pr', { sessionId: 'one' })).error.code, 'not-pushed')
  sh(h.repo, 'push', '--quiet')
  const before = sh(h.repo, 'rev-parse', 'HEAD')
  const result = await h.call('pr', { sessionId: 'one' })
  assert.deepEqual(result, { ok: true, value: { url: 'https://h/o/n/pull/topic', reused: true } })
  assert.deepEqual(h.tracked, ['https://h/o/n/pull/topic'])
  assert.equal(sh(h.repo, 'rev-parse', 'HEAD'), before)
  assert.equal(h.llmRequests.length, 0)
  assert.ok(!h.spawned.some((argv) => argv[0] === 'gh'))
})

await test('지원하지 않는 코드 호스트에서는 새 PR을 만들지 않는다', async (t) => {
  const h = await setup(t, { forge: 'gitea' })
  sh(h.repo, 'switch', '--quiet', '-c', 'topic')
  sh(h.repo, 'push', '--quiet', '-u', 'origin', 'topic')
  assert.equal((await h.call('pr', { sessionId: 'one' })).error.code, 'unsupported')
})
