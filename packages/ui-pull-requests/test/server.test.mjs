import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }
const github = {
  number: 17,
  title: 'A <request> & title',
  url: 'https://github.com/team/project/pull/17',
  author: { login: 'alice' },
  headRefName: 'feat/sidebar',
  baseRefName: 'release',
  isDraft: true,
  state: 'OPEN',
  headRepository: { nameWithOwner: 'team/project' },
}

async function fixture(t, remote = 'git@github.com:team/project.git', provider = 'auto') {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pr-'))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })
  const git = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'feat/sidebar')
  git('remote', 'add', 'origin', remote)
  const cli = join(dir, 'cli.mjs')
  let rows = github,
    exitCode = 0,
    missing = false
  await writeFile(cli, `console.log(process.argv[2]); process.exit(Number(process.argv[3]))`)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  await ctx.plugin(SubprocessLocal)
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  const resolve = ctx.subprocess.resolveExecutable.bind(ctx.subprocess)
  ctx.subprocess.resolveExecutable = async (command, env, signal) => {
    if (command !== 'git' && missing) throw new Error('not installed')
    return command === 'git' ? resolve(command, env, signal) : command
  }
  ctx.subprocess.spawn = (spec) => {
    if (['gh', 'glab'].includes(spec.argv[0])) {
      return spawn({ ...spec, argv: [process.execPath, cli, JSON.stringify(rows), String(exitCode)] })
    }
    return spawn(spec)
  }
  ctx.provide('workingDirectory', { get: () => dir })
  ctx.provide('sessionController', {
    resolveAgent: async (id) => (id === 'test' ? { agent: { session: {} } } : { error: { code: 'missing' } }),
  })
  ctx.provide('sandbox', {})
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) })
  await ctx.plugin(plugin, { provider })
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (peer = owner, sessionId = 'test') => {
    const response = await handler.fetch(
      new Request('http://localhost/api/dungsil-pull-requests/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method: 'dungsil-pull-requests/list',
          payload: { sessionId },
        }),
      }),
      peer
    )
    return response.status === 200 ? (await response.json()).result : { status: response.status }
  }
  return {
    rpc,
    git,
    setRows: (value) => {
      rows = value
    },
    fail: () => {
      exitCode = 1
    },
    missing: () => {
      missing = true
    },
  }
}

await test('shows only the current branch PR and distinguishes absent requests, failed lookup and missing CLI', async (t) => {
  const f = await fixture(t)
  assert.deepEqual(await f.rpc(), {
    ok: true,
    value: {
      provider: 'github',
      repository: 'github.com/team/project',
      branch: 'feat/sidebar',
      request: {
        number: 17,
        title: 'A <request> & title',
        url: github.url,
        author: 'alice',
        source: 'feat/sidebar',
        target: 'release',
        draft: true,
        state: 'open',
      },
    },
  })
  f.setRows(null)
  assert.equal((await f.rpc()).value.request, null)
  f.setRows({ ...github, headRefName: 'unrelated' })
  assert.equal((await f.rpc()).value.request, null)
  f.setRows({ ...github, headRepository: { nameWithOwner: 'someone/project' } })
  assert.equal((await f.rpc()).value.request, null)
  f.setRows({ ...github, state: 'MERGED', url: 'https://github.com/upstream/project/pull/17' })
  assert.equal((await f.rpc()).value.request.state, 'merged')
  f.fail()
  assert.equal((await f.rpc()).error.code, 'command_failed')
  f.missing()
  assert.equal((await f.rpc()).error.code, 'cli_missing')
})

await test('uses the tracked GitLab remote, preserves nested groups, and normalizes MR draft fields', async (t) => {
  const f = await fixture(t)
  f.git('remote', 'add', 'upstream', 'ssh://git@gitlab.com:2222/team/sub/project.git')
  f.git('config', 'branch.feat/sidebar.remote', 'upstream')
  f.git('config', 'branch.feat/sidebar.merge', 'refs/heads/topic')
  f.setRows([
    {
      iid: 8,
      title: 'GitLab request',
      web_url: 'https://gitlab.com/team/sub/project/-/merge_requests/8',
      author: { username: 'bob' },
      source_branch: 'topic',
      target_branch: 'main',
      work_in_progress: true,
      state: 'opened',
      source_project_id: 41,
      target_project_id: 41,
    },
  ])
  const result = await f.rpc()
  assert.equal(result.ok, true)
  assert.equal(result.value.provider, 'gitlab')
  assert.equal(result.value.repository, 'gitlab.com/team/sub/project')
  assert.deepEqual(result.value.request, {
    number: 8,
    title: 'GitLab request',
    url: 'https://gitlab.com/team/sub/project/-/merge_requests/8',
    author: 'bob',
    source: 'topic',
    target: 'main',
    draft: true,
    state: 'open',
  })
  f.setRows([])
  assert.equal((await f.rpc()).value.request, null)
  f.setRows([
    {
      iid: 9,
      title: 'Another fork',
      web_url: 'https://gitlab.com/team/sub/project/-/merge_requests/9',
      source_branch: 'topic',
      target_branch: 'main',
      state: 'opened',
      source_project_id: 42,
      target_project_id: 41,
    },
  ])
  assert.equal((await f.rpc()).value.request, null)
})

await test('rejects malformed CLI data and unsafe links instead of exposing them', async (t) => {
  const f = await fixture(t)
  for (const rows of [
    { items: [] },
    [github],
    { ...github, number: -1 },
    { ...github, url: 'javascript:alert(1)' },
    { ...github, url: 'https://other.example/team/project/pull/17' },
  ]) {
    f.setRows(rows)
    assert.equal((await f.rpc()).error.code, 'invalid_response')
  }
})

await test('denies shared viewers and unknown sessions; reports missing remotes', async (t) => {
  const f = await fixture(t)
  const viewer = { principal: { kind: 'session', sessionId: 'test' }, interactions: 'answer' }
  assert.equal((await f.rpc(viewer)).status, 403)
  assert.equal((await f.rpc(owner, 'unknown')).error.code, 'unavailable')
  f.git('remote', 'remove', 'origin')
  assert.equal((await f.rpc()).error.code, 'repository')
})

await test('requires an explicit provider for enterprise hosts and never forwards remote userinfo', async (t) => {
  const remote = 'https://user:private@git.example.com/team/project.git'
  const auto = await fixture(t, remote)
  assert.equal((await auto.rpc()).error.code, 'unsupported')
  const enterprise = await fixture(t, remote, 'github')
  enterprise.setRows({ ...github, url: 'https://git.example.com/team/project/pull/17' })
  assert.equal((await enterprise.rpc()).value.repository, 'git.example.com/team/project')
})
