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
const sha = 'a'.repeat(40)
const details = {
  body: 'Description <script>text only</script>',
  headSha: sha,
  mergeable: 'MERGEABLE',
  reviewDecision: 'REVIEW_REQUIRED',
  checks: [{ name: 'test', status: 'SUCCESS', url: 'https://ci.example/job/1' }],
  files: [{ path: 'src/main.ts', additions: 1, deletions: 1 }],
  diff: 'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-old\n+new',
  diffTruncated: false,
  comments: [{ author: 'bob', body: 'Comment', url: 'https://github.com/team/project/pull/17#issuecomment-1' }],
  reviews: [{ author: 'carol', body: 'Review', state: 'COMMENTED' }],
}
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

async function fixture(
  t,
  remote = 'git@github.com:team/project.git',
  provider = 'auto',
  loginUrl = 'https://forge.example:3443/git'
) {
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
    missing = false,
    httpStatus = 200
  const calls = []
  let dispatch
  const defaultDispatch = (args) => {
    if (args[0] === 'login')
      return [
        { name: 'default', url: 'https://other.invalid', ssh_host: 'other.invalid' },
        { name: 'work', url: loginUrl, ssh_host: new URL(loginUrl).host },
      ]
    const forgeUrl = args.find((arg) => arg.startsWith(`${loginUrl}/api/v1/`))
    if (forgeUrl) {
      const endpoint = forgeUrl.slice(`${loginUrl}/api/v1/`.length)
      if (args.includes('POST')) return { id: 9, commit_id: sha, stale: false, dismissed: false }
      if (new URL(forgeUrl).searchParams.get('page') > 1) return []
      if (/\/pulls\?/.test(endpoint)) return rows ? [rows] : []
      if (/\/pulls\/\d+$/.test(endpoint)) return rows
      if (endpoint.endsWith('.diff')) return details.diff
      if (endpoint.includes('/branches/'))
        return {
          name: 'release',
          required_approvals: 1,
          enable_status_check: true,
          status_check_contexts: ['build'],
          user_can_merge: true,
        }
      if (endpoint.includes('/statuses/'))
        return [{ id: 7, context: 'build', status: 'success', target_url: 'https://ci.example/job/7' }]
      if (endpoint.includes('/reviews?'))
        return [
          {
            id: 3,
            user: { login: 'carol' },
            body: 'Reviewed',
            state: 'APPROVED',
            commit_id: sha,
            official: true,
            stale: false,
            dismissed: false,
          },
        ]
      if (endpoint.endsWith('/comments'))
        return [{ id: 4, user: { login: 'bob' }, body: 'Comment', html_url: `${rows.html_url}#issuecomment-4` }]
      if (endpoint.includes('/files?')) return [{ filename: 'src/main.ts', additions: 2, deletions: 1 }]
      return { full_name: 'team/project', allow_merge_commits: true, allow_squash_merge: true, allow_rebase: true }
    }
    if ((args[1] === 'view' && !args.includes('--repo')) || args[1] === 'list') return rows
    if (args[1] === 'view' && args[0] === 'pr')
      return {
        ...rows,
        body: details.body,
        headRefOid: sha,
        mergeable: details.mergeable,
        reviewDecision: rows.reviewDecision ?? details.reviewDecision,
        statusCheckRollup: [{ name: 'test', conclusion: 'SUCCESS', detailsUrl: 'https://ci.example/job/1' }],
        changedFiles: details.files.length,
        files: details.files,
        comments: [{ author: { login: 'bob' }, body: 'Comment', url: details.comments[0].url }],
        reviews: [{ author: { login: 'carol' }, body: 'Review', state: 'COMMENTED' }],
      }
    if (args[1] === 'diff') return details.diff
    if (args[1] === 'view' && args[0] === 'mr')
      return {
        ...rows[0],
        description: 'GitLab body',
        sha,
        detailed_merge_status: 'mergeable',
      }
    const endpoint = args.find((arg) => arg.startsWith('projects/')) ?? ''
    if (endpoint.endsWith('/approvals')) return { approved: true, approved_by: [{ user: { username: 'carol' } }] }
    if (endpoint.includes('/merge_requests/') && endpoint.includes('/pipelines?'))
      return [{ id: 7, sha, status: 'success', web_url: 'https://ci.example/pipeline/7' }]
    if (endpoint.includes('/jobs?')) return [{ name: 'build', status: 'success', web_url: 'https://ci.example/job/7' }]
    if (endpoint.includes('/notes?')) return [{ id: 5, author: { username: 'bob' }, body: 'MR comment', system: false }]
    if (endpoint.includes('/diffs?')) return [{ old_path: 'a.ts', new_path: 'b.ts', diff: '@@ -1 +1 @@\n-old\n+new' }]
    return { completed: true, merged: true }
  }
  await writeFile(
    cli,
    `process.stdout.write(process.argv[2]); process.stderr.write(process.argv[4] ?? ''); process.exit(Number(process.argv[3]))`
  )
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
    if (['gh', 'glab', 'tea'].includes(spec.argv[0])) {
      calls.push(spec)
      const args = spec.argv.slice(1)
      const value = dispatch ? dispatch(args, defaultDispatch) : defaultDispatch(args)
      return spawn({
        ...spec,
        argv: [
          process.execPath,
          cli,
          value instanceof Error ? '' : typeof value === 'string' ? value : JSON.stringify(value),
          String(value instanceof Error ? 1 : exitCode),
          value instanceof Error
            ? value.message
            : spec.argv[0] === 'tea' && args[0] === 'api'
              ? `HTTP/1.1 ${httpStatus} Test\n`
              : '',
        ],
      })
    }
    return spawn(spec)
  }
  ctx.provide('workingDirectory', { get: () => dir })
  ctx.provide('sessionController', {
    resolveAgent: async (id) => (id === 'test' ? { agent: { session: {} } } : { error: { code: 'missing' } }),
  })
  let mode = 'danger-full-access'
  const confined = []
  ctx.provide('sandbox', {
    confine: async (argv) => {
      confined.push(argv)
      return { argv }
    },
  })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode }) })
  await ctx.plugin(plugin, { provider })
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (peer = owner, sessionId = 'test', action, summary = false) => {
    const method = action === undefined ? 'dungsil-vcs/pull-requests/list' : 'dungsil-vcs/pull-requests/action'
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method,
          payload: action === undefined ? { sessionId, summary } : action,
        }),
      }),
      peer
    )
    return response.status === 200 ? (await response.json()).result : { status: response.status }
  }
  return {
    rpc,
    summary: (peer = owner) => rpc(peer, 'test', undefined, true),
    action: (input = {}, peer = owner) =>
      rpc(peer, 'test', { sessionId: 'test', requestUrl: github.url, headSha: sha, action: 'approve', ...input }),
    calls,
    confined,
    confine: () => {
      mode = 'workspace-write'
    },
    dispatch: (value) => {
      dispatch = value
    },
    httpStatus: (value) => {
      httpStatus = value
    },
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
        ...details,
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

await test('GitHub distinguishes a branch without a PR from authentication or transport errors', async (t) => {
  const f = await fixture(t)
  f.dispatch(() => new Error('no pull requests found for branch "feat/sidebar"\n'))
  assert.equal((await f.summary()).value.request, null)
  for (const message of ['HTTP 401: Bad credentials', 'error connecting to api.github.com']) {
    f.dispatch(() => new Error(message))
    assert.equal((await f.summary()).error.code, 'command_failed')
  }
})

await test('overview is available when slow detail endpoints fail, without enabling review or bypassing identity checks', async (t) => {
  const f = await fixture(t)
  f.setRows({ ...github, body: 'Overview without waiting for CI or diff' })
  f.dispatch((args, next) => (!args.includes('--repo') ? next(args) : new Error('detail unavailable')))
  const result = await f.summary()
  assert.equal(result.ok, true)
  assert.equal(result.value.request.title, github.title)
  assert.equal(result.value.request.body, 'Overview without waiting for CI or diff')
  assert.equal(result.value.request.headSha, '')
  assert.equal(result.value.request.diff, '')
  assert.equal((await f.rpc()).value.request.detailsError, true)
  assert.equal((await f.action({ action: 'comment', body: 'Do not send' })).error.code, 'stale_request')
  f.setRows({ ...github, headRepository: { nameWithOwner: 'other/project' } })
  assert.equal((await f.summary()).value.request, null)
  assert.equal((await f.summary({ principal: { kind: 'viewer', sessionId: 'test' } })).status, 403)
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
    body: 'GitLab body',
    headSha: sha,
    mergeable: 'mergeable',
    reviewDecision: 'APPROVED',
    checks: [
      { name: 'Pipeline #7', status: 'success', url: 'https://ci.example/pipeline/7' },
      { name: 'build', status: 'success', url: 'https://ci.example/job/7' },
    ],
    files: [{ path: 'b.ts', additions: 1, deletions: 1 }],
    diff: 'diff --git a/a.ts b/b.ts\n@@ -1 +1 @@\n-old\n+new',
    diffTruncated: false,
    comments: [
      { author: 'bob', body: 'MR comment', url: 'https://gitlab.com/team/sub/project/-/merge_requests/8#note_5' },
    ],
    reviews: [{ author: 'carol', body: '', state: 'APPROVED' }],
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

await test('GitHub actions return completion only, pin reviews and merge to the fresh SHA, and never retry failures', async (t) => {
  const f = await fixture(t)
  f.setRows({ ...github, isDraft: false, reviewDecision: 'APPROVED' })
  for (const action of [
    { action: 'comment', body: '--admin\n$(touch /tmp/nope)' },
    { action: 'approve', body: 'Looks good' },
    { action: 'request_changes', body: 'Please fix' },
    { action: 'merge', strategy: 'squash' },
    { action: 'merge', strategy: 'rebase' },
    { action: 'merge', strategy: 'merge' },
  ]) {
    const before = f.calls.length
    assert.deepEqual(await f.action(action), { ok: true, value: { completed: true } })
    const calls = f.calls.slice(before).map((call) => call.argv)
    assert.equal(calls[0][2], 'view')
    assert.equal(calls[1][2], 'view')
    const mutation = calls.at(-1)
    if (action.action !== 'merge') {
      assert.ok(mutation.includes('repos/team/project/pulls/17/reviews'))
      assert.ok(mutation.includes(`commit_id=${sha}`))
      assert.ok(
        mutation.includes(
          `event=${action.action === 'approve' ? 'APPROVE' : action.action === 'comment' ? 'COMMENT' : 'REQUEST_CHANGES'}`
        )
      )
      assert.ok(mutation.includes(`body=${action.body}`))
      assert.equal(mutation[mutation.indexOf('--hostname') + 1], 'github.com')
    } else {
      assert.ok(mutation.includes('repos/team/project/pulls/17/merge'))
      assert.equal(mutation[mutation.indexOf('--method') + 1], 'PUT')
      assert.ok(mutation.includes(`merge_method=${action.strategy}`))
      assert.ok(mutation.includes(`sha=${sha}`))
    }
    for (const flag of ['--admin', '--auto', '--delete-branch', '--commit-id']) assert.ok(!mutation.includes(flag))
  }
  f.dispatch((args, next) => (args.includes('PUT') ? new Error('denied') : next(args)))
  assert.equal((await f.action({ action: 'merge' })).error.code, 'action_failed')
  assert.equal(f.calls.filter((call) => call.argv.includes('PUT')).length, 4)
})

await test('rejects stale SHA, URL, changed source, absent requests and closed requests without a mutation', async (t) => {
  const f = await fixture(t)
  const mutations = () =>
    f.calls.filter(
      (call) => ['merge', 'comment', 'note', 'approve'].includes(call.argv[2]) || call.argv.includes('POST')
    )
  assert.equal((await f.action({ headSha: 'b'.repeat(40) })).error.code, 'stale_request')
  assert.equal((await f.action({ requestUrl: 'https://github.com/team/other/pull/17' })).error.code, 'stale_request')
  f.dispatch((args, next) => (args[1] === 'view' ? { ...next(args), headRefOid: 'b'.repeat(40) } : next(args)))
  assert.equal((await f.action()).error.code, 'stale_request')
  f.dispatch(undefined)
  f.setRows({ ...github, headRefName: 'other' })
  assert.equal((await f.action()).error.code, 'stale_request')
  f.setRows(null)
  assert.equal((await f.action()).error.code, 'stale_request')
  f.setRows({ ...github, state: 'CLOSED' })
  assert.equal((await f.action()).error.code, 'action_failed')
  assert.equal(mutations().length, 0)
})

await test('validates action allowlist, lengths, URLs, strategy and owner access before invoking a CLI', async (t) => {
  const f = await fixture(t)
  for (const input of [
    { action: 'delete' },
    { action: 'merge', strategy: '--admin' },
    { strategy: 'merge' },
    { action: 'comment' },
    { action: 'request_changes', body: '  ' },
    { body: 'x'.repeat(60_001) },
    { body: 'x\0y' },
    { extra: true },
    { headSha: '--help' },
    { requestUrl: 'javascript:alert(1)' },
    { requestUrl: 'https://user:pass@github.com/team/project/pull/17' },
    { sessionId: 'x'.repeat(257) },
    { action: 'merge', body: 'message' },
  ])
    assert.equal((await f.action(input)).error.code, 'invalid_payload')
  const viewer = { principal: { kind: 'session', sessionId: 'test' }, interactions: 'answer' }
  assert.equal((await f.action({}, viewer)).status, 403)
  assert.equal((await f.action({ sessionId: 'unknown' })).error.code, 'unavailable')
  assert.equal(f.calls.length, 0)
})

await test('detail failures and unsafe secondary links are explicit and prevent actions; large diffs are bounded', async (t) => {
  const f = await fixture(t)
  for (const dispatch of [
    (args, next) => (args[1] === 'diff' ? new Error('failed diff') : next(args)),
    (args, next) =>
      args[1] === 'view'
        ? { ...next(args), statusCheckRollup: [{ name: 'test', status: 'SUCCESS', detailsUrl: 'javascript:alert(1)' }] }
        : next(args),
    (args, next) =>
      args[1] === 'view'
        ? { ...next(args), comments: [{ author: { login: 'bob' }, body: 'bad', url: 'file:///tmp/x' }] }
        : next(args),
  ]) {
    f.dispatch(dispatch)
    assert.equal((await f.rpc()).value.request.detailsError, true)
    assert.equal((await f.action()).error.code, 'action_failed')
  }
  assert.ok(!f.calls.some((call) => call.argv.includes('POST')))
  f.dispatch((args, next) => (args[1] === 'diff' ? 'x'.repeat(130_000) : next(args)))
  const item = (await f.rpc()).value.request
  assert.equal(item.diff.length, 120_000)
  assert.equal(item.diffTruncated, true)
  assert.equal(item.detailsError, undefined)
})

await test('GitLab details and mutations use explicit nested repository and SHA; unsupported actions never write', async (t) => {
  const f = await fixture(t, 'git@gitlab.com:team/sub/project.git')
  const requestUrl = 'https://gitlab.com/team/sub/project/-/merge_requests/8'
  f.setRows([
    {
      iid: 8,
      title: 'MR',
      web_url: requestUrl,
      author: { username: 'alice' },
      source_branch: 'feat/sidebar',
      target_branch: 'main',
      state: 'opened',
      source_project_id: 41,
      target_project_id: 41,
    },
  ])
  assert.equal((await f.rpc()).value.request.checks[1].name, 'build')
  for (const input of [
    { action: 'comment', body: '--help; echo unsafe' },
    { action: 'approve' },
    { action: 'merge', strategy: 'merge' },
    { action: 'merge', strategy: 'squash' },
  ]) {
    assert.deepEqual(await f.action({ ...input, requestUrl }), { ok: true, value: { completed: true } })
    const args = f.calls.at(-1).argv
    assert.equal(args[args.indexOf('--repo') + 1], 'https://gitlab.com/team/sub/project')
    assert.ok(args.includes('8'))
    if (input.action === 'comment') assert.equal(args[args.indexOf('--message') + 1], input.body)
    else assert.equal(args[args.indexOf('--sha') + 1], sha)
    if (input.action === 'merge') {
      assert.ok(args.includes('--auto-merge=false'))
      assert.ok(args.includes('--yes'))
      assert.ok(args.includes(`--squash=${input.strategy === 'squash'}`))
    }
  }
  f.dispatch((args, next) =>
    args.some((arg) => arg.includes('/diffs?'))
      ? [{ old_path: 'a.ts', new_path: 'b.ts', diff: '+'.repeat(120_001) }]
      : next(args)
  )
  assert.equal((await f.rpc()).value.request.diffTruncated, true)
  assert.equal((await f.action({ requestUrl, action: 'approve' })).error.code, 'action_failed')
  assert.equal((await f.action({ requestUrl, action: 'merge', strategy: 'squash' })).ok, true)
  f.dispatch(undefined)
  const writes = () => f.calls.filter((call) => ['approve', 'merge', 'note'].includes(call.argv[2])).length
  const count = writes()
  assert.equal((await f.action({ requestUrl, action: 'merge', strategy: 'rebase' })).error.code, 'unsupported_action')
  assert.equal(
    (await f.action({ requestUrl, action: 'request_changes', body: 'Fix' })).error.code,
    'unsupported_action'
  )
  assert.equal((await f.action({ requestUrl, body: 'Review text' })).error.code, 'unsupported_action')
  assert.equal((await f.action({ requestUrl, headSha: 'b'.repeat(40) })).error.code, 'stale_request')
  assert.equal(writes(), count)
  for (const call of f.calls.filter((call) => call.argv[1] === 'api')) {
    assert.equal(call.argv[call.argv.indexOf('--hostname') + 1], 'gitlab.com')
    assert.ok(call.argv.some((arg) => arg.startsWith('projects/team%2Fsub%2Fproject/')))
  }
  f.dispatch((args, next) => (args[1] === 'approve' ? new Error('denied') : next(args)))
  assert.equal((await f.action({ requestUrl })).error.code, 'action_failed')
  for (const failed of ['/jobs?', '/notes?', '/approvals']) {
    f.dispatch((args, next) => (args.some((arg) => arg.includes(failed)) ? new Error('read denied') : next(args)))
    const partial = (await f.rpc()).value.request
    assert.equal(partial.detailsError, true)
    assert.equal(partial.body, 'GitLab body')
    assert.ok(partial.diff.includes('+new'))
    assert.deepEqual(partial.files, [{ path: 'b.ts', additions: 1, deletions: 1 }])
    assert.equal(partial.checks[0].name, 'Pipeline #7')
    if (failed !== '/approvals') assert.equal(partial.reviews[0].author, 'carol')
    if (failed !== '/notes?') assert.equal(partial.comments[0].body, 'MR comment')
    assert.equal((await f.action({ requestUrl })).error.code, 'action_failed')
  }
})

await test('enterprise GitHub review APIs use the explicit upstream hostname and never remote credentials', async (t) => {
  const f = await fixture(t, 'https://user:secret@git.example.com/team/project.git', 'github')
  const requestUrl = 'https://git.example.com/upstream/project/pull/17'
  f.setRows({ ...github, url: requestUrl, isDraft: false })
  assert.deepEqual(await f.action({ requestUrl }), { ok: true, value: { completed: true } })
  const args = f.calls.at(-1).argv
  assert.ok(args.includes('repos/upstream/project/pulls/17/reviews'))
  assert.equal(args[args.indexOf('--hostname') + 1], 'git.example.com')
  assert.ok(!f.calls.some((call) => call.argv.some((arg) => arg.includes('user:secret'))))
})

await test('a moving GitHub or GitLab head marks the detail snapshot incomplete and prevents mutation', async (t) => {
  for (const provider of ['github', 'gitlab']) {
    const f = await fixture(
      t,
      provider === 'github' ? 'git@github.com:team/project.git' : 'git@gitlab.com:team/project.git'
    )
    const requestUrl = provider === 'github' ? github.url : 'https://gitlab.com/team/project/-/merge_requests/8'
    if (provider === 'gitlab')
      f.setRows([
        {
          iid: 8,
          title: 'MR',
          web_url: requestUrl,
          source_branch: 'feat/sidebar',
          target_branch: 'main',
          state: 'opened',
          source_project_id: 41,
          target_project_id: 41,
        },
      ])
    let views = 0
    f.dispatch((args, next) => {
      if (args[1] !== 'view') return next(args)
      views++
      return { ...next(args), ...(views % 2 === 0 ? { headRefOid: 'b'.repeat(40), sha: 'b'.repeat(40) } : {}) }
    })
    assert.equal((await f.rpc()).value.request.detailsError, true)
    assert.equal((await f.action({ requestUrl, action: 'comment', body: 'Review' })).error.code, 'action_failed')
    assert.ok(!f.calls.some((call) => call.argv.includes('POST') || call.argv[2] === 'note'))
  }
})

await test('approval rejects truncated diffs; merge allows display truncation but rejects drafts, missing diffs and blocked states', async (t) => {
  const f = await fixture(t)
  f.setRows({ ...github, isDraft: false, reviewDecision: 'APPROVED' })
  for (const action of ['approve', 'merge']) {
    for (const dispatch of [
      (args, next) => (args[1] === 'view' ? { ...next(args), isDraft: true } : next(args)),
      (args, next) => (args[1] === 'diff' ? '' : next(args)),
    ]) {
      f.dispatch(dispatch)
      assert.equal((await f.action({ action })).error.code, 'action_failed')
    }
  }
  for (const change of [
    ...['FAILURE', 'PENDING', 'IN_PROGRESS', 'UNKNOWN'].map((status) => ({
      statusCheckRollup: [{ name: 'build', status, detailsUrl: '' }],
    })),
    ...['CHANGES_REQUESTED', 'REVIEW_REQUIRED', 'UNKNOWN'].map((reviewDecision) => ({ reviewDecision })),
    ...['CONFLICTING', 'UNKNOWN'].map((mergeable) => ({ mergeable })),
  ]) {
    f.dispatch((args, next) => (args[1] === 'view' ? { ...next(args), ...change } : next(args)))
    assert.equal((await f.action({ action: 'merge' })).error.code, 'action_failed')
  }
  assert.ok(!f.calls.some((call) => call.argv.includes('POST') || call.argv.includes('PUT')))
  f.dispatch((args, next) => (args[1] === 'diff' ? 'x'.repeat(120_001) : next(args)))
  assert.equal((await f.rpc()).value.request.diffTruncated, true)
  assert.equal((await f.action({ action: 'approve' })).error.code, 'action_failed')
  assert.equal((await f.action({ action: 'merge' })).ok, true)
  f.dispatch((args, next) =>
    args[1] === 'diff'
      ? 'x'.repeat(120_001)
      : args[1] === 'view'
        ? { ...next(args), statusCheckRollup: [{ name: 'build', status: 'FAILURE', detailsUrl: '' }] }
        : next(args)
  )
  assert.equal((await f.action({ action: 'merge' })).error.code, 'action_failed')
  for (const status of ['SUCCESS', 'passed', 'NEUTRAL', 'SKIPPED']) {
    f.dispatch((args, next) =>
      args[1] === 'view'
        ? { ...next(args), statusCheckRollup: [{ name: 'build', status, detailsUrl: '' }] }
        : next(args)
    )
    assert.equal((await f.action({ action: 'merge' })).ok, true)
  }
  f.dispatch((args, next) => (args.includes('PUT') ? { merged: false, message: 'not merged' } : next(args)))
  assert.equal((await f.action({ action: 'merge' })).error.code, 'action_failed')
})

await test('confines every CLI command and rejects simultaneous session actions without retrying', async (t) => {
  const f = await fixture(t)
  f.confine()
  const input = { action: 'comment', body: '@private-file; $(echo no)' }
  const results = await Promise.all([f.action(input), f.action(input)])
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.find((result) => !result.ok).error.code, 'action_failed')
  assert.equal(f.calls.filter((call) => call.argv.includes('POST')).length, 1)
  assert.ok(f.confined.some((argv) => argv.includes('symbolic-ref')))
  for (const call of f.calls) {
    assert.ok(f.confined.some((argv) => JSON.stringify(argv) === JSON.stringify(call.argv)))
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GH_REPO', 'GH_HOST', 'GITLAB_REPO', 'GITLAB_HOST'])
      assert.equal(call.env[key], undefined)
  }
  assert.equal((await f.action(input)).ok, true)
  assert.equal(f.calls.filter((call) => call.argv.includes('POST')).length, 2)
})

await test('GitLab detail pagination loads later comments and fails explicitly on malformed pages', async (t) => {
  const f = await fixture(t, 'git@gitlab.com:team/project.git')
  const requestUrl = 'https://gitlab.com/team/project/-/merge_requests/8'
  f.setRows([
    {
      iid: 8,
      title: 'MR',
      web_url: requestUrl,
      source_branch: 'feat/sidebar',
      target_branch: 'main',
      state: 'opened',
      source_project_id: 41,
      target_project_id: 41,
    },
  ])
  f.dispatch((args, next) => {
    const endpoint = args.find((arg) => arg.includes('/notes?'))
    if (!endpoint) return next(args)
    if (endpoint.includes('page=2'))
      return [{ id: 101, author: { username: 'last' }, body: 'last comment', system: false }]
    return Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      author: { username: 'first' },
      body: 'comment',
      system: false,
    }))
  })
  const item = (await f.rpc()).value.request
  assert.equal(item.detailsError, undefined)
  assert.equal(item.comments.length, 101)
  assert.equal(item.comments.at(-1).body, 'last comment')
  f.dispatch((args, next) => (args.some((arg) => arg.includes('/notes?')) ? { error: 'not an array' } : next(args)))
  assert.equal((await f.rpc()).value.request.detailsError, true)
})

await test('GitLab uses the newest head pipeline, keeps its status without jobs, and permits zero required approvals', async (t) => {
  const f = await fixture(t, 'git@gitlab.com:team/project.git')
  const requestUrl = 'https://gitlab.com/team/project/-/merge_requests/8'
  f.setRows([
    {
      iid: 8,
      title: 'MR',
      web_url: requestUrl,
      source_branch: 'feat/sidebar',
      target_branch: 'main',
      state: 'opened',
      source_project_id: 41,
      target_project_id: 41,
    },
  ])
  let status = 'success'
  let required = 0
  f.dispatch((args, next) => {
    if (args.some((arg) => arg.includes('/merge_requests/') && arg.includes('/pipelines?')))
      return [
        { id: 6, sha, status: 'failed', web_url: 'https://ci.example/pipeline/6' },
        { id: 99, sha: 'b'.repeat(40), status: 'failed', web_url: 'https://ci.example/pipeline/99' },
        { id: 7, sha, status, web_url: 'https://ci.example/pipeline/7' },
      ]
    if (args.some((arg) => arg.includes('/jobs?'))) return []
    if (args.some((arg) => arg.endsWith('/approvals')))
      return { approved: false, approvals_required: required, approvals_left: required, approved_by: [] }
    return next(args)
  })
  const item = (await f.rpc()).value.request
  assert.equal(item.detailsError, undefined)
  assert.equal(item.reviewDecision, '')
  assert.deepEqual(item.checks, [{ name: 'Pipeline #7', status: 'success', url: 'https://ci.example/pipeline/7' }])
  assert.equal((await f.action({ requestUrl, action: 'merge' })).ok, true)
  assert.ok(!f.calls.some((call) => call.argv.some((arg) => /\/pipelines\/(6|99)\/jobs/.test(arg))))
  const writes = () => f.calls.filter((call) => call.argv[2] === 'merge').length
  const count = writes()
  for (status of ['failed', 'pending', 'running', 'unknown']) {
    const blocked = (await f.rpc()).value.request
    assert.equal(blocked.detailsError, undefined)
    assert.equal(blocked.checks[0].status, status)
    assert.equal((await f.action({ requestUrl, action: 'merge' })).error.code, 'action_failed')
  }
  status = 'success'
  required = 1
  assert.equal((await f.rpc()).value.request.reviewDecision, 'REVIEW_REQUIRED')
  assert.equal((await f.action({ requestUrl, action: 'merge' })).error.code, 'action_failed')
  assert.equal(writes(), count)
})

await test('GitLab merged-result CI verifies the current head pipeline commit parent and never trusts older merge results', async (t) => {
  const f = await fixture(t, 'git@gitlab.com:team/project.git')
  const requestUrl = 'https://gitlab.com/team/project/-/merge_requests/8'
  const mergeSha = 'c'.repeat(40)
  const pipeline = {
    id: 10,
    project_id: 41,
    sha: mergeSha,
    ref: 'refs/merge-requests/8/merge',
    status: 'failed',
    web_url: 'https://ci.example/pipeline/10',
  }
  const mr = {
    iid: 8,
    title: 'MR',
    web_url: requestUrl,
    source_branch: 'feat/sidebar',
    target_branch: 'main',
    state: 'opened',
    source_project_id: 41,
    target_project_id: 41,
    head_pipeline: pipeline,
  }
  f.setRows([mr])
  let parents = ['b'.repeat(40), sha]
  let commitFailure = false
  f.dispatch((args, next) => {
    if (args.some((arg) => arg.includes('/repository/commits/')))
      return commitFailure ? new Error('commit unavailable') : { id: mergeSha, parent_ids: parents }
    if (args.some((arg) => arg.includes('/merge_requests/') && arg.includes('/pipelines?')))
      return [
        { ...pipeline, id: 9, status: 'success' },
        { id: 7, sha, status: 'success', web_url: 'https://ci.example/pipeline/7' },
      ]
    if (args.some((arg) => arg.includes('/pipelines/10/jobs?')))
      return [{ name: 'integration', status: pipeline.status, web_url: 'https://ci.example/job/10' }]
    return next(args)
  })
  const item = (await f.rpc()).value.request
  assert.equal(item.detailsError, undefined)
  assert.deepEqual(item.checks, [
    { name: 'Pipeline #10', status: 'failed', url: 'https://ci.example/pipeline/10' },
    { name: 'integration', status: 'failed', url: 'https://ci.example/job/10' },
  ])
  assert.equal((await f.action({ requestUrl, action: 'merge' })).error.code, 'action_failed')
  const commitCall = f.calls.find((call) => call.argv.some((arg) => arg.includes('/repository/commits/'))).argv
  assert.ok(commitCall.includes(`projects/team%2Fproject/repository/commits/${mergeSha}`))
  assert.equal(commitCall[commitCall.indexOf('--hostname') + 1], 'gitlab.com')
  assert.ok(!f.calls.some((call) => call.argv.some((arg) => /\/pipelines\/(7|9)\/jobs/.test(arg))))

  pipeline.status = 'success'
  assert.equal((await f.action({ requestUrl, action: 'merge' })).ok, true)
  const jobs = () => f.calls.filter((call) => call.argv.some((arg) => arg.includes('/jobs?'))).length
  const count = jobs()
  parents = ['d'.repeat(40), 'e'.repeat(40)]
  const stale = (await f.rpc()).value.request
  assert.equal(stale.detailsError, true)
  assert.deepEqual(stale.checks, [])
  assert.ok(stale.diff.includes('+new'))
  assert.equal((await f.action({ requestUrl, action: 'merge' })).error.code, 'action_failed')
  assert.equal(jobs(), count)

  parents = ['b'.repeat(40), sha]
  pipeline.project_id = 42
  assert.equal((await f.rpc()).value.request.detailsError, true)
  assert.equal(jobs(), count)
  pipeline.project_id = 41
  commitFailure = true
  assert.equal((await f.rpc()).value.request.detailsError, true)
  assert.equal(jobs(), count)

  // Without this snapshot's merged-result head pipeline, historical /merge
  // pipelines cannot be selected just because they were returned by the MR API.
  mr.head_pipeline = null
  f.dispatch((args, next) =>
    args.some((arg) => arg.includes('/merge_requests/') && arg.includes('/pipelines?'))
      ? [{ ...pipeline, id: 9, status: 'success' }]
      : next(args)
  )
  const unrelated = (await f.rpc()).value.request
  assert.equal(unrelated.detailsError, true)
  assert.deepEqual(unrelated.checks, [])
  assert.equal(jobs(), count)
})

const forge = {
  number: 23,
  title: 'Review a feature',
  html_url: 'https://forge.example:3443/git/team/project/pulls/23',
  user: { login: 'alice' },
  head: { ref: 'feat/sidebar', sha, repo: { full_name: 'team/project' } },
  base: { ref: 'release', repo: { full_name: 'team/project' } },
  draft: false,
  merged: false,
  mergeable: true,
  state: 'open',
  body: '## Summary\nA forge request',
  changed_files: 1,
}

await test('Gitea and Forgejo load the same sidebar details and support comments, reviews and SHA-conditional merges', async (t) => {
  for (const provider of ['gitea', 'forgejo']) {
    const f = await fixture(t, 'https://forge.example:3443/git/team/project.git', provider)
    f.setRows(forge)
    f.dispatch((args, next) => (args.at(-1).includes('/files?') && args.at(-1).endsWith('page=2') ? null : next(args)))
    const result = await f.rpc()
    assert.equal(result.ok, true)
    assert.equal(result.value.provider, provider)
    const item = result.value.request
    assert.equal(item.detailsError, undefined)
    assert.equal(item.url, forge.html_url)
    assert.equal(item.headSha, sha)
    assert.equal(item.mergeable, 'MERGEABLE')
    assert.equal(item.reviewDecision, 'APPROVED')
    assert.equal(item.body, forge.body)
    assert.deepEqual(item.files, [{ path: 'src/main.ts', additions: 2, deletions: 1 }])
    assert.deepEqual(item.checks, [{ name: 'build', status: 'success', url: 'https://ci.example/job/7' }])
    assert.equal(item.diff, details.diff)
    assert.equal(item.comments[0].body, 'Comment')
    assert.equal(item.reviews[0].author, 'carol')
    f.confine()
    for (const input of [
      { action: 'comment', body: '@private-file; $(echo unsafe)\ntrue' },
      { action: 'approve', body: 'Reviewed' },
      { action: 'request_changes', body: 'Please fix this' },
      ...['merge', 'squash', 'rebase'].map((strategy) => ({ action: 'merge', strategy })),
    ]) {
      assert.deepEqual(await f.action({ requestUrl: forge.html_url, ...input }), {
        ok: true,
        value: { completed: true },
      })
      const args = f.calls.at(-1).argv
      assert.equal(args[args.indexOf('--login') + 1], 'work')
      assert.ok(args.includes('POST'))
      if (input.body) assert.ok(args.includes(`body=${input.body}`))
      if (input.action === 'merge') {
        assert.ok(args.includes(`head_commit_id=${sha}`))
        assert.ok(args.includes(`Do=${input.strategy}`))
        for (const field of ['force_merge=false', 'delete_branch_after_merge=false', 'merge_when_checks_succeed=false'])
          assert.ok(args.includes(field))
      } else if (input.action !== 'comment') {
        assert.ok(args.includes(`commit_id=${sha}`))
        assert.ok(args.includes(`event=${input.action === 'approve' ? 'APPROVED' : 'REQUEST_CHANGES'}`))
      }
    }
    for (const call of f.calls.filter((call) => call.argv[1] === 'api')) {
      assert.match(call.argv.at(-1), /^https:\/\/forge\.example:3443\/git\/api\/v1\/repos\/team\/project(?:\/|$)/)
      for (const key of ['GITEA_INSTANCE_URL', 'GITEA_TOKEN', 'GH_TOKEN', 'TEA_LOGIN'])
        assert.equal(call.env[key], undefined)
    }
    assert.ok(f.confined.some((argv) => argv[0] === 'tea'))
  }
})

await test('forge lookups select an exact configured instance, preserve SSH web ports and prefixes, and fail on HTTP errors', async (t) => {
  const f = await fixture(t, 'ssh://git@forge.example:2222/team/project.git', 'forgejo')
  f.setRows(forge)
  assert.equal((await f.rpc()).value.request.url, forge.html_url)
  f.dispatch((args, next) =>
    args[0] === 'login' ? [{ name: 'wrong', url: 'https://other.invalid', ssh_host: 'other.invalid' }] : next(args)
  )
  const reads = f.calls.length
  assert.equal((await f.rpc()).ok, false)
  assert.equal(f.calls.length, reads + 1) // Only public login metadata was inspected.
  f.dispatch((args, next) =>
    args[0] === 'login' ? [...next(args), { ...next(args)[1], name: 'ambiguous' }] : next(args)
  )
  assert.equal((await f.rpc()).ok, false)
  f.dispatch(undefined)
  f.httpStatus(403)
  assert.equal((await f.rpc()).error.code, 'command_failed') // tea itself still exits zero.
  assert.ok(!f.calls.some((call) => call.argv.includes('POST')))
  f.httpStatus(200)
  f.dispatch((args, next) => {
    if (args.includes('POST')) f.httpStatus(409)
    return next(args)
  })
  assert.equal((await f.action({ requestUrl: forge.html_url, action: 'merge' })).error.code, 'action_failed')
  assert.equal(f.calls.filter((call) => call.argv.includes('POST')).length, 1)
  const publicForge = await fixture(t, 'git@codeberg.org:team/project.git', 'auto', 'https://codeberg.org')
  publicForge.setRows({ ...forge, html_url: 'https://codeberg.org/team/project/pulls/23' })
  assert.equal((await publicForge.rpc()).value.provider, 'forgejo')
  publicForge.dispatch((args, next) =>
    args.some((arg) => arg.includes('/branches/'))
      ? { ...next(args), enable_status_check: false, status_check_contexts: null }
      : next(args)
  )
  assert.equal((await publicForge.rpc()).value.request.detailsError, undefined)
})

await test('forge CI, required reviews, missing details, permissions and stale heads block mutations without bypasses', async (t) => {
  const f = await fixture(t, 'https://forge.example:3443/git/team/project.git', 'gitea')
  f.setRows(forge)
  const mutations = () => f.calls.filter((call) => call.argv.includes('POST')).length
  for (const override of [
    (args, next) =>
      args.some((arg) => arg.includes('/statuses/') && arg.endsWith('page=1'))
        ? [{ id: 7, context: 'build', status: 'pending', target_url: '' }]
        : next(args),
    (args, next) => (args.some((arg) => arg.includes('/statuses/')) ? [] : next(args)),
    (args, next) => (args.some((arg) => arg.includes('/reviews?')) ? [] : next(args)),
    (args, next) =>
      args.some((arg) => arg.includes('/reviews?') && arg.endsWith('page=1'))
        ? [...next(args), { ...next(args)[0], id: 99, dismissed: true }]
        : next(args),
    (args, next) =>
      args.some((arg) => arg.includes('/branches/')) ? { ...next(args), user_can_merge: false } : next(args),
    (args, next) => (args.at(-1).endsWith('.diff') ? new Error('diff unavailable') : next(args)),
  ]) {
    f.dispatch(override)
    assert.equal((await f.action({ requestUrl: forge.html_url, action: 'merge' })).error.code, 'action_failed')
  }
  assert.equal(mutations(), 0)
  f.dispatch(undefined)
  assert.equal((await f.action({ requestUrl: forge.html_url, headSha: 'b'.repeat(40) })).error.code, 'stale_request')
  f.setRows({ ...forge, draft: true })
  assert.equal((await f.action({ requestUrl: forge.html_url })).error.code, 'action_failed')
  f.setRows({ ...forge, head: { ...forge.head, repo: { full_name: 'someone/project' } } })
  assert.equal((await f.rpc()).value.request, null)
  f.setRows(forge)
  f.dispatch((args, next) => (args.at(-1).endsWith('.diff') ? 'x'.repeat(120_001) : next(args)))
  assert.equal((await f.action({ requestUrl: forge.html_url })).error.code, 'action_failed')
  assert.equal((await f.action({ requestUrl: forge.html_url, action: 'merge' })).ok, true)
  assert.equal(mutations(), 1)
})

await test('forge pagination includes capped later pages and latest CI reruns, and finds PRs in the fork parent', async (t) => {
  const f = await fixture(t, 'https://forge.example:3443/git/team/project.git', 'forgejo')
  const parentRequest = {
    ...forge,
    html_url: 'https://forge.example:3443/git/upstream/project/pulls/23',
    base: { ...forge.base, repo: { full_name: 'upstream/project' } },
  }
  f.setRows(parentRequest)
  f.dispatch((args, next) => {
    const endpoint = args.at(-1)
    if (endpoint.endsWith('/repos/team/project')) return { ...next(args), parent: { full_name: 'upstream/project' } }
    if (endpoint.includes('/repos/team/project/pulls?')) return []
    if (endpoint.includes('/reviews?')) {
      const page = new URL(endpoint).searchParams.get('page')
      return page === '1'
        ? [
            {
              id: 2,
              user: { login: 'carol' },
              body: 'Older rejection',
              state: 'REQUEST_CHANGES',
              commit_id: sha,
              official: true,
            },
          ]
        : page === '2'
          ? [{ id: 3, user: { login: 'carol' }, body: 'Approved', state: 'APPROVED', commit_id: sha, official: true }]
          : []
    }
    if (endpoint.includes('/statuses/')) {
      const page = new URL(endpoint).searchParams.get('page')
      return page === '1'
        ? [{ id: 9, context: 'build', status: 'success', target_url: '' }]
        : page === '2'
          ? [{ id: 8, context: 'build', status: 'failure', target_url: '' }]
          : []
    }
    return next(args)
  })
  const result = (await f.rpc()).value.request
  assert.equal(result.detailsError, undefined)
  assert.equal(result.url, parentRequest.html_url)
  assert.equal(result.reviewDecision, 'APPROVED')
  assert.deepEqual(result.checks, [{ name: 'build', status: 'success', url: '' }])
  assert.equal(result.reviews.length, 2)
  assert.equal((await f.action({ requestUrl: parentRequest.html_url, action: 'merge' })).ok, true)
  assert.ok(f.calls.at(-1).argv.at(-1).includes('/api/v1/repos/upstream/project/pulls/23/merge'))
})

await test('self-managed GitLab uses the configured provider, HTTPS port and nested namespace for reads and writes', async (t) => {
  const f = await fixture(t, 'https://user:secret@gitlab.example:8443/team/sub/project.git', 'gitlab')
  const requestUrl = 'https://gitlab.example:8443/team/sub/project/-/merge_requests/8'
  f.setRows([
    {
      iid: 8,
      title: 'Self-managed MR',
      web_url: requestUrl,
      author: { username: 'alice' },
      source_branch: 'feat/sidebar',
      target_branch: 'release',
      state: 'opened',
      source_project_id: 41,
      target_project_id: 41,
    },
  ])
  assert.equal((await f.rpc()).value.request.detailsError, undefined)
  assert.equal((await f.action({ requestUrl, action: 'comment', body: 'Review' })).ok, true)
  for (const { argv } of f.calls) {
    if (argv.includes('--hostname')) assert.equal(argv[argv.indexOf('--hostname') + 1], 'gitlab.example:8443')
    if (argv.includes('--repo'))
      assert.equal(argv[argv.indexOf('--repo') + 1], 'https://gitlab.example:8443/team/sub/project')
    assert.ok(!argv.some((arg) => arg.includes('user:secret')))
  }
})
