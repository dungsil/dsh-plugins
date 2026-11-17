import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { ForgejoProvider } from '@dungsil/dsh-plugin-forge-forgejo'
import { GiteaProvider } from '@dungsil/dsh-plugin-forge-gitea'
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
  // The forge registry sees the code host URL while pushes still reach the local bare repository.
  if (options.remoteUrl) {
    sh(repo, 'config', 'remote.origin.url', options.remoteUrl)
    sh(repo, 'config', 'remote.origin.pushurl', remote)
  }
  // A fake tea that logs its arguments and answers from tea.json, keyed by its first two arguments.
  const tea = join(root, 'tea')
  await writeFile(
    tea,
    `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(__dirname + '/tea.log', JSON.stringify({ args, token: process.env.GITEA_TOKEN ?? null }) + '\\n')
const reply = JSON.parse(readFileSync(__dirname + '/tea.json', 'utf8'))[args.slice(0, 2).join(' ')] ?? { code: 1 }
process.stdout.write(reply.stdout ?? '')
process.exit(reply.code ?? 0)
`
  )
  await chmod(tea, 0o755)
  const setTea = (replies) => writeFile(join(root, 'tea.json'), JSON.stringify(replies))
  await setTea({})
  const teaCalls = async () =>
    (await readFile(join(root, 'tea.log'), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  const providers = [
    new GiteaProvider(async () => assert.fail('URL handling runs no tea'), ['gitea.test'], 1048576),
    new ForgejoProvider(async () => assert.fail('URL handling runs no tea'), ['codeberg.test'], 1048576),
  ]
  const provided = (method, value) => providers.map((provider) => provider[method](value)).find(Boolean)

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
      resolveExecutable: async (name) => {
        if (options.missing?.includes(name)) throw new Error(`${name} is not installed`)
        return name === 'tea' ? tea : name
      },
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
    forge: options.remoteUrl
      ? {
          repositoryFromRemote: (url) => provided('repositoryFromRemote', url),
          findByHead: async (repository) => (options.existing ? [{ repository, number: 3 }] : []),
          changeRequestFromUrl: (url) => provided('changeRequestFromUrl', url),
          changeRequestUrl: (ref) => providers.find((p) => p.forge === ref.repository.forge).changeRequestUrl(ref),
        }
      : {
          repositoryFromRemote: (url) =>
            url ? { forge: options.forge ?? 'github', host: 'h', owner: 'o', name: 'n' } : undefined,
          findByHead: async (_repository, branch) => (options.existing ? [{ branch }] : []),
          changeRequestUrl: (ref) => `https://h/o/n/pull/${ref.branch}`,
        },
    forgeSession: {
      track: (target, url) => tracked.push([target.id, url]),
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
    setTea,
    teaCalls,
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
  assert.deepEqual(h.tracked, [['one', 'https://h/o/n/pull/topic']])
  assert.equal(sh(h.repo, 'rev-parse', 'HEAD'), before)
  assert.equal(h.llmRequests.length, 0)
  assert.ok(!h.spawned.some((argv) => argv[0] === 'gh'))
})

const families = [
  { forge: 'gitea', host: 'gitea.test' },
  { forge: 'forgejo', host: 'codeberg.test' },
]
const login = (host, name = 'work') => ({ name, url: `https://${host}`, sshhost: host, user: 'me', default: 'false' })

/** A pushed topic branch whose remote is a Gitea-family repository and whose remote default branch is main. */
async function giteaSetup(t, options = {}, family = families[0]) {
  const h = await setup(t, { remoteUrl: `https://${family.host}/o/n.git`, ...options })
  sh(h.repo, 'push', '--quiet', '-u', 'origin', 'main')
  sh(h.repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  sh(h.repo, 'switch', '--quiet', '-c', 'topic')
  await writeFile(join(h.repo, 'b.txt'), 'b\n')
  sh(h.repo, 'add', '.')
  sh(h.repo, 'commit', '--quiet', '-m', 'feat: 기능을 추가한다', '-m', '본문 설명이다')
  sh(h.repo, 'push', '--quiet', '-u', 'origin', 'topic')
  return h
}

await test('지원하지 않는 코드 호스트에서는 새 PR을 만들지 않고 CLI가 없으면 pr-unavailable로 구분해 거부한다', async (t) => {
  const h = await setup(t, { forge: 'bitbucket' })
  sh(h.repo, 'switch', '--quiet', '-c', 'topic')
  sh(h.repo, 'push', '--quiet', '-u', 'origin', 'topic')
  assert.equal((await h.call('pr', { sessionId: 'one' })).error.code, 'unsupported')
  const github = await setup(t, { missing: ['gh'] })
  sh(github.repo, 'switch', '--quiet', '-c', 'topic')
  sh(github.repo, 'push', '--quiet', '-u', 'origin', 'topic')
  assert.equal((await github.call('pr', { sessionId: 'one' })).error.code, 'pr-unavailable')
  const gitea = await giteaSetup(t, { missing: ['tea'] })
  assert.equal((await gitea.call('pr', { sessionId: 'one' })).error.code, 'pr-unavailable')
  assert.deepEqual(await gitea.teaCalls(), [])
  assert.deepEqual(gitea.tracked, [])
})

await test('Gitea와 Forgejo PR 생성은 호스트의 tea 로그인으로 tea pulls create를 실행하고 정규 URL을 세션에 연결한다', async (t) => {
  const previous = process.env.GITEA_TOKEN
  process.env.GITEA_TOKEN = 'ambient-token'
  t.after(() => (previous === undefined ? delete process.env.GITEA_TOKEN : (process.env.GITEA_TOKEN = previous)))
  for (const family of families) {
    const h = await giteaSetup(t, {}, family)
    if (family.forge === 'forgejo') {
      await writeFile(join(h.repo, 'c.txt'), 'c\n')
      sh(h.repo, 'add', '.')
      sh(h.repo, 'commit', '--quiet', '-m', 'fix: 오류를 고친다')
      sh(h.repo, 'push', '--quiet')
    }
    const before = sh(h.repo, 'rev-parse', 'HEAD')
    await h.setTea({
      'login list': { stdout: JSON.stringify([login('other.test', 'other'), login(family.host)]) },
      'pulls create': {
        stdout: `${JSON.stringify({ index: 12, title: 't', url: `https://${family.host}/O/N/pulls/12/`, state: 'open', base: 'main', head: 'topic' })}\n`,
      },
    })
    const result = await h.call('pr', { sessionId: 'one' })
    // The canonical URL keeps the host's spelling of the repository and drops the trailing slash.
    const url = `https://${family.host}/O/N/pulls/12`
    assert.deepEqual(result, { ok: true, value: { url, reused: false } }, family.forge)
    assert.deepEqual(h.tracked, [['one', url]])
    const calls = await h.teaCalls()
    assert.deepEqual(
      calls.map((call) => call.args),
      [
        ['login', 'list', '--output', 'json'],
        [
          'pulls',
          'create',
          '--login=work',
          '--repo=o/n',
          '--head=topic',
          ...(family.forge === 'gitea'
            ? ['--title=feat: 기능을 추가한다', '--description=본문 설명이다']
            : ['--description=- feat: 기능을 추가한다\n- fix: 오류를 고친다']),
          '--output=json',
        ],
      ]
    )
    assert.ok(
      calls.every((call) => call.token === null),
      'ambient tea credentials never reach tea'
    )
    assert.equal(sh(h.repo, 'rev-parse', 'HEAD'), before, 'PR creation never commits')
    assert.equal(h.llmRequests.length, 0)
    assert.equal(h.agent.maintenance, 1)
  }
})

await test('tea 0.16 이전처럼 JSON 대신 PR 세부 정보를 출력하면 그 URL을 검증해 세션에 연결한다', async (t) => {
  const h = await giteaSetup(t)
  await h.setTea({
    'login list': { stdout: JSON.stringify([login('gitea.test')]) },
    'pulls create': {
      stdout: '  # #4 feat (open)\n\n  @me created 2026-11-17\tmain <- topic\n\n  https://gitea.test/o/n/pulls/4\n',
    },
  })
  assert.deepEqual(await h.call('pr', { sessionId: 'one' }), {
    ok: true,
    value: { url: 'https://gitea.test/o/n/pulls/4', reused: false },
  })
  assert.deepEqual(h.tracked, [['one', 'https://gitea.test/o/n/pulls/4']])
})

await test('Gitea PR 생성은 열린 PR을 재사용하고 푸시되지 않은 커밋이 있으면 tea를 실행하지 않고 거부한다', async (t) => {
  const reuse = await giteaSetup(t, { existing: true }, families[1])
  assert.deepEqual(await reuse.call('pr', { sessionId: 'one' }), {
    ok: true,
    value: { url: 'https://codeberg.test/o/n/pulls/3', reused: true },
  })
  assert.deepEqual(reuse.tracked, [['one', 'https://codeberg.test/o/n/pulls/3']])
  assert.deepEqual(await reuse.teaCalls(), [])

  const local = await giteaSetup(t)
  await writeFile(join(local.repo, 'c.txt'), 'c\n')
  sh(local.repo, 'add', '.')
  sh(local.repo, 'commit', '--quiet', '-m', 'local')
  assert.equal((await local.call('pr', { sessionId: 'one' })).error.code, 'not-pushed')
  assert.deepEqual(await local.teaCalls(), [])
  assert.notEqual(sh(local.remote, 'rev-parse', 'topic'), sh(local.repo, 'rev-parse', 'HEAD'), 'nothing was pushed')
})

await test('tea 로그인이 실패하거나 호스트에 맞는 로그인이 하나가 아니면 PR을 만들지 않고 pr-failed로 거부한다', async (t) => {
  const h = await giteaSetup(t)
  for (const reply of [
    { code: 1, stdout: '' },
    { stdout: JSON.stringify([]) },
    { stdout: JSON.stringify([login('gitea.test', 'a'), login('gitea.test', 'b')]) },
    { stdout: JSON.stringify([login('gitea.test', '--repo=x/y')]) },
    { stdout: 'not json' },
  ]) {
    await h.setTea({ 'login list': reply, 'pulls create': { stdout: '{}' } })
    assert.equal((await h.call('pr', { sessionId: 'one' })).error.code, 'pr-failed', JSON.stringify(reply))
  }
  assert.ok(
    (await h.teaCalls()).every((call) => call.args[0] === 'login'),
    'tea pulls create never ran'
  )
  assert.deepEqual(h.tracked, [])
})

await test('tea가 실패하거나 출력이 비정상이거나 다른 저장소의 URL이면 세션에 연결하지 않고 pr-failed로 거부한다', async (t) => {
  const h = await giteaSetup(t)
  const created = (fields) => ({ stdout: JSON.stringify({ index: 1, head: 'topic', ...fields }) })
  for (const reply of [
    { code: 1, stdout: '' },
    { stdout: 'created' },
    { stdout: '  # #1 x (open)\n\n  https://gitea.test/o/other/pulls/1\n' },
    { stdout: 'null' },
    created({ url: 'https://gitea.test/o/other/pulls/1' }),
    created({ url: 'https://codeberg.test/o/n/pulls/1' }),
    created({ url: 'https://gitea.test/o/n/pull/1' }),
    created({ url: 'https://gitea.test/o/n/pulls/1', head: 'other' }),
  ]) {
    await h.setTea({ 'login list': { stdout: JSON.stringify([login('gitea.test')]) }, 'pulls create': reply })
    assert.equal((await h.call('pr', { sessionId: 'one' })).error.code, 'pr-failed', JSON.stringify(reply))
  }
  assert.deepEqual(h.tracked, [])
})
