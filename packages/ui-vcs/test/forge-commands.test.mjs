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
  return { run, calls, state, config: cfg, makeReview, repository, origin, remoteUrl }
}

void test('GitHub 탐색은 명시한 호스트/저장소를 고정하고 기존 제목/본문을 읽는다', async () => {
  const f = fixture()
  f.state.rows = [f.makeReview()]
  const context = await inspectForge(f.run, 'auto')
  assert.equal(context.provider, 'github')
  assert.equal(context.repository, 'owner/project')
  assert.equal(context.existingReview.body, 'previous')
  assert.equal(context.existingReview.title, 'old')
  const commands = f.calls.filter((call) => call.executable === 'gh')
  assert.ok(commands.length > 0)
  for (const { args } of commands) {
    const hostname = args.indexOf('--hostname')
    assert.notEqual(hostname, -1)
    assert.equal(args[hostname + 1], 'github.com')
  }
})

void test('자체 관리 GitLab은 포트와 중첩 네임스페이스를 유지하고 MR을 생성하고 업데이트한다', async () => {
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

void test('Forgejo 로그인은 정확한 URL 접두사와 기본이 아닌 HTTP 포트를 선택한다', async () => {
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

void test('Gitea는 tea를 사용하며 기본 로그인이나 암시적 저장소를 절대 쓰지 않는다', async () => {
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

void test('SSH 별칭은 SSH 포트를 API 포트로 취급하지 않고 정규 호스팅 호스트를 확인한다', async () => {
  const f = fixture({ remoteUrl: 'ssh://git@github-work:2222/owner/project.git' })
  const context = await inspectForge(f.run, 'auto')
  assert.equal(context.host, 'github.com')
  assert.equal(context.remoteUrl, 'ssh://git@github-work:2222/owner/project.git')
  assert.deepEqual(f.calls.find((call) => call.executable === 'ssh').args, ['-G', '-p', '2222', 'github-work'])
})

void test('실제 푸시 URL과 설정된 pushRemote는 가져오기 업스트림보다 우선한다', async () => {
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

void test('ForgeContext의 푸시와 리뷰 쓰기는 기본 HEAD 네트워크 조회를 반복하지 않는다', async () => {
  const f = fixture()
  const context = await inspectForge(f.run, 'github')
  const networkCalls = f.calls.filter((call) => call.args[2] === 'ls-remote').length
  assert.equal(f.calls.filter((call) => call.args.includes('--symref')).length, 1)
  await pushBranch(f.run, context)
  await updateReview(f.run, context, { title: '새 PR', body: '본문' })
  await updateReview(f.run, context, { title: '수정 PR', body: '수정 본문' })
  assert.equal(f.calls.filter((call) => call.args[2] === 'ls-remote').length, networkCalls)
  assert.equal(f.calls.filter((call) => call.args[2] === 'symbolic-ref').length, 4)
  assert.equal(f.calls.filter((call) => call.args[2] === 'remote').length, 4)
  assert.equal(f.state.mutations, 2)
})

void test('일반 PushContext의 재검증은 기본 HEAD를 계속 조회한다', async () => {
  const f = fixture()
  const context = await discoverPush(f.run)
  await pushBranch(f.run, context)
  assert.equal(f.calls.filter((call) => call.args.includes('--symref')).length, 2)
})

void test('리뷰 대상이 기본 브랜치와 달라도 기본 브랜치로 변경하면 쓰기를 막는다', async () => {
  for (const operation of ['push', 'review']) {
    const f = fixture()
    const row = f.makeReview()
    row.base.ref = 'release'
    f.state.rows = [row]
    const context = await inspectForge(f.run, 'github')
    assert.equal(context.baseBranch, 'release')
    assert.equal(context.defaultBranch, 'main')
    f.state.branch = 'main'
    await assert.rejects(
      operation === 'push' ? pushBranch(f.run, context) : updateReview(f.run, context, { title: '차단', body: '' }),
      /default_branch/
    )
    assert.equal(f.calls.filter((call) => call.args.includes('--symref')).length, 1)
    assert.ok(!f.calls.some((call) => call.args[2] === 'push'))
    assert.equal(f.state.mutations, 0)
  }
})

void test('기본 HEAD 조회를 생략해도 변경된 푸시 설정은 다시 검증한다', async () => {
  for (const [key, value, error] of [
    ['branch.feat/topic.pushRemote', 'other', /stale_request/],
    ['remote.origin.push', 'refs/heads/*:refs/heads/*', /unsupported/],
    ['remote.origin.mirror', 'true', /unsupported/],
    ['push.default', 'matching', /unsupported/],
    ['branch.feat/topic.merge', 'refs/heads/other', /unsupported/],
  ]) {
    const f = fixture()
    const context = await inspectForge(f.run, 'github')
    f.config[key] = value
    await assert.rejects(pushBranch(f.run, context), error)
    await assert.rejects(updateReview(f.run, context, { title: '차단', body: '' }), error)
    assert.equal(f.calls.filter((call) => call.args.includes('--symref')).length, 1)
    assert.ok(!f.calls.some((call) => call.args[2] === 'push'))
    assert.equal(f.state.mutations, 0)
  }
})

void test('업스트림 푸시 대상이 기본 브랜치로 바뀌면 HEAD 조회 없이도 쓰기를 막는다', async () => {
  const f = fixture({ config: { 'push.default': 'upstream' } })
  const context = await inspectForge(f.run, 'github')
  f.config['branch.feat/topic.merge'] = 'refs/heads/main'
  await assert.rejects(pushBranch(f.run, context), /default_branch/)
  await assert.rejects(updateReview(f.run, context, { title: '차단', body: '' }), /default_branch/)
  assert.equal(f.calls.filter((call) => call.args.includes('--symref')).length, 1)
  assert.ok(!f.calls.some((call) => call.args[2] === 'push'))
  assert.equal(f.state.mutations, 0)
})

void test('기본 브랜치 푸시는 호스팅 CLI가 필요 없고, 기본 브랜치 PR은 실패한다', async () => {
  const f = fixture({ state: { branch: 'main' } })
  const context = await discoverPush(f.run)
  await pushBranch(f.run, context)
  assert.ok(f.calls.every((call) => call.executable === 'git'))
  await assert.rejects(inspectForge(f.run, 'github'), /default_branch/)
})

void test('분리된 HEAD는 어떤 호스팅 명령이나 푸시 명령보다 먼저 실패한다', async () => {
  const f = fixture({ state: { branch: '' } })
  await assert.rejects(discoverPush(f.run), /detached_head/)
  assert.equal(f.calls.length, 1)
})

void test('생성 성공 후 재시도하면 PR을 다시 조회해 중복 생성 대신 업데이트한다', async () => {
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

void test('변경된 브랜치나 리모트는 쓰기를 막는다', async () => {
  const f = fixture()
  const context = await inspectForge(f.run, 'github')
  f.state.branch = 'feat/other'
  await assert.rejects(pushBranch(f.run, context), /stale_request/)
  f.state.branch = 'feat/topic'
  f.state.remoteUrl = 'https://github.com/other/project.git'
  await assert.rejects(updateReview(f.run, context, { title: 'feat: blocked', body: '' }), /stale_request/)
  assert.equal(f.state.mutations, 0)
})

void test('기존 PR이 없는 포크는 불확실한 대상을 고르지 않고 실패한다', async () => {
  const f = fixture({ metadata: { parent: { full_name: 'upstream/project' } } })
  await assert.rejects(inspectForge(f.run, 'github'), /ambiguous_target/)
  assert.equal(f.state.mutations, 0)
})

void test('기존 업스트림 포크 PR은 명시된 대상을 보존한다', async () => {
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

void test('여러 푸시 URL, 미러, refspec, 일치하지 않는 단순 업스트림은 안전하게 실패한다', async () => {
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

void test('자격 증명이 포함된 URL과 임의 전송 방식은 호스팅 CLI에 절대 도달하지 않는다', async () => {
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

void test('인식되지 않는 자체 호스팅 auto와 모호한 tea 로그인은 안전하게 실패한다', async () => {
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

void test('리뷰 URL과 소스 저장소 식별자는 변경 전에 확인한다', async () => {
  const f = fixture()
  f.state.rows = [{ ...f.makeReview(), html_url: 'https://evil.example/owner/project/pull/7' }]
  await assert.rejects(inspectForge(f.run, 'github'), /invalid_response/)
  assert.equal(f.state.mutations, 0)
})

void test('baseRef는 새 PR과 기존 provider 리뷰에서 검증된 로컬 SHA이다', async () => {
  const fresh = fixture()
  assert.equal((await inspectForge(fresh.run, 'github')).baseRef, 'a'.repeat(40))
  for (const provider of ['github', 'gitlab', 'forgejo']) {
    const f = fixture({ provider })
    f.state.rows = [f.makeReview()]
    assert.equal((await inspectForge(f.run, provider)).baseRef, 'a'.repeat(40))
  }
  const missing = fixture({ missingBase: true })
  assert.equal((await inspectForge(missing.run, 'github')).baseRef, undefined)
  assert.ok(!missing.calls.some((call) => call.executable === 'git' && call.args[2] === 'fetch'))
})

void test('기존 리뷰의 제목이나 본문이 바뀌면 생성 후 덮어쓰기를 막는다', async () => {
  for (const field of ['title', 'body']) {
    const f = fixture()
    f.state.rows = [f.makeReview()]
    const context = await inspectForge(f.run, 'github')
    f.state.rows[0][field] = 'edited by someone else'
    await assert.rejects(updateReview(f.run, context, { title: 'feat: generated', body: 'generated' }), /stale_request/)
    assert.equal(f.state.mutations, 0)
  }
})

void test('모호한 업데이트 응답 후에도 이미 적용된 텍스트는 멱등이다', async () => {
  const f = fixture()
  f.state.rows = [f.makeReview()]
  const context = await inspectForge(f.run, 'github')
  f.state.rows = [f.makeReview('feat: generated', 'generated')]
  assert.deepEqual(await updateReview(f.run, context, { title: 'feat: generated', body: 'generated' }), {
    url: f.state.rows[0].html_url,
  })
  assert.equal(f.state.mutations, 0)
})

void test('업스트림 푸시 모드는 강제 없이 명시적으로 추적된 브랜치를 사용한다', async () => {
  const f = fixture({ config: { 'push.default': 'upstream', 'branch.feat/topic.merge': 'refs/heads/review/topic' } })
  const context = await discoverPush(f.run)
  assert.equal(context.pushBranch, 'review/topic')
  await pushBranch(f.run, context)
  const push = f.calls.find((call) => call.args[2] === 'push')
  assert.equal(push.args.at(-1), 'HEAD:refs/heads/review/topic')
  assert.ok(!push.args.some((arg) => /force|merge/.test(arg)))
})

void test('닫힌 리뷰와 모호한 중복 리뷰는 변경 전에 실패한다', async () => {
  for (const rows of [(f) => [{ ...f.makeReview(), state: 'closed' }], (f) => [f.makeReview(), f.makeReview()]]) {
    const f = fixture()
    f.state.rows = rows(f)
    await assert.rejects(inspectForge(f.run, 'github'), /invalid_response|ambiguous_review/)
    assert.equal(f.state.mutations, 0)
  }
})

void test('생성 중 다른 주체가 만든 PR은 덮어쓰지 않는다', async () => {
  const f = fixture()
  const context = await inspectForge(f.run, 'github')
  f.state.rows = [f.makeReview('human title', 'human body')]
  await assert.rejects(updateReview(f.run, context, { title: 'feat: generated', body: 'generated' }), /stale_request/)
  assert.equal(f.state.mutations, 0)
})

void test('유실된 생성 응답은 추가 변경 없이 복구한다', async () => {
  const f = fixture()
  const context = await inspectForge(f.run, 'github')
  f.state.rows = [f.makeReview('feat: generated', 'generated')]
  assert.deepEqual(await updateReview(f.run, context, { title: 'feat: generated', body: 'generated' }), {
    url: f.state.rows[0].html_url,
  })
  assert.equal(f.state.mutations, 0)
})
