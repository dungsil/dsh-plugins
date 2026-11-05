export interface CliStatus {
  cli: 'gh' | 'glab' | 'tea'
  status: 'authenticated' | 'unauthenticated' | 'unavailable' | 'error'
  accounts: { host: string; login: string; method?: 'environment' | 'keyring' | 'config-file' }[]
}

type Run = (executable: string, args: string[]) => Promise<string>
type Account = CliStatus['accounts'][number]

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_status')
  return value as Record<string, unknown>
}

function parse(output: string): unknown {
  if (output.length > 1_048_576) throw new Error('invalid_status')
  return JSON.parse(output)
}

// Deliberately conservative: an unusual identity is safer to omit than to echo
// an opaque credential masquerading as an identity. Never return error messages.
function safe(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !/(?:gh[pousr]_|github_pat_|gl(?:pat|oas|rt|cbt|ptt|ft|soat|dt)-|Bearer|eyJ)/i.test(value) &&
    !/[a-f0-9]{20,}/i.test(value) &&
    !/[a-z0-9_+-]{32,}/i.test(value)
  )
}

function host(value: unknown): string {
  if (
    !safe(value) ||
    value.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(value)
  ) {
    throw new Error('invalid_identity')
  }
  return value.toLowerCase()
}

function account(hostname: unknown, login: unknown, source?: unknown): Account {
  if (!safe(login) || !/^[a-z0-9][a-z0-9_.-]{0,99}$/i.test(login)) throw new Error('invalid_identity')
  const result: Account = { host: host(hostname), login }
  // Only fixed labels, never arbitrary tokenSource paths or environment values.
  if (
    ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'environment'].includes(
      String(source)
    )
  ) {
    result.method = 'environment'
  } else if (source === 'keyring') {
    result.method = 'keyring'
  } else if (source === 'config_file' || (typeof source === 'string' && /(?:^|[/\\])hosts\.yml$/.test(source))) {
    result.method = 'config-file'
  }
  return result
}

async function inspectAuth(cli: 'gh' | 'glab', run: Run): Promise<CliStatus> {
  const args = cli === 'gh' ? ['auth', 'status', '--json', 'hosts'] : ['auth', 'status', '--all', '--output', 'json']
  const data = object(parse(await run(cli, args)))
  const rows =
    cli === 'gh'
      ? Object.values(object(data.hosts)).flatMap((entries) => {
          if (!Array.isArray(entries)) throw new Error('invalid_status')
          return entries
        })
      : data.hosts
  if (!Array.isArray(rows)) throw new Error('invalid_status')
  const accounts: Account[] = []
  let failed = false
  for (const row of rows) {
    const entry = object(row)
    if (entry.state === 'success') {
      try {
        accounts.push(
          account(
            entry.host,
            cli === 'gh' ? entry.login : entry.user,
            cli === 'gh' ? entry.tokenSource : entry.token_source
          )
        )
      } catch {
        failed = true
      }
    } else if (entry.state !== 'refresh_expired') {
      // CLI state "error" includes network failures, not just rejected tokens.
      failed = true
    }
  }
  return { cli, status: failed ? 'error' : accounts.length ? 'authenticated' : 'unauthenticated', accounts }
}

async function inspectTea(run: Run): Promise<CliStatus> {
  // tea 0.14.2: list is a safe table projection, NOT proof of authentication.
  // Older versions without `api` fail closed as error, never authenticated.
  const logins = parse(await run('tea', ['login', 'list', '--output', 'json']))
  if (!Array.isArray(logins)) throw new Error('invalid_status')
  const accounts: Account[] = []
  let failed = false
  for (const row of logins) {
    try {
      const entry = object(row)
      if (
        typeof entry.name !== 'string' ||
        !entry.name ||
        entry.name.length > 256 ||
        entry.name.split('').some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      ) {
        throw new Error('invalid_status')
      }
      if (typeof entry.url !== 'string') throw new Error('invalid_status')
      const url = new URL(entry.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('invalid_identity')
      }
      const hostname = host(url.host)
      // --login selects this stored profile rather than a repository/default
      // login. GET /user is private and returns the validated identity.
      const user = object(parse(await run('tea', ['api', '--method', 'GET', '--login', entry.name, 'user'])))
      // tea api can exit zero for HTTP errors; a JSON error body is not a user.
      if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('invalid_user')
      accounts.push(account(hostname, user.login))
    } catch (error) {
      if (error instanceof Error && error.message === 'cli_missing') throw error
      failed = true
    }
  }
  return { cli: 'tea', status: failed ? 'error' : accounts.length ? 'authenticated' : 'unauthenticated', accounts }
}

/** The runner must reject resolution failures with Error('cli_missing'), and
 * reject nonzero exits, policy failures and timeouts with any other error.
 * It must bound execution/output and disable prompts. No stdout/stderr is ever
 * returned, including when older CLIs do not support these structured queries.
 */
export async function inspectCliStatus(run: Run): Promise<CliStatus[]> {
  return Promise.all(
    (['gh', 'glab', 'tea'] as const).map(async (cli): Promise<CliStatus> => {
      try {
        return await (cli === 'tea' ? inspectTea(run) : inspectAuth(cli, run))
      } catch (error) {
        return {
          cli,
          status: error instanceof Error && error.message === 'cli_missing' ? 'unavailable' : 'error',
          accounts: [],
        }
      }
    })
  )
}
