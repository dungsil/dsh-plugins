import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

// This standalone helper is not a package entry point. Exercise its real source
// without changing the production exports or generating a test-only bundle.
const source = await readFile(new URL('../src/cli-status.ts', import.meta.url), 'utf8')
const { inspectCliStatus } = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`
)

const empty = { gh: { hosts: {} }, glab: { hosts: [] }, tea: [] }
const ghAccount = {
  state: 'success',
  active: true,
  host: 'github.com',
  login: 'monalisa',
  tokenSource: 'GH_CONFIG_DIR/hosts.yml',
  gitProtocol: 'https',
}
const glabAccount = {
  host: 'gitlab.example.com:8443',
  state: 'success',
  user: 'alice',
  token_source: 'keyring',
  api_endpoint: 'https://gitlab.example.com:8443/api/v4/',
}
const teaLogin = {
  name: 'work profile',
  url: 'https://gitea.example.com/subpath',
  ssh_host: 'git.example.com',
  user: 'stale-user',
  default: 'true',
}

function runner(fixtures = {}, queries = []) {
  return async (cli, args) => {
    queries.push([cli, args])
    const fixture = args[0] === 'api' ? fixtures[args[4]] : (fixtures[cli] ?? empty[cli])
    if (fixture instanceof Error) throw fixture
    return typeof fixture === 'string' ? fixture : JSON.stringify(fixture)
  }
}

await test('검증된 계정의 호스트와 로그인 및 허용된 인증 방식만 반환한다', async () => {
  const queries = []
  const result = await inspectCliStatus(
    runner(
      {
        gh: { hosts: { 'github.com': [ghAccount, { ...ghAccount, login: 'hubot', tokenSource: 'GH_TOKEN' }] } },
        glab: { hosts: [glabAccount] },
        tea: [teaLogin],
        'work profile': { id: 42, login: 'current-user', email: 'private@example.com', full_name: 'Private name' },
      },
      queries
    )
  )
  assert.deepEqual(result, [
    {
      cli: 'gh',
      status: 'authenticated',
      accounts: [
        { host: 'github.com', login: 'monalisa', method: 'config-file' },
        { host: 'github.com', login: 'hubot', method: 'environment' },
      ],
    },
    {
      cli: 'glab',
      status: 'authenticated',
      accounts: [{ host: 'gitlab.example.com:8443', login: 'alice', method: 'keyring' }],
    },
    { cli: 'tea', status: 'authenticated', accounts: [{ host: 'gitea.example.com', login: 'current-user' }] },
  ])
  assert.deepEqual(queries, [
    ['gh', ['auth', 'status', '--json', 'hosts']],
    ['glab', ['auth', 'status', '--all', '--output', 'json']],
    ['tea', ['login', 'list', '--output', 'json']],
    ['tea', ['api', '--method', 'GET', '--login', 'work profile', 'user']],
  ])
})

await test('설치된 CLI에 계정이 없으면 인증되지 않은 상태를 반환한다', async () => {
  assert.deepEqual(
    (await inspectCliStatus(runner())).map(({ status }) => status),
    ['unauthenticated', 'unauthenticated', 'unauthenticated']
  )
})

await test('정확한 실행 파일 해석 실패만 설치되지 않은 상태로 구분한다', async () => {
  const result = await inspectCliStatus(
    runner({ gh: new Error('cli_missing'), glab: new Error('spawn ENOENT'), tea: new Error('permission denied') })
  )
  assert.deepEqual(
    result.map(({ status }) => status),
    ['unavailable', 'error', 'error']
  )
  assert.ok(result.every(({ accounts }) => accounts.length === 0))
})

await test('시간 초과와 정책 거절 및 지원되지 않는 옵션을 오류로 처리하고 원문을 노출하지 않는다', async () => {
  const secret = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz'
  for (const reason of ['timed out', 'policy denied', 'unknown flag --output', 'cli_missing extra']) {
    const result = await inspectCliStatus(async () => {
      throw new Error(`${reason} ${secret}`)
    })
    assert.ok(result.every(({ status }) => status === 'error'))
    assert.ok(!JSON.stringify(result).includes(secret))
  }
})

await test('손상되거나 예상 구조가 아닌 JSON을 인증 성공으로 처리하지 않는다', async () => {
  for (const fixture of ['not JSON', 'null', '[]', '{}', '{"hosts":null}', 'x'.repeat(1_048_577)]) {
    const result = await inspectCliStatus(runner({ gh: fixture, glab: fixture }))
    assert.equal(result[0].status, 'error')
    assert.equal(result[1].status, 'error')
  }
})

await test('실패한 gh 계정과 네트워크 시간 초과를 인증 성공으로 처리하지 않는다', async () => {
  for (const state of ['error', 'timeout', 'unknown']) {
    const result = await inspectCliStatus(
      runner({ gh: { hosts: { 'github.com': [{ ...ghAccount, state, error: 'HTTP 500 secret' }] } } })
    )
    assert.deepEqual(result[0], { cli: 'gh', status: 'error', accounts: [] })
  }
  const expired = await inspectCliStatus(
    runner({ gh: { hosts: { 'github.com': [{ ...ghAccount, state: 'refresh_expired' }] } } })
  )
  assert.equal(expired[0].status, 'unauthenticated')
})

await test('일부 계정의 검증이 실패하면 검증된 계정만 유지하고 전체 상태를 오류로 표시한다', async () => {
  const result = await inspectCliStatus(
    runner({ gh: { hosts: { 'github.com': [ghAccount, { ...ghAccount, state: 'timeout', login: 'failed' }] } } })
  )
  assert.equal(result[0].status, 'error')
  assert.deepEqual(result[0].accounts, [{ host: 'github.com', login: 'monalisa', method: 'config-file' }])
})

await test('tea는 저장된 로그인마다 사용자 API를 호출하고 설정된 사용자명을 신뢰하지 않는다', async () => {
  const queries = []
  const result = await inspectCliStatus(
    runner(
      {
        tea: [teaLogin, { ...teaLogin, name: 'second' }],
        'work profile': { id: 1, login: 'verified' },
        second: new Error('HTTP 401'),
      },
      queries
    )
  )
  assert.deepEqual(result[2], {
    cli: 'tea',
    status: 'error',
    accounts: [{ host: 'gitea.example.com', login: 'verified' }],
  })
  assert.equal(queries.filter(([cli, args]) => cli === 'tea' && args[0] === 'api').length, 2)
})

await test('tea의 API 명령이 없거나 종료 코드가 0인 HTTP 오류 본문이면 인증 성공으로 처리하지 않는다', async () => {
  for (const response of [
    new Error('No help topic for api'),
    { message: 'token is required', url: 'https://docs.gitea.com' },
    { login: 'unvalidated' },
    { id: 0, login: 'unvalidated' },
  ]) {
    const result = await inspectCliStatus(runner({ tea: [teaLogin], 'work profile': response }))
    assert.deepEqual(result[2], { cli: 'tea', status: 'error', accounts: [] })
  }
})

await test('허용된 필드라도 토큰과 URL 자격 증명 및 제어 문자를 반환하지 않는다', async () => {
  const secrets = [
    'ghp_1234567890abcdefghij',
    'github_pat_1234567890',
    'glpat-abcdefghijklmnopqrst',
    '0123456789abcdef0123456789abcdef01234567',
    'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW',
    'eyJhbGciOiJIUzI1NiJ9.payload.signature',
    'alice\nsecret',
  ]
  for (const secret of secrets) {
    for (const field of ['host', 'login']) {
      const result = await inspectCliStatus(
        runner({ gh: { hosts: { 'github.com': [{ ...ghAccount, [field]: secret }] } } })
      )
      assert.equal(result[0].status, 'error')
      assert.ok(!JSON.stringify(result).includes(secret))
    }
    const result = await inspectCliStatus(
      runner({
        glab: { hosts: [{ ...glabAccount, user: secret }] },
        tea: [teaLogin],
        'work profile': { id: 1, login: secret },
      })
    )
    assert.equal(result[1].status, 'error')
    assert.equal(result[2].status, 'error')
    assert.ok(!JSON.stringify(result).includes(secret))
  }
  for (const url of [
    'https://alice:secret@gitea.example.com',
    'https://gitea.example.com/?token=secret',
    'https://gitea.example.com/#secret',
  ]) {
    const queries = []
    const result = await inspectCliStatus(runner({ tea: [{ ...teaLogin, url }] }, queries))
    assert.deepEqual(result[2], { cli: 'tea', status: 'error', accounts: [] })
    assert.ok(!queries.some(([, args]) => args[0] === 'api'))
  }
})

await test('토큰과 오류 원문 및 임의 인증 방식은 성공한 계정에서도 반환하지 않는다', async () => {
  const secret = 'glpat-abcdefghijklmnopqrst'
  const result = await inspectCliStatus(
    runner({
      gh: {
        hosts: { 'github.com': [{ ...ghAccount, token: secret, tokenSource: secret, error: secret, scopes: secret }] },
      },
      glab: { hosts: [{ ...glabAccount, token: secret, token_source: secret, error: secret }] },
      tea: [{ ...teaLogin, token: secret }],
      'work profile': { id: 1, login: 'verified', token: secret, email: secret },
    })
  )
  assert.ok(result.every(({ status }) => status === 'authenticated'))
  assert.ok(!JSON.stringify(result).includes(secret))
  assert.ok(result.every(({ accounts }) => accounts.every((item) => !('method' in item))))
})
