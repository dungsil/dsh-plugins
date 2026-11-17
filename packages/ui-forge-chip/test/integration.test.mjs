import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { installConnection } from '@deepseek-ai/dsh-client-connection/client'
import { apply } from '../dist/index.js'

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
const exists = (path) =>
  stat(path).then(
    () => true,
    () => false
  )

// A real Git repository: `repo` is the original checkout on main, `work` a linked worktree on topic.
async function setup(t, { method = 'merge' } = {}) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'dsh-integration-test-')))
  t.after(() => rm(temporary, { recursive: true, force: true }))
  const repo = join(temporary, 'repo')
  const work = join(temporary, 'work')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  for (const [name, value] of [
    ['user.name', 'Test'],
    ['user.email', 'test@example.com'],
    ['commit.gpgsign', 'false'],
  ])
    run(repo, 'config', name, value)
  await writeFile(join(repo, 'shared.txt'), 'base\n')
  await writeFile(join(repo, 'other.txt'), 'other\n')
  run(repo, 'add', '.')
  run(repo, 'commit', '-qm', 'base')
  run(repo, 'worktree', 'add', '-q', '-b', 'topic', work)
  const session = { id: 'one', header: { cwd: repo } }
  const agent = {
    session,
    status: 'idle',
    maintenance: 0,
    async runMaintenance(task) {
      this.maintenance++
      return task(new AbortController().signal)
    },
  }
  let current = work
  let afterSpawn
  let policy = { mode: 'workspace-write' }
  let refuse = () => false
  const spawned = []
  const confined = []
  const hostConnection = new HostConnectionService(new Context(), [], {})
  const handler = hostConnection.createSharedFetchHandler('/api')
  const warnings = []
  const ctx = {
    agents: { get: (id) => (id === 'one' ? agent : undefined) },
    sessions: { get: (id) => (id === 'one' ? session : undefined) },
    workingDirectory: { get: () => current },
    sandboxPolicy: {
      resolve: ({ session: received }) => {
        assert.equal(received, session)
        return policy
      },
    },
    sandbox: {
      async confine(argv, received, signal) {
        assert.ok(signal instanceof AbortSignal)
        if (refuse(argv)) throw Error('sandbox denied')
        confined.push({ argv, policy: received })
        return { argv: [...argv] }
      },
    },
    fs: {
      resolve: async (path, { cwd } = {}) => realpath(resolve(cwd ?? '/', path)),
      processPath: (path) => path,
      processPathFromHostPath: (path) => path,
    },
    subprocess: {
      resolveExecutable: async () => 'git',
      spawn({ argv, cwd, env }) {
        spawned.push(argv)
        const environment = { ...process.env, ...env }
        for (const [name, value] of Object.entries(environment)) if (value === undefined) delete environment[name]
        const child = spawn(argv[0], argv.slice(1), { cwd, env: environment })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk) => (stdout += chunk))
        child.stderr.on('data', (chunk) => (stderr += chunk))
        const done = new Promise((resolve) => child.on('close', (exitCode) => resolve({ exitCode }))).then(
          async (outcome) => {
            await afterSpawn?.(argv, outcome)
            return outcome
          }
        )
        return {
          done,
          collected: {
            stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
            stderr: { readFrom: () => ({ text: stderr, lossy: false }) },
          },
          terminate() {},
          waitForExit: () => done.then(() => {}),
        }
      },
    },
    connection: hostConnection,
    logger: { warn: (message) => warnings.push(message) },
    configEditor: {},
    fiber: {},
    effect: (fn) => fn(),
    inject: () => {},
  }
  apply(ctx, { defaultAction: { get: () => 'commit' }, integrationMethod: method })
  let connection
  installConnection(
    { provide: (_name, handle) => (connection = handle) },
    {
      transport: {
        fetch: async (path, init) =>
          handler.fetch(new Request(new URL(path, 'http://localhost/'), init), { principal: { kind: 'owner' } }),
      },
    }
  )
  const commit = async (cwd, file, content, message = file) => {
    await writeFile(join(cwd, file), content)
    run(cwd, 'add', file)
    run(cwd, 'commit', '-qm', message)
    return run(cwd, 'rev-parse', 'HEAD')
  }
  const inspect = async () => {
    const result = await connection.rpc.call('/api', 'dungsil-forge-integration/inspect', { sessionId: 'one' })
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.value
  }
  const integrate = (proposal, method = proposal.method, overrides = {}) =>
    connection.rpc.call('/api', 'dungsil-forge-integration/run', {
      sessionId: 'one',
      method,
      targetBranch: proposal.target.branch,
      targetHead: proposal.target.head,
      sourceHead: proposal.source.head,
      ...overrides,
    })
  return {
    repo,
    work,
    agent,
    warnings,
    commit,
    inspect,
    integrate,
    spawned,
    confined,
    setPolicy: (value) => (policy = value),
    setRefuse: (value) => (refuse = value),
    setCurrent: (path) => (current = path),
    setAfterSpawn: (hook) => (afterSpawn = hook),
  }
}

await test('원본 체크아웃에서 시작한 세션이나 통합할 커밋이 없는 워크트리는 제안하지 않는다', async (t) => {
  const env = await setup(t)
  assert.equal(await env.inspect(), null)
  env.setCurrent(env.repo)
  await env.commit(env.work, 'feature.txt', 'feature\n')
  assert.equal(await env.inspect(), null)
})

await test('fast-forward가 가능하면 우선 제안하고 원본 브랜치만 source HEAD로 이동한다', async (t) => {
  const env = await setup(t)
  await env.commit(env.work, 'a.txt', 'a\n')
  const head = await env.commit(env.work, 'b.txt', 'b\n')
  const proposal = await env.inspect()
  assert.equal(proposal.method, 'ff')
  assert.deepEqual(proposal.methods, ['ff', 'merge', 'rebase', 'squash'])
  assert.deepEqual(proposal.target, { root: env.repo, branch: 'main', head: run(env.repo, 'rev-parse', 'HEAD') })
  assert.equal(proposal.commits, 2)
  const result = await env.integrate(proposal)
  assert.equal(result.ok, true)
  assert.equal(run(env.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(await readFile(join(env.repo, 'b.txt'), 'utf8'), 'b\n')
  assert.equal(env.agent.maintenance, 1)
  assert.equal(await env.inspect(), null)
})

await test('fast-forward가 불가능하고 적격 커밋이 하나이며 고유 merge가 없으면 cherry-pick을 제안한다', async (t) => {
  const env = await setup(t)
  const picked = await env.commit(env.work, 'feature.txt', 'feature\n', 'feature')
  const before = await env.commit(env.repo, 'main.txt', 'main\n')
  const proposal = await env.inspect()
  assert.equal(proposal.method, 'cherry-pick')
  assert.deepEqual(proposal.methods, ['cherry-pick', 'merge', 'rebase', 'squash'])
  assert.equal((await env.integrate(proposal)).ok, true)
  assert.equal(run(env.repo, 'rev-parse', 'HEAD^'), before)
  assert.equal(run(env.repo, 'log', '-1', '--format=%s'), 'feature')
  assert.notEqual(run(env.repo, 'rev-parse', 'HEAD'), picked)
  assert.equal(run(env.work, 'rev-parse', 'HEAD'), picked)
})

await test('source에 고유 merge 이력이 있으면 커밋이 하나여도 cherry-pick 대신 설정한 merge 계열을 제안한다', async (t) => {
  const env = await setup(t, { method: 'squash' })
  run(env.work, 'checkout', '-q', '-b', 'side')
  await env.commit(env.work, 'side.txt', 'side\n')
  run(env.work, 'checkout', '-q', 'topic')
  await env.commit(env.work, 'shared.txt', 'topic\n')
  run(env.work, 'merge', '-q', '--no-ff', '-m', 'merge side', 'side')
  // The side commit already exists on main as an equivalent patch, so one eligible commit remains.
  await env.commit(env.repo, 'side.txt', 'side\n', 'side on main')
  const proposal = await env.inspect()
  assert.equal(proposal.method, 'squash')
  assert.deepEqual(proposal.methods, ['merge', 'rebase', 'squash'])
})

await test('merge 계열은 설정한 기본 방식을 제안하고 메뉴에서 고른 방식으로 실행한다', async (t) => {
  for (const [method, check] of [
    [
      'merge',
      (env, target, source) => {
        assert.equal(run(env.repo, 'rev-parse', 'HEAD^1'), target)
        assert.equal(run(env.repo, 'rev-parse', 'HEAD^2'), source)
        assert.equal(run(env.repo, 'log', '-1', '--format=%s'), "Merge branch 'topic'")
      },
    ],
    [
      'squash',
      (env, target) => {
        assert.equal(run(env.repo, 'rev-parse', 'HEAD^'), target)
        assert.equal(run(env.repo, 'rev-list', '--count', `${target}..HEAD`), '1')
        assert.equal(run(env.repo, 'rev-list', '--parents', '-n1', 'HEAD').split(' ').length, 2)
      },
    ],
    [
      'rebase',
      (env, target) => {
        assert.equal(run(env.repo, 'log', '--format=%s', `${target}..HEAD`), 'two\none')
        assert.equal(run(env.repo, 'rev-list', '--merges', '--count', `${target}..HEAD`), '0')
      },
    ],
  ]) {
    await t.test(method, async (t) => {
      const env = await setup(t, { method: method === 'merge' ? 'rebase' : 'merge' })
      await env.commit(env.work, 'one.txt', '1\n', 'one')
      const source = await env.commit(env.work, 'two.txt', '2\n', 'two')
      const target = await env.commit(env.repo, 'main.txt', 'main\n')
      const proposal = await env.inspect()
      assert.equal(proposal.method, method === 'merge' ? 'rebase' : 'merge')
      assert.equal((await env.integrate(proposal, method)).ok, true)
      check(env, target, source)
      assert.equal(await readFile(join(env.repo, 'two.txt'), 'utf8'), '2\n')
      // rebase reapplies onto the original branch; the source branch never moves.
      assert.equal(run(env.work, 'rev-parse', 'topic'), source)
      assert.equal(run(env.repo, 'status', '--porcelain'), '')
    })
  }
})

await test('원본 대상의 staged 변경, 겹치는 변경, 진행 중인 Git 작업, 분리된 HEAD는 실행을 차단하고 이유를 보고한다', async (t) => {
  const env = await setup(t)
  await env.commit(env.work, 'shared.txt', 'topic\n')
  const head = run(env.repo, 'rev-parse', 'HEAD')

  await writeFile(join(env.repo, 'other.txt'), 'local\n')
  await writeFile(join(env.repo, 'untracked.txt'), 'local\n')
  assert.equal((await env.inspect()).blocker, null, 'unrelated local changes must not block')

  run(env.repo, 'add', 'other.txt')
  let proposal = await env.inspect()
  assert.deepEqual([proposal.blocker, proposal.paths], ['staged', ['other.txt']])
  const refused = await env.integrate(proposal)
  assert.equal(refused.ok, false)
  assert.equal(refused.error.code, 'blocked')
  run(env.repo, 'reset', '-q')

  await writeFile(join(env.repo, 'shared.txt'), 'local\n')
  proposal = await env.inspect()
  assert.deepEqual([proposal.blocker, proposal.paths], ['overlap', ['shared.txt']])
  assert.equal((await env.integrate(proposal)).error.code, 'blocked')
  assert.equal(await readFile(join(env.repo, 'shared.txt'), 'utf8'), 'local\n')
  run(env.repo, 'checkout', '-q', '--', 'shared.txt')

  await writeFile(join(run(env.repo, 'rev-parse', '--absolute-git-dir'), 'MERGE_HEAD'), `${head}\n`)
  assert.equal((await env.inspect()).blocker, 'in-progress')
  await rm(join(run(env.repo, 'rev-parse', '--absolute-git-dir'), 'MERGE_HEAD'))

  run(env.repo, 'checkout', '-q', '--detach')
  proposal = await env.inspect()
  assert.deepEqual([proposal.blocker, proposal.target.branch], ['detached', null])
  assert.equal(run(env.repo, 'rev-parse', 'HEAD'), head)
})

await test('대상 브랜치나 양쪽 HEAD가 제안 이후 바뀌었으면 오래된 제안으로 거부하고 아무것도 바꾸지 않는다', async (t) => {
  const env = await setup(t)
  await env.commit(env.work, 'a.txt', 'a\n')
  const proposal = await env.inspect()
  const target = run(env.repo, 'rev-parse', 'HEAD')
  for (const overrides of [{ targetHead: '0'.repeat(40) }, { sourceHead: target }, { targetBranch: 'release' }]) {
    const result = await env.integrate(proposal, 'ff', overrides)
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'stale')
  }
  await env.commit(env.work, 'b.txt', 'b\n')
  assert.equal((await env.integrate(proposal)).error.code, 'stale')
  // A fast-forward that is not available for the current heads is stale as well.
  await env.commit(env.repo, 'main.txt', 'main\n')
  const diverged = await env.inspect()
  assert.equal((await env.integrate(diverged, 'ff')).error.code, 'stale')
  env.agent.status = 'running'
  assert.equal((await env.integrate(diverged, 'merge')).error.code, 'busy')
  assert.equal(run(env.repo, 'log', '--format=%s', '-1'), 'main.txt')
})

await test('충돌로 실패하면 자신이 시작한 작업만 정리하고 관련 없는 로컬 변경은 보존한다', async (t) => {
  for (const method of ['merge', 'squash', 'rebase', 'cherry-pick']) {
    await t.test(method, async (t) => {
      const env = await setup(t)
      await env.commit(env.work, 'shared.txt', 'topic\n')
      if (method !== 'cherry-pick') await env.commit(env.work, 'more.txt', 'more\n')
      const target = await env.commit(env.repo, 'shared.txt', 'main\n')
      await writeFile(join(env.repo, 'other.txt'), 'local\n')
      const proposal = await env.inspect()
      assert.equal(proposal.blocker, null)
      const result = await env.integrate(proposal, method)
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'failed')
      assert.match(result.error.details.diagnostic, /CONFLICT/u)
      assert.equal(run(env.repo, 'rev-parse', 'HEAD'), target)
      assert.equal(run(env.repo, 'status', '--porcelain'), 'M other.txt')
      const gitDir = run(env.repo, 'rev-parse', '--absolute-git-dir')
      for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'SQUASH_MSG', 'sequencer'])
        assert.equal(await exists(join(gitDir, marker)), false, marker)
    })
  }
})

await test('실패한 뒤 다른 작업이 Git 상태를 바꿨으면 정리를 거부하고 진단을 남긴다', async (t) => {
  const env = await setup(t)
  await env.commit(env.work, 'shared.txt', 'topic\n')
  await env.commit(env.work, 'more.txt', 'more\n')
  await env.commit(env.repo, 'shared.txt', 'main\n')
  const proposal = await env.inspect()
  env.setAfterSpawn(async (argv, outcome) => {
    if (!argv.includes('--no-ff') || outcome.exitCode === 0) return
    // Another actor commits the conflict resolution before cleanup runs.
    run(env.repo, 'checkout', '--theirs', 'shared.txt')
    run(env.repo, 'commit', '-qam', 'someone else')
  })
  const result = await env.integrate(proposal, 'merge')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'cleanup-refused')
  assert.match(result.error.details.diagnostic, /another operation/u)
  assert.equal(run(env.repo, 'log', '-1', '--format=%s'), 'someone else')
  assert.equal(env.warnings.length, 1)
})

await test('조회와 커밋을 포함한 모든 git 명령은 세션의 샌드박스 정책으로 감싸서 실행한다', async (t) => {
  const env = await setup(t)
  await env.commit(env.work, 'one.txt', '1\n')
  await env.commit(env.repo, 'main.txt', 'main\n')
  assert.equal((await env.integrate(await env.inspect(), 'merge')).ok, true)
  assert.ok(env.spawned.some((argv) => argv.includes('merge') && argv.includes('--no-ff')))
  assert.equal(env.confined.length, env.spawned.length)
  assert.ok(env.confined.every(({ policy }) => policy.mode === 'workspace-write'))
  env.setPolicy({ mode: 'danger-full-access' })
  const before = env.confined.length
  await env.commit(env.work, 'two.txt', '2\n')
  await env.inspect()
  assert.equal(env.confined.length, before)
})

await test('읽기 전용 세션은 통합을 차단하고 원본 작업 공간에 커밋하지 않는다', async (t) => {
  const env = await setup(t)
  await env.commit(env.work, 'one.txt', '1\n')
  const head = run(env.repo, 'rev-parse', 'HEAD')
  env.setPolicy({ mode: 'read-only' })
  const proposal = await env.inspect()
  assert.equal(proposal.blocker, 'read-only')
  const result = await env.integrate(proposal)
  assert.equal(result.error.code, 'blocked')
  assert.ok(!env.spawned.some((argv) => argv.includes('--ff-only')))
  assert.equal(run(env.repo, 'rev-parse', 'HEAD'), head)
})

await test('샌드박스가 커밋 명령을 거부하면 실패로 보고하고 원본을 바꾸지 않는다', async (t) => {
  const env = await setup(t)
  await env.commit(env.work, 'one.txt', '1\n')
  await env.commit(env.repo, 'main.txt', 'main\n')
  const head = run(env.repo, 'rev-parse', 'HEAD')
  env.setRefuse((argv) => argv.includes('--no-ff'))
  const result = await env.integrate(await env.inspect(), 'merge')
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'failed')
  assert.match(result.error.details.diagnostic, /sandbox denied/u)
  assert.equal(run(env.repo, 'rev-parse', 'HEAD'), head)
  assert.equal(run(env.repo, 'status', '--porcelain'), '')
})
