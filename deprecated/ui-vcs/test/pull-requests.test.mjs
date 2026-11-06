import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { describe } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
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
      return rows === null
        ? null
        : {
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
    `import { readFileSync } from 'node:fs'; process.stdout.write(readFileSync(process.argv[2])); process.stderr.write(process.argv[4] ?? ''); process.exitCode = Number(process.argv[3])`
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
      const output = join(dir, `response-${calls.length}.json`)
      writeFileSync(output, value instanceof Error ? '' : typeof value === 'string' ? value : JSON.stringify(value))
      return spawn({
        ...spec,
        argv: [
          process.execPath,
          cli,
          output,
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
  const inspections = []
  const activations = []
  const closes = []
  ctx.provide('sessionController', {
    resolveAgent: async (id) => {
      activations.push(id)
      return id === 'test' ? { agent: { session: {} } } : { error: { code: 'missing' } }
    },
  })
  ctx.provide('sessionPersistence', {
    open: async (id, access, { signal }) => {
      assert.equal(access, 'read')
      signal.throwIfAborted()
      inspections.push(id)
      if (id !== 'test') throw new Error('missing')
      return {
        header: { version: SESSION_FORMAT_VERSION, id, cwd: dir, createdAt: 0, isSeeded: false },
        inheritedEventCount: 0,
        read: async (start, end, options) => {
          assert.equal(start, undefined)
          assert.equal(end, undefined)
          assert.equal(options.signal, signal)
          signal.throwIfAborted()
          return { events: [] }
        },
        close: async () => {
          closes.push(id)
        },
      }
    },
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
  const rpc = async (peer = owner, sessionId = 'test', action, requestUrl, summary = false) => {
    const method = action === undefined ? 'dungsil-vcs/pull-requests/list' : 'dungsil-vcs/pull-requests/action'
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method,
          payload:
            action === undefined ? { sessionId, summary, ...(requestUrl === undefined ? {} : { requestUrl }) } : action,
        }),
      }),
      peer
    )
    return response.status === 200 ? (await response.json()).result : { status: response.status }
  }
  return {
    rpc,
    inspections,
    activations,
    closes,
    summary: (peer = owner, requestUrl) => rpc(peer, 'test', undefined, requestUrl, true),
    lookup: (requestUrl, peer = owner) => rpc(peer, 'test', undefined, requestUrl),
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

// Each test owns its repository, Cordis context and CLI responses.
await describe('PR RPC는 조회와 변경 계약을 유지한다', { concurrency: 4 }, async () => {
  await test('콜드 세션의 PR 조회는 Agent를 활성화하지 않고 저장된 세션만 읽는다', async (t) => {
    const f = await fixture(t)
    assert.equal((await f.summary()).ok, true)
    assert.equal((await f.rpc()).ok, true)
    assert.deepEqual(f.inspections, ['test', 'test'])
    assert.deepEqual(f.activations, [])
    assert.deepEqual(f.closes, ['test', 'test'])
  })

  await test('현재 브랜치의 PR만 표시하고, 없는 요청·실패한 조회·CLI 없음을 구분한다', async (t) => {
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

  await test('GitHub은 PR이 없는 브랜치와 인증·전송 오류를 구분한다', async (t) => {
    const f = await fixture(t)
    f.dispatch(() => new Error('no pull requests found for branch "feat/sidebar"\n'))
    assert.equal((await f.summary()).value.request, null)
    for (const message of ['HTTP 401: Bad credentials', 'error connecting to api.github.com']) {
      f.dispatch(() => new Error(message))
      assert.equal((await f.summary()).error.code, 'command_failed')
    }
  })

  await test('느린 세부 정보 엔드포인트가 실패해도 리뷰를 활성화하거나 신원 검사를 우회하지 않고 개요를 제공한다', async (t) => {
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

  await test('명시적 GitHub URL은 현재가 아닌 정확한 PR을 불러오고, 변경은 여전히 현재 브랜치를 대상으로 한다', async (t) => {
    const f = await fixture(t)
    const clicked = {
      ...github,
      number: 29,
      url: 'https://github.com/team/project/pull/29',
      headRefName: 'different-branch',
      headRepository: { nameWithOwner: 'contributor/fork' },
    }
    f.dispatch((args, next) =>
      args[1] === 'view' && args.includes('--repo') ? { ...next(args), ...clicked } : next(args)
    )
    const overview = await f.summary(owner, clicked.url)
    assert.equal(overview.value.request.number, 29)
    assert.equal(overview.value.request.body, details.body)
    assert.equal(overview.value.request.headSha, '')
    assert.equal(f.calls.length, 1)
    for (const suffix of ['', '/files', '/commits', '/checks']) {
      const before = f.calls.length
      const result = await f.lookup(`${clicked.url}${suffix}?diff=split#discussion_r1`)
      assert.equal(result.ok, true)
      assert.equal(result.value.branch, 'feat/sidebar')
      assert.equal(result.value.request.number, 29)
      assert.equal(result.value.request.url, clicked.url)
      assert.equal(result.value.request.source, 'different-branch')
      assert.equal(result.value.request.detailsError, undefined)
      const calls = f.calls.slice(before).map((call) => call.argv)
      assert.deepEqual(calls[0].slice(0, 6), ['gh', 'pr', 'view', '29', '--repo', 'https://github.com/team/project'])
      assert.ok(!calls.some((args) => args[2] === 'status'))
    }
    assert.equal((await f.rpc()).value.request.number, 17)
    const before = f.calls.length
    assert.equal(
      (await f.action({ requestUrl: clicked.url, action: 'comment', body: 'Do not mutate another PR' })).error.code,
      'stale_request'
    )
    assert.equal(f.calls[before].argv[2], 'view')
    assert.ok(!f.calls.some((call) => call.argv.includes('POST') || call.argv.includes('PUT')))
  })

  await test('명시적 URL은 관련 없는 저장소·호스트·잘못된 ID를 클릭한 대상 조회 없이 거부한다', async (t) => {
    const f = await fixture(t)
    for (const requestUrl of [
      'https://github.com/other/project/pull/29',
      'https://github.com/team/other/pull/29',
      'https://other.example/team/project/pull/29',
      'https://github.com.evil.example/team/project/pull/29',
      'http://github.com/team/project/pull/29',
      'https://github.com:8443/team/project/pull/29',
      'https://user:secret@github.com/team/project/pull/29',
      'https://@github.com/team/project/pull/29',
      'https://:@github.com/team/project/pull/29',
      'javascript:alert(1)',
      '//github.com/team/project/pull/29',
      'not a URL',
      `${github.url}/reviews`,
      'https://github.com/team/project/pull/0',
      'https://github.com/team/project/pull/-1',
      'https://github.com/team/project/pull/9007199254740992',
      'https://github.com/team/project/pull/%32%39',
      'https://github.com/team/project/other/../pull/29',
      'https://github.com/team/project/pull/29\\files',
      `${github.url}?${'x'.repeat(4096)}`,
      '',
      null,
      29,
      {},
    ]) {
      const result = await f.lookup(requestUrl)
      assert.equal(result.ok, false, JSON.stringify(requestUrl))
      assert.equal(result.error.code, 'unsupported', JSON.stringify(requestUrl))
    }
    assert.ok(f.calls.every((call) => call.argv[0] === 'gh'))
    assert.ok(f.calls.every((call) => ['view', 'diff'].includes(call.argv[2])))
    assert.ok(f.calls.every((call) => !call.argv.includes('--repo') || call.argv[3] === github.url))
    const before = f.calls.length
    const viewer = { principal: { kind: 'session', sessionId: 'test' }, interactions: 'answer' }
    assert.equal((await f.lookup(github.url, viewer)).status, 403)
    assert.equal(f.calls.length, before)
  })

  await test('명시적 GitHub 링크는 저장소 대소문자와 현재 업스트림 포크 관계를 보존한다', async (t) => {
    const mixed = await fixture(t, 'git@github.com:Team/Project.git')
    assert.equal((await mixed.lookup(github.url)).value.request.url, github.url)
    assert.equal((await mixed.lookup('https://github.com/TEAM/PROJECT/pull/17')).value.request.url, github.url)
    const fork = await fixture(t)
    const upstream = 'https://github.com/upstream/project/pull/17'
    fork.setRows({ ...github, url: upstream })
    const overview = await fork.summary(owner, upstream)
    assert.equal(overview.value.request.url, upstream)
    assert.equal(overview.value.request.headSha, '')
    assert.equal(fork.calls.length, 1)
    const result = await fork.lookup(`${upstream}/files#discussion`)
    assert.equal(result.ok, true)
    assert.equal(result.value.request.url, upstream)
    assert.equal(fork.calls[0].argv[2], 'view')
    const mismatch = await fork.lookup('https://github.com/upstream/project/pull/18')
    assert.equal(mismatch.error.code, 'unsupported')
    assert.ok(!fork.calls.some((call) => call.argv.includes('18')))
  })

  await test('명시적 GitHub 조회는 다른 요청에 대한 CLI 응답을 폴백 없이 거부한다', async (t) => {
    const f = await fixture(t)
    assert.equal((await f.lookup('https://github.com/team/project/pull/29')).error.code, 'invalid_response')
    assert.equal(f.calls.length, 1)
    f.setRows(null)
    assert.equal((await f.lookup(github.url)).error.code, 'invalid_response')
  })

  await test('명시적 GitLab URL은 신뢰된 중첩 프로젝트에서 현재가 아닌 정확한 MR을 불러온다', async (t) => {
    const f = await fixture(t, 'git@gitlab.com:team/sub/project.git')
    const requestUrl = 'https://gitlab.com/team/sub/project/-/merge_requests/29'
    f.setRows([
      {
        iid: 29,
        title: 'A different MR',
        web_url: requestUrl,
        source_branch: 'other-branch',
        target_branch: 'main',
        state: 'opened',
        source_project_id: 42,
        target_project_id: 41,
      },
    ])
    const result = await f.lookup(`${requestUrl}?view=inline#note_1`)
    assert.equal(result.ok, true)
    assert.equal(result.value.request.number, 29)
    assert.equal(result.value.request.source, 'other-branch')
    assert.equal(result.value.request.detailsError, undefined)
    assert.deepEqual(f.calls[0].argv.slice(0, 6), [
      'glab',
      'mr',
      'view',
      '29',
      '--repo',
      'https://gitlab.com/team/sub/project',
    ])
    assert.ok(!f.calls.some((call) => call.argv[2] === 'list'))
    const before = f.calls.length
    assert.equal((await f.lookup('https://gitlab.com/team/other/-/merge_requests/29')).error.code, 'unsupported')
    assert.equal(f.calls.length, before)
    assert.equal((await f.action({ requestUrl, action: 'comment', body: 'Not current' })).error.code, 'stale_request')
    assert.ok(!f.calls.some((call) => call.argv[2] === 'note'))
  })

  await test('추적 중인 GitLab 리모트를 사용하고, 중첩 그룹을 보존하며, MR 초안 필드를 정규화한다', async (t) => {
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

  await test('잘못된 CLI 데이터와 안전하지 않은 링크를 노출하지 않고 거부한다', async (t) => {
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

  await test('공유 뷰어와 알 수 없는 세션을 거부하고, 없는 리모트를 보고한다', async (t) => {
    const f = await fixture(t)
    const viewer = { principal: { kind: 'session', sessionId: 'test' }, interactions: 'answer' }
    assert.equal((await f.rpc(viewer)).status, 403)
    assert.equal((await f.rpc(owner, 'unknown')).error.code, 'unavailable')
    f.git('remote', 'remove', 'origin')
    assert.equal((await f.rpc()).error.code, 'repository')
  })

  await test('엔터프라이즈 호스트에는 명시적 provider 설정을 요구하고 리모트 userinfo는 절대 전달하지 않는다', async (t) => {
    const remote = 'https://user:private@git.example.com/team/project.git'
    const auto = await fixture(t, remote)
    assert.equal((await auto.rpc()).error.code, 'unsupported')
    const enterprise = await fixture(t, remote, 'github')
    enterprise.setRows({ ...github, url: 'https://git.example.com/team/project/pull/17' })
    assert.equal((await enterprise.rpc()).value.repository, 'git.example.com/team/project')
  })

  await test('GitHub 작업은 완료 여부만 반환하고, 리뷰와 병합을 최신 SHA에 고정하며, 실패를 절대 재시도하지 않는다', async (t) => {
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

  await test('오래된 SHA, URL, 변경된 소스, 없는 요청, 닫힌 요청은 변경 없이 거부한다', async (t) => {
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

  await test('CLI를 호출하기 전에 작업 허용 목록, 길이, URL, 전략, 소유자 접근 권한을 검증한다', async (t) => {
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

  await test('세부 정보 실패와 안전하지 않은 보조 링크는 명시적으로 드러나 작업을 막고, 큰 차이는 길이가 제한된다', async (t) => {
    const f = await fixture(t)
    for (const dispatch of [
      (args, next) => (args[1] === 'diff' ? new Error('failed diff') : next(args)),
      (args, next) =>
        args[1] === 'view'
          ? {
              ...next(args),
              statusCheckRollup: [{ name: 'test', status: 'SUCCESS', detailsUrl: 'javascript:alert(1)' }],
            }
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

  await test('GitLab 세부 정보와 변경은 명시적 중첩 저장소와 SHA를 사용하고, 지원하지 않는 작업은 절대 쓰지 않는다', async (t) => {
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

  await test('엔터프라이즈 GitHub 리뷰 API는 명시적 업스트림 호스트 이름을 사용하고 리모트 자격 증명은 절대 사용하지 않는다', async (t) => {
    const f = await fixture(t, 'https://user:secret@git.example.com/team/project.git', 'github')
    const requestUrl = 'https://git.example.com/upstream/project/pull/17'
    f.setRows({ ...github, url: requestUrl, isDraft: false })
    assert.deepEqual(await f.action({ requestUrl }), { ok: true, value: { completed: true } })
    const args = f.calls.at(-1).argv
    assert.ok(args.includes('repos/upstream/project/pulls/17/reviews'))
    assert.equal(args[args.indexOf('--hostname') + 1], 'git.example.com')
    assert.ok(!f.calls.some((call) => call.argv.some((arg) => arg.includes('user:secret'))))
  })

  await test('GitHub 또는 GitLab의 head가 이동하면 세부 정보 스냅샷을 불완전으로 표시하고 변경을 막는다', async (t) => {
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

  await test('승인은 잘린 차이를 거부하고, 병합은 표시용 잘림은 허용하지만 초안, 없는 차이, 차단된 상태는 거부한다', async (t) => {
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

  await test('모든 CLI 명령을 격리하고 동시 세션 작업을 재시도 없이 거부한다', async (t) => {
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

  await test('GitLab 세부 정보 페이지네이션은 이후 댓글을 불러오고 형식이 잘못된 페이지에서는 명시적으로 실패한다', async (t) => {
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

  await test('GitLab은 가장 최신 head 파이프라인을 사용하고, 작업이 없어도 그 상태를 유지하며, 필수 승인 0개를 허용한다', async (t) => {
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

  await test('GitLab 병합 결과 CI는 현재 head 파이프라인 커밋의 부모를 검증하고 이전 병합 결과는 절대 신뢰하지 않는다', async (t) => {
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

  await test('명시적 forge URL은 브랜치 탐색이 아니라 신뢰된 로그인 포트와 접두사를 사용해 정확한 PR을 읽는다', async (t) => {
    for (const remote of [
      'https://forge.example:3443/git/team/project.git',
      'ssh://git@forge.example:2222/team/project.git',
    ]) {
      const f = await fixture(t, remote, 'forgejo')
      const clicked = {
        ...forge,
        number: 29,
        html_url: 'https://forge.example:3443/git/team/project/pulls/29',
        head: { ...forge.head, ref: 'different-branch', repo: { full_name: 'contributor/fork' } },
      }
      f.setRows(clicked)
      const result = await f.lookup(`${clicked.html_url}?view=split#issuecomment-1`)
      assert.equal(result.ok, true)
      assert.equal(result.value.request.number, 29)
      assert.equal(result.value.request.source, 'different-branch')
      assert.equal(result.value.request.detailsError, undefined)
      const api = f.calls.filter((call) => call.argv[1] === 'api')
      assert.equal(api[0].argv.at(-1), 'https://forge.example:3443/git/api/v1/repos/team/project/pulls/29')
      assert.ok(api.every((call) => call.argv[call.argv.indexOf('--login') + 1] === 'work'))
      assert.ok(!api.some((call) => call.argv.at(-1).includes('/pulls?')))
      const before = api.length
      assert.equal(
        (await f.lookup('https://forge.example:3443/git/unrelated/project/pulls/29')).error.code,
        'unsupported'
      )
      assert.ok(
        f.calls
          .filter((call) => call.argv[1] === 'api')
          .slice(before)
          .every((call) => call.argv.at(-1).startsWith('https://forge.example:3443/git/api/v1/repos/team/project'))
      )
      assert.equal(
        (await f.action({ requestUrl: clicked.html_url, action: 'comment', body: 'Not current' })).error.code,
        'stale_request'
      )
      assert.ok(!f.calls.some((call) => call.argv.includes('POST')))
    }
  })

  await test('Gitea와 Forgejo는 같은 사이드바 세부 정보를 불러오고 댓글, 리뷰, SHA 조건부 병합을 지원한다', async (t) => {
    for (const provider of ['gitea', 'forgejo']) {
      const f = await fixture(t, 'https://forge.example:3443/git/team/project.git', provider)
      f.setRows(forge)
      f.dispatch((args, next) =>
        args.at(-1).includes('/files?') && args.at(-1).endsWith('page=2') ? null : next(args)
      )
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
          for (const field of [
            'force_merge=false',
            'delete_branch_after_merge=false',
            'merge_when_checks_succeed=false',
          ])
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

  await test('forge 조회는 설정된 정확한 인스턴스를 선택하고, SSH 웹 포트와 접두사를 보존하며, HTTP 오류에서 실패한다', async (t) => {
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

  await test('forge 검사, 필수 리뷰, 없는 세부 정보, 권한, 오래된 head는 우회 없이 변경을 막는다', async (t) => {
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

  await test('forge 페이지네이션은 제한된 이후 페이지와 최신 CI 재실행을 포함하고, 포크 부모에서 PR을 찾는다', async (t) => {
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
    const linked = await f.lookup(parentRequest.html_url)
    assert.equal(linked.ok, true)
    assert.equal(linked.value.request.url, parentRequest.html_url)
    assert.equal(linked.value.request.detailsError, undefined)
    assert.equal((await f.action({ requestUrl: parentRequest.html_url, action: 'merge' })).ok, true)
    assert.ok(f.calls.at(-1).argv.at(-1).includes('/api/v1/repos/upstream/project/pulls/23/merge'))
  })

  await test('자체 관리 GitLab은 읽기와 쓰기에 설정된 provider, HTTPS 포트, 중첩 네임스페이스를 사용한다', async (t) => {
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
})
