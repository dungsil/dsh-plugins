import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, apply, inject, GitLabProvider } from '../dist/index.js'
import { changeRequestKey } from '@deepseek-ai/dsh-experimental-forge'

const commit = 'a'.repeat(40)
const signal = () => new AbortController().signal
function fixture(overrides = {}) {
  const calls = []
  const base = {
    iid: 42,
    web_url: 'https://gitlab.com/group/nested/project/-/merge_requests/42',
    state: 'opened',
    sha: commit,
    title: 'MR',
    draft: false,
    user: { can_merge: true },
    source_branch: 'feature',
    target_branch: 'main',
    source_project_id: 1,
    target_project_id: 1,
    updated_at: '2026-11-06T00:00:00Z',
    author: { username: 'author' },
    detailed_merge_status: 'mergeable',
    ...overrides.row,
  }
  const project = { id: 1, default_branch: 'main', merge_method: 'merge', squash_option: 'default_off' }
  const run = async (args, operation, input) => {
    operation.throwIfAborted()
    calls.push({ args, input })
    const path = args[5]
    let value
    if (overrides.run) return overrides.run(args, operation, input)
    if (path.endsWith('/merge')) value = { ...base, state: 'merged' }
    else if (path.endsWith('/approvals')) value = { approvals_left: overrides.approvals ?? 0 }
    else if (path.includes('/discussions?')) value = overrides.discussions ?? []
    else if (path.includes('/diffs?')) value = overrides.diffs ?? [{ diff: '@@ -1 +1 @@\n-old\n+new' }]
    else if (path.includes('/statuses?'))
      value = overrides.statuses ?? [{ sha: commit, name: 'build', status: 'success' }]
    else if (path.includes('?state=opened')) value = overrides.rows ?? [base]
    else if (path.includes('/repository/files/')) return { exitCode: 0, stdout: 'file text', stderr: '' }
    else if (path.endsWith('/raw_diffs')) return { exitCode: 0, stdout: 'diff --git a/a b/a\n', stderr: '' }
    else if (path.endsWith('/merge_requests/42')) value = base
    else if (path === 'user') value = { username: 'author' }
    else value = project
    return { exitCode: 0, stdout: JSON.stringify(value), stderr: '' }
  }
  const provider = new GitLabProvider(run, ['gitlab.com', 'gitlab.example:8443'])
  const repository = provider.repositoryFromRemote('git@gitlab.com:group/nested/project.git')
  const ref = { repository, number: 42 }
  return { provider, repository, ref, calls }
}

await test('공식 forge 서비스에 provider만 등록하고 UI나 RPC를 등록하지 않는다', () => {
  const providers = []
  apply({ forge: { register: (provider) => providers.push(provider) } }, Config({}))
  assert.deepEqual(inject, ['forge'])
  assert.equal(providers[0].forge, 'gitlab')
  assert.deepEqual(Config({}).hosts, ['gitlab.com'])
  assert.equal(providers[0].submitReview, undefined)
})

await test('중첩 GitLab 그룹과 HTTPS 포트를 보존하고 허용하지 않은 호스트와 자격 증명을 거부한다', () => {
  const { provider, ref } = fixture()
  assert.equal(ref.repository.owner, 'group/nested')
  assert.equal(provider.repositoryFromRemote('https://gitlab.example:8443/a/b.git').host, 'gitlab.example:8443')
  assert.deepEqual(provider.changeRequestFromUrl(provider.changeRequestUrl(ref)), ref)
  for (const value of [
    'https://github.com/a/b.git',
    'https://user:password@gitlab.com/a/b',
    'https://gitlab.com/a/../b',
    'file:///a/b',
    'https://gitlab.com/a/b?token=x',
  ])
    assert.equal(provider.repositoryFromRemote(value), undefined)
  for (const value of [
    'https://gitlab.com/a/b/-/merge_requests/0',
    'https://gitlab.com/a/b/-/merge_requests/1?x=y',
    'https://gitlab.com/a/b/-/merge_requests/9007199254740992',
  ])
    assert.equal(provider.changeRequestFromUrl(value), undefined)
})

await test('GitLab 응답을 공식 snapshot과 canonical key로 정규화한다', async () => {
  const { provider, ref } = fixture()
  const results = await provider.fetch([ref], signal())
  const value = results.get(changeRequestKey(ref))
  assert.equal(value.state, 'open')
  assert.equal(value.headSha, commit)
  assert.equal(value.mergeReady, true)
  assert.equal(value.checksRollup, 'success')
  assert.equal(value.reviewDecision, 'approved')
  assert.equal(value.checks[0].state, 'success')
  assert.equal(value.additions, 1)
  assert.equal(value.deletions, 1)
})

await test('기본 브랜치와 포크의 MR을 head 조회 결과에 포함하지 않는다', async () => {
  const f = fixture()
  assert.deepEqual(await f.provider.findByHead(f.repository, 'main', signal()), [])
  assert.deepEqual(await f.provider.findByHead(f.repository, 'feature', signal()), [f.ref])
  const foreign = fixture({ rows: [{ source_branch: 'feature', source_project_id: 2, target_project_id: 1 }] })
  assert.deepEqual(await foreign.provider.findByHead(foreign.repository, 'feature', signal()), [])
})

await test('실패한 CI와 미완료 승인 및 토론과 없는 병합 권한은 병합을 허용하지 않는다', async () => {
  for (const config of [
    { statuses: [{ sha: commit, name: 'test', status: 'failed' }] },
    { approvals: 1 },
    { discussions: [{ notes: [{ resolvable: true, resolved: false }] }] },
    { row: { user: {} } },
    { row: { draft: true } },
  ]) {
    const f = fixture(config)
    const snapshot = await f.provider.fetchChecks(f.ref, signal())
    assert.equal(snapshot.mergeReady, false)
    assert.equal((await f.provider.merge(f.ref, { method: 'merge', headSha: commit }, signal())).code, 'failed')
    assert.equal(
      f.calls.some((call) => call.args[4] === 'PUT'),
      false
    )
  }
})

await test('잘린 diff와 다른 head의 검사 결과를 성공 snapshot으로 처리하지 않는다', async () => {
  for (const config of [
    { diffs: [{ diff: '', too_large: true }] },
    { statuses: [{ sha: 'b'.repeat(40), name: 'test', status: 'success' }] },
  ]) {
    const f = fixture(config)
    assert.ok('code' in (await f.provider.fetchChecks(f.ref, signal())))
  }
})

await test('오래된 head는 쓰지 않고 병합 요청에는 확인한 SHA를 원자 조건으로 보낸다', async () => {
  const f = fixture()
  assert.equal((await f.provider.merge(f.ref, { method: 'squash', headSha: 'b'.repeat(40) }, signal())).code, 'stale')
  assert.equal(
    f.calls.some((call) => call.args[4] === 'PUT'),
    false
  )
  assert.equal(await f.provider.merge(f.ref, { method: 'squash', headSha: commit }, signal()), undefined)
  const writes = f.calls.filter((call) => call.args[4] === 'PUT')
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0].input), { sha: commit, squash: true })
})

await test('인증 실패와 손상된 JSON을 실패로 반환하고 CLI 진단 원문을 노출하지 않는다', async () => {
  const f = fixture({ run: async () => ({ exitCode: 1, stdout: '', stderr: 'HTTP 401 secret-token' }) })
  assert.equal((await f.provider.fetchChecks(f.ref, signal())).code, 'unauthenticated')
  const status = await f.provider.readiness('gitlab.com', signal())
  assert.equal(status.state, 'unauthenticated')
  assert.ok(!JSON.stringify(status).includes('secret-token'))
  const broken = fixture({ run: async () => ({ exitCode: 0, stdout: '{', stderr: '' }) })
  assert.equal((await broken.provider.fetchChecks(broken.ref, signal())).code, 'unavailable')
})

await test('CLI 출력 상한 오류와 응답 바이트 초과를 too-large로 반환한다', async () => {
  const limited = fixture({
    run: async () => {
      throw new RangeError('output limit')
    },
  })
  assert.equal((await limited.provider.fetchChecks(limited.ref, signal())).code, 'too-large')
  const provider = new GitLabProvider(
    async () => ({ exitCode: 0, stdout: ' '.repeat(17), stderr: '' }),
    ['gitlab.com'],
    16
  )
  assert.equal((await provider.fetchChecks(limited.ref, signal())).code, 'too-large')
})

await test('취소한 요청과 다른 provider 참조는 외부 명령을 실행하지 않는다', async () => {
  const f = fixture()
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(f.provider.fetchChecks(f.ref, controller.signal), /cancelled/)
  assert.equal(f.calls.length, 0)
  const bad = { ...f.ref, repository: { ...f.repository, forge: 'github' } }
  assert.equal((await f.provider.fetchChecks(bad, signal())).code, 'unavailable')
  assert.equal(f.calls.length, 0)
})

await test('diff와 파일은 공식 읽기 계약을 따르고 경로 이탈과 잘못된 SHA를 거부한다', async () => {
  const f = fixture()
  assert.match(await f.provider.diff(f.ref, signal()), /^diff --git/)
  assert.equal(await f.provider.fileText(f.ref, commit, 'src/a.ts', signal()), 'file text')
  assert.match(f.provider.fileUrl(f.ref, commit, 'src/a b.ts'), /src\/a%20b.ts$/)
  assert.throws(() => f.provider.fileUrl(f.ref, commit, '../secret'))
  assert.throws(() => f.provider.fileUrl(f.ref, 'main', 'src/a.ts'))
  assert.equal((await f.provider.markReady(f.ref, signal())).code, 'failed')
})
