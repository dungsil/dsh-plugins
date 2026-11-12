import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import ForgeService from '@deepseek-ai/dsh-experimental-forge'
import * as plugin from '../dist/index.js'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const family = manifest.name.endsWith('forgejo') ? 'forgejo' : 'gitea'
const Provider = plugin.ForgejoProvider ?? plugin.GiteaProvider
const host = family === 'forgejo' ? 'codeberg.org' : 'gitea.com'
const ref = { repository: { forge: family, host, owner: 'owner', name: 'repo' }, number: 7 }
const signal = () => new AbortController().signal
const sha = 'a'.repeat(40)
const fixture = () => ({
  number: 7,
  html_url: `https://${host}/owner/repo/pulls/7`,
  title: 'Change',
  state: 'open',
  merged: false,
  draft: false,
  user: { login: 'author' },
  head: { ref: 'feature', sha, repo: { full_name: 'owner/repo' } },
  base: { ref: 'main', repo: { full_name: 'owner/repo' } },
  mergeable: true,
  additions: 3,
  deletions: 1,
  updated_at: '2026-11-01T00:00:00Z',
  closed_at: null,
})
function mock(answer = () => fixture(), options = {}) {
  const calls = []
  const run = async (args, abort, input) => {
    abort.throwIfAborted()
    calls.push({ args, input })
    if (args[0] === 'login')
      return {
        exitCode: 0,
        stdout: JSON.stringify(options.logins ?? [{ name: 'account', url: `https://${host}` }]),
        stderr: '',
      }
    const endpoint = args.at(-1).split('/api/v1/')[1]
    const output = answer(endpoint, args)
    return {
      exitCode: 0,
      stdout: typeof output === 'string' ? output : JSON.stringify(output),
      stderr: `HTTP/2 ${typeof options.status === 'function' ? options.status(endpoint) : (options.status ?? 200)} OK\n`,
    }
  }
  return { provider: new Provider(run, [host], options.maxOutputBytes ?? 65536), calls }
}

await test('설치 메타데이터는 세 언어로 market과 일치하고 이전 UI 키를 포함하지 않는다', async () => {
  assert.ok(manifest.files.includes('locale'))
  assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-experimental-forge'], '0.2.2-rc.2')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-subprocess'], '0.2.2-rc.2')
  for (const language of ['en', 'ko', 'zh']) {
    const locale = JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(locale, {
      meta: { title: manifest.market.title[language], description: manifest.market.description[language] },
    })
  }
})

await test('플러그인은 공식 forge 서비스만 주입하고 독립 family를 등록한다', () => {
  assert.deepEqual(plugin.inject, ['forge'])
  const config = plugin.Config({})
  assert.deepEqual(config.hosts, [host])
  let registered
  plugin.apply(
    {
      forge: {
        register(value) {
          registered = value
        },
      },
    },
    config
  )
  assert.equal(registered.forge, family)
  assert.equal(manifest.dsh.client, undefined)
  assert.equal(manifest.exports['./client'], undefined)
  assert.ok(!Object.keys(manifest.devDependencies).some((key) => /ui-vcs|react|client-ui/.test(key)))
})

await test('명시된 HTTPS와 SSH 호스트만 소유하고 다른 provider와 자격증명 URL을 거부한다', () => {
  const { provider } = mock()
  assert.deepEqual(provider.repositoryFromRemote(`git@${host}:owner/repo.git`), ref.repository)
  assert.deepEqual(provider.repositoryFromRemote(`https://${host}/owner/repo.git`), ref.repository)
  assert.deepEqual(provider.changeRequestFromUrl(`https://${host}/owner/repo/pulls/7`), ref)
  for (const url of [
    `https://github.com/owner/repo`,
    `https://user:secret@${host}/owner/repo`,
    `https://${host}/owner/%2e%2e/repo`,
    `http://${host}/owner/repo`,
    `https://${host}/owner/repo?x=1`,
  ])
    assert.equal(provider.repositoryFromRemote(url), undefined)
  assert.equal(provider.changeRequestFromUrl(`https://${host}/owner/repo/pulls/9007199254740993`), undefined)
  assert.equal(
    new Provider(async () => assert.fail(), ['private.example'], 1024).repositoryFromRemote(
      'git@private.example:owner/repo.git'
    ).host,
    'private.example'
  )
})

await test('fetch는 실제 계약의 snapshot과 검사 결과를 정규화하고 짧은 페이지 다음도 읽는다', async () => {
  const { provider, calls } = mock((endpoint) =>
    endpoint.includes('/statuses/')
      ? endpoint.includes('page=1')
        ? [{ context: 'build', state: 'pending', target_url: 'https://ci.example/job' }]
        : []
      : fixture()
  )
  const values = [...(await provider.fetch([ref], signal())).values()]
  assert.equal(values.length, 1)
  assert.equal(values[0].headSha, sha)
  assert.equal(values[0].checksRollup, 'pending')
  assert.equal(values[0].checksTruncated, false)
  assert.equal(values[0].mergeReady, true)
  assert.equal(values[0].checks[0].rerun, null)
  assert.equal(values[0].canRerunChecks, false)
  assert.deepEqual(values[0].branchUpdates, [])
  assert.deepEqual(values[0].reviewers, [])
  assert.equal(values[0].reviewersTruncated, true)
  assert.equal(values[0].canRequestReviews, false)
  assert.equal(values[0].threadsTruncated, true)
  assert.deepEqual(values[0].closingIssues, [])
  assert.equal(values[0].closingIssuesTruncated, true)
  for (const method of [
    'updateBranch',
    'rerunChecks',
    'requestReviews',
    'reviewerCandidates',
    'readReview',
    'writeReview',
  ])
    assert.equal(provider[method], undefined)
  assert.ok(calls.some(({ args }) => args.at(-1).includes('page=2')))
  for (const { args } of calls.filter(({ args }) => args[0] === 'api')) {
    assert.equal(args[args.indexOf('--login') + 1], 'account')
    assert.ok(args.at(-1).startsWith(`https://${host}/api/v1/`))
    assert.ok(args.includes('--include'))
  }
})

await test('HTTP 오류가 exit 0이어도 인증 실패로 분류하고 모호한 로그인은 요청하지 않는다', async () => {
  const denied = mock(() => ({ message: 'denied' }), { status: 401 })
  assert.equal((await denied.provider.readiness(host, signal())).state, 'unauthenticated')
  const ambiguous = mock(undefined, {
    logins: [
      { name: 'a', url: `https://${host}` },
      { name: 'b', url: `https://${host}` },
    ],
  })
  assert.equal((await ambiguous.provider.readiness(host, signal())).state, 'unauthenticated')
  assert.ok(!ambiguous.calls.some(({ args }) => args[0] === 'api'))
  assert.equal((await mock().provider.readiness('unconfigured.example', signal())).state, 'unavailable')
})

await test('잘못된 JSON과 snapshot 및 초과 출력은 성공으로 정규화하지 않는다', async () => {
  for (const answer of [
    () => '{invalid',
    () => ({ ...fixture(), number: 8 }),
    () => ({ ...fixture(), additions: -1 }),
  ]) {
    const values = [...(await mock(answer).provider.fetch([ref], signal())).values()]
    assert.equal(values[0].code, 'unavailable')
  }
  const values = [
    ...(await mock(() => 'x'.repeat(2000), { maxOutputBytes: 1024 }).provider.fetch([ref], signal())).values(),
  ]
  assert.equal(values[0].code, 'too-large')
})

await test('조회는 기본 브랜치와 fork를 제외하고 페이지 상한에서 실패한다', async () => {
  const { provider } = mock((endpoint) =>
    endpoint === 'repos/owner/repo'
      ? { default_branch: 'main' }
      : endpoint.includes('page=1')
        ? [fixture(), { ...fixture(), number: 8, head: { ref: 'feature', repo: { full_name: 'fork/repo' } } }]
        : []
  )
  assert.deepEqual(await provider.findByHead(ref.repository, 'main', signal()), [])
  assert.deepEqual(await provider.findByHead(ref.repository, 'feature', signal()), [ref])
  const bounded = mock((endpoint) => (endpoint === 'repos/owner/repo' ? { default_branch: 'main' } : [fixture()]))
  await assert.rejects(bounded.provider.findByHead(ref.repository, 'feature', signal()), /20 pages/)
})

await test('병합은 stale SHA에서 쓰지 않고 원자 SHA와 branch 유지 및 자동 병합 금지를 전송한다', async () => {
  const stale = mock()
  assert.equal((await stale.provider.merge(ref, { method: 'merge', headSha: 'b'.repeat(40) }, signal())).code, 'stale')
  assert.ok(!stale.calls.some(({ args }) => args.includes('POST')))
  const current = mock((endpoint) => (endpoint.endsWith('/merge') ? '' : fixture()))
  assert.equal(await current.provider.merge(ref, { method: 'squash', headSha: sha }, signal()), undefined)
  const write = current.calls.find(({ args }) => args.includes('POST')).args
  assert.ok(write.includes(`head_commit_id=${sha}`))
  assert.ok(write.includes('Do=squash'))
  assert.ok(write.includes('delete_branch_after_merge=false'))
  assert.ok(write.includes('merge_when_checks_succeed=false'))
  assert.ok(!write.includes('--data'))
  assert.equal((await current.provider.markReady(ref, signal())).code, 'failed')
  assert.equal(current.provider.submitReview, undefined)
})

await test('보호 규칙과 병합 가능 여부가 미확인이어도 열린 PR은 서버에 병합을 요청한다', async () => {
  const { provider, calls } = mock((endpoint) =>
    endpoint.endsWith('/merge') ? '' : endpoint.includes('/statuses/') ? [] : { ...fixture(), mergeable: undefined }
  )
  assert.equal((await provider.fetchChecks(ref, signal())).mergeReady, true)
  assert.equal(await provider.merge(ref, { method: 'merge', headSha: sha }, signal()), undefined)
  assert.equal(calls.filter(({ args }) => args.includes('POST')).length, 1)
})

await test('닫힌 PR과 초안 및 명시적 충돌은 병합 가능으로 표시하지 않는다', async () => {
  for (const row of [
    { state: 'closed' },
    { merged: true },
    { draft: true },
    { title: 'Draft: Change' },
    { mergeable: false },
  ]) {
    const { provider, calls } = mock((endpoint) => (endpoint.includes('/statuses/') ? [] : { ...fixture(), ...row }))
    assert.equal((await provider.fetchChecks(ref, signal())).mergeReady, false)
    assert.equal((await provider.merge(ref, { method: 'merge', headSha: sha }, signal())).code, 'failed')
    assert.ok(!calls.some(({ args }) => args.includes('POST')))
  }
})

await test('병합 거부는 서버 메시지와 HTTP 상태를 반환하고 자동으로 재시도하지 않는다', async () => {
  for (const [status, message, code] of [
    [403, 'Protected branch requires an approved review', 'failed'],
    [409, 'Required status checks have not passed', 'failed'],
    [409, 'head_commit_id does not match the current head', 'stale'],
    [405, 'This merge method is not allowed', 'failed'],
    [401, 'Authentication required', 'unauthenticated'],
  ]) {
    const { provider, calls } = mock((endpoint) => (endpoint.endsWith('/merge') ? { message } : fixture()), {
      status: (endpoint) => (endpoint.endsWith('/merge') ? status : 200),
    })
    const result = await provider.merge(ref, { method: 'merge', headSha: sha }, signal())
    assert.equal(result.code, code)
    assert.equal(result.message, 'HTTP ' + status + ': ' + message)
    assert.equal(calls.filter(({ args }) => args.includes('POST')).length, 1)
  }
})

await test('손상된 오류 응답은 HTTP 상태로 표시하고 메시지의 제어 문자와 토큰을 제거한다', async () => {
  const broken = mock((endpoint) => (endpoint.endsWith('/merge') ? '<html>bad gateway</html>' : fixture()), {
    status: (endpoint) => (endpoint.endsWith('/merge') ? 502 : 200),
  })
  assert.equal((await broken.provider.merge(ref, { method: 'merge', headSha: sha }, signal())).message, 'HTTP 502')
  const guarded = mock(
    (endpoint) => (endpoint.endsWith('/merge') ? { message: 'Denied\nBearer fixture-token' } : fixture()),
    { status: (endpoint) => (endpoint.endsWith('/merge') ? 403 : 200) }
  )
  assert.equal(
    (await guarded.provider.merge(ref, { method: 'merge', headSha: sha }, signal())).message,
    'HTTP 403: Denied Bearer [redacted]'
  )
})

await test('diff와 파일 조회는 SHA 및 경로를 고정하고 취소되면 즉시 중단한다', async () => {
  const { provider, calls } = mock((endpoint) => (endpoint.endsWith('/pulls/7') ? fixture() : 'text'))
  assert.equal(await provider.diff(ref, sha.toUpperCase(), signal()), 'text')
  assert.equal(calls.filter(({ args }) => args.at(-1).endsWith('/pulls/7')).length, 2)
  assert.equal(await provider.fileText(ref, sha, 'dir/a b.txt', signal()), 'text')
  assert.ok(calls.some(({ args }) => args.at(-1).endsWith(`/raw/dir/a%20b.txt?ref=${sha}`)))
  assert.equal((await provider.fileText(ref, sha, '../secret', signal())).code, 'unavailable')
  assert.throws(() => provider.fileUrl(ref, 'main', 'file'), /commit/)
  const abort = new AbortController()
  abort.abort(new Error('cancelled'))
  const before = calls.length
  await assert.rejects(provider.fetch([ref], abort.signal), /cancelled/)
  assert.equal(calls.length, before)
})

await test('diff는 조회 전과 도중에 head가 바뀌면 stale을 반환하고 patch를 노출하지 않는다', async () => {
  const stale = mock(() => ({ ...fixture(), head: { sha: 'b'.repeat(40) } }))
  assert.equal((await stale.provider.diff(ref, sha, signal())).code, 'stale')
  assert.ok(!stale.calls.some(({ args }) => args.at(-1).endsWith('.diff')))
  let reads = 0
  const moving = mock((endpoint) =>
    endpoint.endsWith('.diff') ? 'old patch' : { ...fixture(), head: { sha: ++reads === 1 ? sha : 'b'.repeat(40) } }
  )
  assert.equal((await moving.provider.diff(ref, sha, signal())).code, 'stale')
  assert.equal(reads, 2)
})

await test('diff는 명시적 base 읽기를 unsupported로 반환하고 잘못된 SHA와 취소를 명령 실행 전에 거부한다', async () => {
  const { provider, calls } = mock()
  assert.equal((await provider.diff(ref, sha, signal(), 'b'.repeat(40))).code, 'unsupported')
  for (const [head, base] of [
    ['main', undefined],
    [sha, 'main'],
    ['a'.repeat(41), undefined],
  ])
    assert.equal((await provider.diff(ref, head, signal(), base)).code, 'unavailable')
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await assert.rejects(provider.diff(ref, sha, controller.signal), /cancelled/)
  assert.equal(calls.length, 0)
})

await test('SHA는 40자 또는 64자만 허용하고 중간 길이는 읽기와 병합 전에 거부한다', async () => {
  for (const length of [41, 63]) {
    const { provider, calls } = mock()
    const invalid = 'a'.repeat(length)
    assert.equal((await provider.fileText(ref, invalid, 'file', signal())).code, 'unavailable')
    assert.equal((await provider.merge(ref, { method: 'merge', headSha: invalid }, signal())).code, 'failed')
    assert.equal(calls.length, 0)
  }
  const { provider } = mock(() => 'text')
  assert.equal(await provider.fileText(ref, 'a'.repeat(64), 'file', signal()), 'text')
})

await test('검사 상태는 pending과 success 및 failure를 구분하고 알 수 없는 상태는 거부한다', async () => {
  for (const [state, rollup] of [
    ['success', 'success'],
    ['failure', 'failure'],
    ['error', 'failure'],
    ['pending', 'pending'],
  ]) {
    const { provider } = mock((endpoint) =>
      endpoint.includes('/statuses/') ? (endpoint.includes('page=1') ? [{ context: 'build', state }] : []) : fixture()
    )
    assert.equal((await provider.fetchChecks(ref, signal())).checksRollup, rollup)
  }
  const { provider } = mock((endpoint) =>
    endpoint.includes('/statuses/')
      ? endpoint.includes('page=1')
        ? [{ context: 'build', state: 'unknown' }]
        : []
      : fixture()
  )
  assert.equal((await provider.fetchChecks(ref, signal())).code, 'unavailable')
})

await test('runner는 비대화형 자격증명 격리 환경을 만들고 없는 실행 파일을 안전하게 실패한다', async () => {
  const previous = process.env.TEA_LOGIN
  process.env.TEA_LOGIN = 'ambient-login'
  try {
    assert.equal(plugin.teaEnvironment().TEA_LOGIN, undefined)
  } finally {
    if (previous === undefined) delete process.env.TEA_LOGIN
    else process.env.TEA_LOGIN = previous
  }
  const run = plugin.createTeaRunner({
    teaCommand: 'dsh-missing-tea-executable-404',
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  })
  await assert.rejects(run(['version'], signal()), /could not start/)
})

await test('공식 forge 서비스가 서버의 병합 거부 메시지를 UI 계약에 그대로 전달한다', async (t) => {
  const ctx = new Context()
  new ForgeService(ctx, {
    activeIntervalMs: 30000,
    idleIntervalMs: 120000,
    maxBackoffMs: 600000,
    fetchTimeoutMs: 30000,
  })
  t.after(() => ctx.fiber.dispose())
  const message = 'Branch protection requires two approvals'
  const { provider, calls } = mock(
    (endpoint) => (endpoint.endsWith('/merge') ? { message } : endpoint.includes('/statuses/') ? [] : fixture()),
    { status: (endpoint) => (endpoint.endsWith('/merge') ? 403 : 200) }
  )
  ctx.forge.register(provider)
  assert.equal((await ctx.forge.fetchChecks(ref, signal())).mergeReady, true)
  const result = await ctx.forge.merge(ref, { method: 'merge', headSha: sha }, signal())
  assert.deepEqual(result, { code: 'failed', message: 'HTTP 403: ' + message })
  assert.equal(calls.filter(({ args }) => args.includes('POST')).length, 1)
})
