import assert from 'node:assert/strict'
import test from 'node:test'
import { provider, hostApi } from '../src/forge-providers.ts'

const signal = AbortSignal.timeout(10_000)
const sha = 'a'.repeat(40)
function fixture(forge = 'gitlab') {
  const calls = []
  const host = forge === 'gitlab' ? 'gitlab.com' : 'codeberg.org'
  const ref = { repository: { forge, host, owner: 'team', name: 'repo' }, number: 7 }
  const rows = {
    iid: 7,
    number: 7,
    web_url: `https://${host}/team/repo/-/merge_requests/7`,
    html_url: `https://${host}/team/repo/pulls/7`,
    allow_merge_commits: true,
    allow_squash_merge: true,
    allow_rebase: true,
    title: 'Change',
    state: forge === 'gitlab' ? 'opened' : 'open',
    sha,
    source_branch: 'topic',
    target_branch: 'main',
    source_project_id: 1,
    target_project_id: 1,
    detailed_merge_status: 'mergeable',
    draft: false,
    head: { ref: 'topic', sha },
    base: { ref: 'main' },
    mergeable: true,
    user: { login: 'alice' },
  }
  let approvalsFail = false
  const api = async (_host, path, _signal, options) => {
    calls.push({ path, options })
    if (options?.method) return {}
    if (path.includes('/approvals')) {
      if (approvalsFail) throw new Error('offline')
      return { approved: true }
    }
    if (path.includes('/branches/'))
      return {
        user_can_merge: true,
        enable_status_check: true,
        required_approvals: 0,
        status_check_contexts: rows.missingContexts ? undefined : ['test'],
      }
    if (path.includes('/statuses/')) return [{ id: 1, context: 'test', status: 'success' }]
    if (path.includes('/jobs?')) return []
    if (path.includes('/pipelines?') && rows.pipelineStatus) return [{ id: 1, sha, status: rows.pipelineStatus }]
    if (path.includes('/reviews') || path.includes('/pipelines')) return []
    return rows
  }
  return {
    adapter: provider(forge, [host], api),
    ref,
    calls,
    rows,
    fail: () => {
      approvalsFail = true
    },
  }
}

test('추가 provider는 명시된 호스트만 소유하고 GitHub URL을 가로채지 않는다', () => {
  const { adapter } = fixture()
  assert.equal(adapter.repositoryFromRemote('git@github.com:team/repo.git'), undefined)
  assert.equal(adapter.changeRequestFromUrl('https://gitlab.com/team/repo/-/merge_requests/7').number, 7)
  assert.equal(adapter.changeRequestFromUrl('https://token@gitlab.com/team/repo/-/merge_requests/7'), undefined)
})

test('Forgejo는 최신 상태 검사와 필수 검사를 공식 snapshot으로 제공한다', async () => {
  const { adapter, ref } = fixture('forgejo')
  const snapshot = (await adapter.fetch([ref], signal)).values().next().value
  assert.equal(snapshot.checksRollup, 'success')
  assert.equal(snapshot.checks[0].name, 'test')
  assert.equal(snapshot.mergeReady, true)
})

test('승인이나 검사 조회 실패를 요구 사항 없음으로 표시하지 않는다', async () => {
  const { adapter, ref, fail } = fixture()
  fail()
  const result = (await adapter.fetch([ref], signal)).values().next().value
  assert.equal(result.code, 'unavailable')
  assert.equal(result.checksRollup, undefined)
})

test('변경된 head는 병합과 리뷰 쓰기 전에 거부한다', async () => {
  const { adapter, ref, calls } = fixture()
  assert.equal((await adapter.merge(ref, { method: 'merge', headSha: 'b'.repeat(40) }, signal)).code, 'stale')
  assert.equal(
    (
      await adapter.submitReview(
        ref,
        { kind: 'review', headSha: 'b'.repeat(40), event: 'comment', body: 'hi', comments: [] },
        signal
      )
    ).code,
    'stale'
  )
  assert.equal(
    calls.some((c) => c.options?.method),
    false
  )
})

test('GitLab 병합은 서버 측 SHA 가드를 포함하고 공개 Forge 쓰기 계약을 사용한다', async () => {
  const { adapter, ref, calls } = fixture()
  assert.equal(await adapter.merge(ref, { method: 'squash', headSha: sha }, signal), undefined)
  assert.deepEqual(calls.at(-1).options, { method: 'PUT', fields: { sha, squash: 'true' } })
})

test('GitLab이 지원하지 않는 인라인 리뷰와 변경 요청은 쓰기 없이 거절한다', async () => {
  const { adapter, ref, calls } = fixture()
  const result = await adapter.submitReview(
    ref,
    { kind: 'review', headSha: sha, event: 'request-changes', body: 'fix', comments: [] },
    signal
  )
  assert.equal(result.code, 'unsupported')
  assert.equal(
    calls.some((c) => c.options?.method),
    false
  )
})

test('GitLab 수동 파이프라인은 성공으로 간주하지 않고 병합을 차단한다', async () => {
  const { adapter, ref, rows } = fixture()
  rows.pipelineStatus = 'manual'
  const result = (await adapter.fetch([ref], signal)).values().next().value
  assert.equal(result.checksRollup, 'pending')
  assert.equal(result.mergeReady, false)
})

test('필수 검사 목록이 누락되면 Gitea 병합 가능 상태를 만들지 않는다', async () => {
  const { adapter, ref, rows } = fixture('gitea')
  rows.missingContexts = true
  const result = (await adapter.fetch([ref], signal)).values().next().value
  assert.equal(result.code, 'unavailable')
  assert.equal(result.mergeReady, undefined)
})

test('명시한 HTTP API 포트는 호스트 식별자와 요청 URL에 일관되게 보존한다', () => {
  const adapter = provider('gitlab', ['git.example.com:8443'], async () => ({}))
  const repository = adapter.repositoryFromRemote('https://git.example.com:8443/team/repo.git')
  assert.equal(repository.host, 'git.example.com:8443')
  assert.equal(
    adapter.changeRequestUrl({ repository, number: 7 }),
    'https://git.example.com:8443/team/repo/-/merge_requests/7'
  )
  assert.equal(adapter.repositoryFromRemote('https://git.example.com/team/repo.git'), undefined)
})

test('tea raw diff를 읽어도 로그인 목록은 JSON으로 해석하고 선택한 API 본문만 원문으로 반환한다', async () => {
  const calls = []
  const ctx = {
    subprocess: {
      resolveExecutable: async (name) => name,
      spawn(spec) {
        calls.push(spec.argv)
        const login = spec.argv.includes('login')
        return {
          done: Promise.resolve({ exitCode: 0 }),
          terminate() {},
          waitForExit: async () => {},
          collected: {
            stdout: {
              readFrom: () => ({
                text: login
                  ? JSON.stringify([{ name: 'account', url: 'https://codeberg.org' }])
                  : 'diff --git a/a b/a\n',
                lossy: false,
              }),
            },
            stderr: { readFrom: () => ({ text: login ? '' : 'HTTP/1.1 200 OK', lossy: false }) },
          },
        }
      },
    },
  }
  const result = await hostApi(ctx, 'forgejo')('codeberg.org', 'repos/team/repo/pulls/7.diff', signal, { raw: true })
  assert.equal(result, 'diff --git a/a b/a\n')
  assert.ok(calls[1].includes('account'))
})
