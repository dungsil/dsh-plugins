import assert from 'node:assert/strict'
import test from 'node:test'
import { discoverPush, inspectForge, pushBranch, updateReview } from '../src/forge-commands.ts'

function fixture(options = {}) {
  const provider = options.provider ?? 'github'
  const host =
    provider === 'gitlab' ? 'gitlab.internal:8443' : provider === 'forgejo' ? 'forge.internal:3000' : 'github.com'
  const repository = provider === 'gitlab' ? 'group/nested/project' : 'owner/project'
  const prefix = provider === 'forgejo' ? '/forge' : ''
  const remoteUrl = options.remoteUrl ?? `https://${host}${prefix}/${repository}.git`
  const origin = `https://${host}${prefix}`
  const calls = []
  const cfg = {
    'branch.feat/topic.remote': 'origin',
    'branch.feat/topic.merge': 'refs/heads/feat/topic',
    ...options.config,
  }
  const baseSha = 'a'.repeat(40)
  const state = { branch: 'feat/topic', rows: [], mutations: 0, ...options.state }
  const makeReview = (title = 'old', body = 'previous') =>
    provider === 'gitlab'
      ? {
          iid: 7,
          title,
          description: body,
          source_branch: 'feat/topic',
          target_branch: 'main',
          source_project_id: 10,
          target_project_id: 10,
          diff_refs: { base_sha: baseSha },
          state: 'opened',
          web_url: `${origin}/${repository}/-/merge_requests/7`,
        }
      : {
          number: 7,
          title,
          body,
          state: 'open',
          merged: false,
          head: { ref: 'feat/topic', repo: { full_name: repository } },
          base: { ref: 'main', sha: baseSha, repo: { full_name: repository } },
          html_url: `${origin}/${repository}/${provider === 'github' ? 'pull' : 'pulls'}/7`,
        }
  const run = async (executable, args, runOptions) => {
    calls.push({ executable, args, options: runOptions })
    if (executable === 'git') {
      const cmd = args.slice(2)
      if (cmd[0] === 'symbolic-ref') return state.branch
      if (cmd[0] === 'config') return cfg[cmd.at(-1)] ?? ''
      if (cmd[0] === 'remote') return state.remoteUrl ?? remoteUrl
      if (cmd[0] === 'ls-remote')
        return cmd.includes('--symref')
          ? (options.defaultHead ?? `ref: refs/heads/main\tHEAD\n${baseSha}\tHEAD`)
          : `${baseSha}\trefs/heads/main`
      if (cmd[0] === 'rev-parse') return options.missingBase ? '' : baseSha
      if (cmd[0] === 'push') return 'ok'
    }
    if (executable === 'ssh') return `hostname ${options.sshHost ?? 'github.com'}\nport 2222\n`
    if (executable === 'tea' && args[0] === 'login')
      return JSON.stringify(options.logins ?? [{ name: 'local', url: origin, ssh_host: host.split(':')[0] }])
    if (['gh', 'glab', 'tea'].includes(executable)) {
      const endpoint = args.at(-1)
      if (args.includes('--method')) {
        state.mutations++
        const value = (key) => args.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1)
        const row = makeReview(value('title'), value(provider === 'gitlab' ? 'description' : 'body'))
        state.rows = [row]
        return JSON.stringify(row)
      }
      if (endpoint.includes('/pulls?') || endpoint.includes('/merge_requests?'))
        return JSON.stringify(endpoint.endsWith('page=1') ? state.rows : [])
      if (/\/(pulls|merge_requests)\/7$/.test(endpoint)) return JSON.stringify(state.rows[0])
      if (/repos\//.test(endpoint) || /projects\//.test(endpoint))
        return JSON.stringify(
          provider === 'gitlab'
            ? { id: 10, path_with_namespace: repository, default_branch: 'main', ...options.metadata }
            : { full_name: repository, default_branch: 'main', ...options.metadata }
        )
    }
    throw new Error(`Unexpected command: ${executable} ${JSON.stringify(args)}`)
  }
  return { run, calls, state, makeReview, repository, origin, remoteUrl }
}

test('GitHub discovery pins explicit host/repository and reads existing title/body', async () => {
  const f = fixture()
  f.state.rows = [f.makeReview()]
  const context = await inspectForge(f.run, 'auto')
  assert.equal(context.provider, 'github')
  assert.equal(context.repository, 'owner/project')
  assert.equal(context.existingReview.body, 'previous')
  assert.equal(context.existingReview.title, 'old')
  assert.ok(
    f.calls
      .filter((call) => call.executable === 'gh')
      .every((call) => call.args.includes('--hostname') && call.args.includes('github.com'))
  )
})

test('self-managed GitLab keeps port and nested namespace, creates and updates MR', async () => {
  const f = fixture({ provider: 'gitlab' })
  const context = await inspectForge(f.run, 'gitlab')
  assert.equal(context.host, 'gitlab.internal:8443')
  assert.equal(context.repository, 'group/nested/project')
  await pushBranch(f.run, context)
  assert.deepEqual(await updateReview(f.run, context, { title: 'feat: 새 기능', body: '첫 본문' }), {
    url: `${f.origin}/${f.repository}/-/merge_requests/7`,
  })
  await updateReview(f.run, context, { title: 'feat: 새 기능 수정', body: '두 번째 본문' })
  const writes = f.calls.filter((call) => call.args.includes('--method'))
  assert.equal(writes[0].args.at(-1), 'projects/10/merge_requests')
  assert.ok(writes[0].args.includes('POST'))
  assert.equal(writes[1].args.at(-1), 'projects/10/merge_requests/7')
  assert.ok(writes[1].args.includes('PUT'))
})

test('Forgejo login selects exact URL prefix and non-default HTTP port', async () => {
  const f = fixture({ provider: 'forgejo' })
  const context = await inspectForge(f.run, 'forgejo')
  assert.equal(context.repository, 'owner/project')
  assert.equal(context.origin, 'https://forge.internal:3000/forge')
  assert.equal(context.login, 'local')
  await updateReview(f.run, context, { title: 'feat: forge', body: '@literal\n${literal}' })
  const write = f.calls.find((call) => call.args.includes('POST'))
  assert.equal(write.executable, 'tea')
  assert.equal(write.args.at(-1), 'https://forge.internal:3000/forge/api/v1/repos/owner/project/pulls')
  assert.ok(write.args.includes('--include'))
  assert.ok(write.args.includes('body=@literal\n${literal}'))
})

test('Gitea uses tea, never default login or implicit repository', async () => {
  const f = fixture({
    provider: 'gitea',
    remoteUrl: 'https://gitea.com/owner/project.git',
    logins: [{ name: 'gitea', url: 'https://gitea.com', ssh_host: 'gitea.com' }],
  })
  const context = await inspectForge(f.run, 'auto')
  assert.equal(context.provider, 'gitea')
  assert.equal(context.login, 'gitea')
  assert.ok(
    f.calls
      .filter((call) => call.executable === 'tea' && call.args[0] === 'api')
      .every((call) => call.args.includes('--login') && call.args.includes('gitea'))
  )
})

test('SSH alias resolves canonical hosting host without treating SSH port as API port', async () => {
  const f = fixture({ remoteUrl: 'ssh://git@github-work:2222/owner/project.git' })
  const context = await inspectForge(f.run, 'auto')
  assert.equal(context.host, 'github.com')
  assert.equal(context.remoteUrl, 'ssh://git@github-work:2222/owner/project.git')
  assert.deepEqual(f.calls.find((call) => call.executable === 'ssh').args, ['-G', '-p', '2222', 'github-work'])
})

test('actual push URL and configured pushRemote take precedence over fetch upstream', async () => {
  const f = fixture({ config: { 'branch.feat/topic.pushRemote': 'fork', 'remote.pushDefault': 'other' } })
  const context = await discoverPush(f.run)
  assert.equal(context.remote, 'fork')
  assert.ok(
    f.calls.some((call) => call.args.join(' ') === '-c core.fsmonitor=false remote get-url --push --all -- fork')
  )
  await pushBranch(f.run, context)
  const push = f.calls.find((call) => call.executable === 'git' && call.args[2] === 'push')
  assert.deepEqual(push.args.slice(2), ['push', '--porcelain', '--', f.remoteUrl, 'HEAD:refs/heads/feat/topic'])
  assert.ok(f.calls.every((call) => call.executable === 'git'))
})

test('default branch push requires no hosting CLI, default branch PR fails', async () => {
  const f = fixture({ state: { branch: 'main' } })
  const context = await discoverPush(f.run)
  await pushBranch(f.run, context)
  assert.ok(f.calls.every((call) => call.executable === 'git'))
  await assert.rejects(inspectForge(f.run, 'github'), /default_branch/)
})

test('detached HEAD fails before any hosting or push command', async () => {
  const f = fixture({ state: { branch: '' } })
  await assert.rejects(discoverPush(f.run), /detached_head/)
  assert.equal(f.calls.length, 1)
})

test('retry after successful create re-queries PR and updates instead of duplicate create', async () => {
  const f = fixture()
  const context = await inspectForge(f.run, 'github')
  await updateReview(f.run, context, { title: 'feat: first', body: 'first' })
  await updateReview(f.run, context, { title: 'feat: retry', body: 'second' })
  const writes = f.calls.filter((call) => call.args.includes('--method'))
  assert.equal(writes.length, 2)
  assert.ok(writes[0].args.includes('POST'))
  assert.ok(writes[1].args.includes('PATCH'))
  assert.equal(writes[1].args.at(-1), 'repos/owner/project/pulls/7')
})

test('changed branch or remote blocks writes', async () => {
  const f = fixture()
  const context = await inspectForge(f.run, 'github')
  f.state.branch = 'feat/other'
  await assert.rejects(pushBranch(f.run, context), /stale_request/)
  f.state.branch = 'feat/topic'
  f.state.remoteUrl = 'https://github.com/other/project.git'
  await assert.rejects(updateReview(f.run, context, { title: 'feat: blocked', body: '' }), /stale_request/)
  assert.equal(f.state.mutations, 0)
})

test('fork with no existing PR fails instead of choosing an uncertain target', async () => {
  const f = fixture({ metadata: { parent: { full_name: 'upstream/project' } } })
  await assert.rejects(inspectForge(f.run, 'github'), /ambiguous_target/)
  assert.equal(f.state.mutations, 0)
})

test('existing upstream fork PR preserves its explicit target', async () => {
  const f = fixture({ metadata: { parent: { full_name: 'upstream/project' } } })
  const row = f.makeReview()
  row.base.repo.full_name = 'upstream/project'
  row.html_url = 'https://github.com/upstream/project/pull/7'
  const baseRun = f.run
  f.run = async (executable, args, opts) => {
    const endpoint = args.at(-1)
    if (executable === 'gh' && endpoint === 'repos/upstream/project/pulls/7') return JSON.stringify(row)
    if (executable === 'gh' && endpoint.startsWith('repos/upstream/project/pulls?') && endpoint.endsWith('page=1'))
      return JSON.stringify([row])
    return baseRun(executable, args, opts)
  }
  const context = await inspectForge(f.run, 'github')
  assert.equal(context.targetRepository, 'upstream/project')
  assert.equal(context.existingReview.url, row.html_url)
})

test('multiple push URLs, mirror, refspecs and mismatched simple upstream fail safely', async () => {
  for (const options of [
    { state: { remoteUrl: 'https://github.com/owner/a.git\nhttps://github.com/owner/b.git' } },
    { config: { 'remote.origin.mirror': 'true' } },
    { config: { 'remote.origin.push': 'refs/heads/*:refs/heads/*' } },
    { config: { 'branch.feat/topic.merge': 'refs/heads/other' } },
  ]) {
    const f = fixture(options)
    await assert.rejects(discoverPush(f.run), /unsupported/)
    assert.equal(f.state.mutations, 0)
  }
})

test('credential-bearing URL and arbitrary transport never reach a hosting CLI', async () => {
  for (const remoteUrl of [
    'https://user:secret@github.com/owner/project.git',
    'ext::something',
    'file:///tmp/repository',
  ]) {
    const f = fixture({ remoteUrl })
    await assert.rejects(discoverPush(f.run), /unsupported/)
    assert.ok(f.calls.every((call) => call.executable === 'git'))
  }
})

test('unrecognized self-hosted auto and ambiguous tea logins fail closed', async () => {
  const unknown = fixture({ remoteUrl: 'https://custom.host/owner/project.git' })
  await assert.rejects(inspectForge(unknown.run, 'auto'), /unsupported/)
  const f = fixture({
    provider: 'forgejo',
    logins: [
      { name: 'a', url: 'https://forge.internal:3000/forge', ssh_host: 'forge.internal' },
      { name: 'b', url: 'https://forge.internal:3000/forge', ssh_host: 'forge.internal' },
    ],
  })
  await assert.rejects(inspectForge(f.run, 'forgejo'), /unsupported/)
})

test('review URLs and source repository identities are checked before mutation', async () => {
  const f = fixture()
  f.state.rows = [{ ...f.makeReview(), html_url: 'https://evil.example/owner/project/pull/7' }]
  await assert.rejects(inspectForge(f.run, 'github'), /invalid_response/)
  assert.equal(f.state.mutations, 0)
})

test('baseRef is a verified local SHA for new PRs and existing provider reviews', async () => {
  const fresh = fixture()
  assert.equal((await inspectForge(fresh.run, 'github')).baseRef, 'a'.repeat(40))
  for (const provider of ['github', 'gitlab', 'forgejo']) {
    const f = fixture({ provider })
    f.state.rows = [f.makeReview()]
    assert.equal((await inspectForge(f.run, provider)).baseRef, 'a'.repeat(40))
  }
  const missing = fixture({ missingBase: true })
  assert.equal((await inspectForge(missing.run, 'github')).baseRef, undefined)
})

test('changed existing review title or body blocks overwrite after generation', async () => {
  for (const field of ['title', 'body']) {
    const f = fixture()
    f.state.rows = [f.makeReview()]
    const context = await inspectForge(f.run, 'github')
    f.state.rows[0][field] = 'edited by someone else'
    await assert.rejects(updateReview(f.run, context, { title: 'feat: generated', body: 'generated' }), /stale_request/)
    assert.equal(f.state.mutations, 0)
  }
})

test('already applied texts are idempotent after an ambiguous update response', async () => {
  const f = fixture()
  f.state.rows = [f.makeReview()]
  const context = await inspectForge(f.run, 'github')
  f.state.rows = [f.makeReview('feat: generated', 'generated')]
  assert.deepEqual(await updateReview(f.run, context, { title: 'feat: generated', body: 'generated' }), {
    url: f.state.rows[0].html_url,
  })
  assert.equal(f.state.mutations, 0)
})

test('upstream push mode uses explicitly tracked branch without force', async () => {
  const f = fixture({ config: { 'push.default': 'upstream', 'branch.feat/topic.merge': 'refs/heads/review/topic' } })
  const context = await discoverPush(f.run)
  assert.equal(context.pushBranch, 'review/topic')
  await pushBranch(f.run, context)
  const push = f.calls.find((call) => call.args[2] === 'push')
  assert.equal(push.args.at(-1), 'HEAD:refs/heads/review/topic')
  assert.ok(!push.args.some((arg) => /force|merge/.test(arg)))
})

test('closed review and ambiguous duplicate reviews fail before mutation', async () => {
  for (const rows of [(f) => [{ ...f.makeReview(), state: 'closed' }], (f) => [f.makeReview(), f.makeReview()]]) {
    const f = fixture()
    f.state.rows = rows(f)
    await assert.rejects(inspectForge(f.run, 'github'), /invalid_response|ambiguous_review/)
    assert.equal(f.state.mutations, 0)
  }
})

test('a PR created by another actor during generation is not overwritten', async () => {
  const f = fixture()
  const context = await inspectForge(f.run, 'github')
  f.state.rows = [f.makeReview('human title', 'human body')]
  await assert.rejects(updateReview(f.run, context, { title: 'feat: generated', body: 'generated' }), /stale_request/)
  assert.equal(f.state.mutations, 0)
})

test('a lost create reply is recovered without another mutation', async () => {
  const f = fixture()
  const context = await inspectForge(f.run, 'github')
  f.state.rows = [f.makeReview('feat: generated', 'generated')]
  assert.deepEqual(await updateReview(f.run, context, { title: 'feat: generated', body: 'generated' }), {
    url: f.state.rows[0].html_url,
  })
  assert.equal(f.state.mutations, 0)
})
