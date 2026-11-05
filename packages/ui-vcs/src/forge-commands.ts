export type ForgeProvider = 'auto' | 'github' | 'gitlab' | 'gitea' | 'forgejo'
export type ForgeRun = (
  executable: string,
  args: string[],
  options?: { allowed?: number[]; maxBytes?: number; stdin?: string }
) => Promise<string>

export interface PushContext {
  remote: string
  remoteUrl: string
  sourceBranch: string
  pushBranch: string
  baseBranch: string
}

export interface ForgeReview {
  number: number
  title: string
  body: string
  url: string
  baseBranch: string
  repository: string
}

export interface ForgeContext extends PushContext {
  provider: Exclude<ForgeProvider, 'auto'>
  host: string
  origin: string
  repository: string
  targetRepository: string
  existingReview: ForgeReview | null
  login?: string
  projectId?: number
  targetProjectId?: number
  baseRef?: string
}

type Row = Record<string, any>
const git = (run: ForgeRun, args: string[], allowed?: number[]) =>
  run('git', ['-c', 'core.fsmonitor=false', ...args], { allowed }).then((value) => value.trim())
const config = (run: ForgeRun, key: string) => git(run, ['config', '--get', key], [0, 1])
function fail(code = 'invalid_response'): never {
  throw new Error(code)
}
const string = (value: unknown): string => (typeof value === 'string' ? value : fail())
const positive = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fail()
const json = (value: string): Row => {
  try {
    return JSON.parse(value)
  } catch {
    return fail()
  }
}
const repoName = (value: unknown): string => {
  const name = string(value)
  if (
    name.split('/').length < 2 ||
    name.split('/').some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')
  )
    fail('unsupported')
  return name
}
const branchName = (value: string): string => {
  if (
    !value ||
    value.startsWith('-') ||
    Array.from(value).some((char) => char.codePointAt(0)! <= 32 || char.codePointAt(0) === 127) ||
    /[~^:?*[\\]/.test(value) ||
    value.includes('..') ||
    value.includes('@{') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))
  )
    fail('unsupported')
  return value
}

export async function discoverPush(run: ForgeRun): Promise<PushContext> {
  const sourceBranch = await git(run, ['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])
  if (!sourceBranch) fail('detached_head')
  branchName(sourceBranch)
  const tracked = await config(run, `branch.${sourceBranch}.remote`)
  const remote =
    (await config(run, `branch.${sourceBranch}.pushRemote`)) ||
    (await config(run, 'remote.pushDefault')) ||
    tracked ||
    'origin'
  if (remote === '.' || remote.startsWith('-') || !/^[\w./-]+$/.test(remote)) fail('unsupported')
  // Explicit refspecs and mirror pushes can send more than this branch.
  if (
    (await git(run, ['config', '--get-all', `remote.${remote}.push`], [0, 1])) ||
    (await config(run, `remote.${remote}.mirror`)) === 'true'
  )
    fail('unsupported')
  const urls = (await git(run, ['remote', 'get-url', '--push', '--all', '--', remote])).split(/\r?\n/).filter(Boolean)
  if (urls.length !== 1) fail('unsupported')
  const remoteUrl = urls[0]!
  parseRemote(remoteUrl)
  const mode = (await config(run, 'push.default')) || 'simple'
  const merge = tracked ? await config(run, `branch.${sourceBranch}.merge`) : ''
  let pushBranch = sourceBranch
  if (mode === 'upstream') {
    if (tracked !== remote || !merge.startsWith('refs/heads/')) fail('unsupported')
    pushBranch = branchName(merge.slice(11))
  } else if (mode === 'simple') {
    if (tracked === remote && merge && merge !== `refs/heads/${sourceBranch}`) fail('unsupported')
  } else if (mode !== 'current') fail('unsupported')
  // Read the actual push destination, not origin's possibly unrelated cached HEAD.
  const head = await git(run, ['ls-remote', '--symref', '--', remoteUrl, 'HEAD'])
  const defaultRef = /^ref: refs\/heads\/(.+)\s+HEAD\r?$/m.exec(head)
  if (!defaultRef) fail('unsupported')
  return { remote, remoteUrl, sourceBranch, pushBranch, baseBranch: branchName(defaultRef[1]!) }
}

function parseRemote(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `ssh://${raw.replace(/^([^@/]+@)?([^:/]+):/, '$1$2/')}`)
  } catch {
    return fail('unsupported')
  }
  if (
    !['https:', 'http:', 'ssh:'].includes(url.protocol) ||
    !url.hostname ||
    url.search ||
    url.hash ||
    url.password ||
    (url.protocol !== 'ssh:' && url.username)
  )
    fail('unsupported')
  repoName(
    url.pathname
      .replace(/^\//, '')
      .replace(/\.git\/?$/, '')
      .replace(/\/$/, '')
  )
  return url
}

async function resolveRemote(run: ForgeRun, raw: string): Promise<URL> {
  const url = parseRemote(raw)
  if (url.protocol === 'ssh:') {
    const output = await run('ssh', ['-G', ...(url.port ? ['-p', url.port] : []), url.hostname], { maxBytes: 262144 })
    const names = [...output.matchAll(/^hostname\s+(\S+)\s*$/gm)]
    if (names.length !== 1 || !/^[\w.-]+$/.test(names[0]![1]!)) fail('unsupported')
    url.hostname = names[0]![1]!
  }
  return url
}

function api(
  run: ForgeRun,
  context: ForgeContext,
  endpoint: string,
  method?: string,
  fields: Record<string, string | number> = {}
) {
  const args =
    context.provider === 'github'
      ? ['api', '--hostname', context.host]
      : context.provider === 'gitlab'
        ? ['api', '--hostname', context.host]
        : ['api', '--login', context.login!, '--include', '--output', '-']
  if (method) args.push('--method', method)
  for (const [key, value] of Object.entries(fields))
    args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`)
  args.push(
    context.provider === 'gitea' || context.provider === 'forgejo' ? `${context.origin}/api/v1/${endpoint}` : endpoint
  )
  return run(context.provider === 'github' ? 'gh' : context.provider === 'gitlab' ? 'glab' : 'tea', args, {
    maxBytes: 2097152,
  })
}

async function pages(run: ForgeRun, context: ForgeContext, endpoint: string): Promise<Row[]> {
  const rows: Row[] = []
  for (let page = 1; page <= 20; page++) {
    const limit = context.provider === 'gitea' || context.provider === 'forgejo' ? 'limit=50' : 'per_page=100'
    const data = json(await api(run, context, `${endpoint}${endpoint.includes('?') ? '&' : '?'}${limit}&page=${page}`))
    if (data === null && (context.provider === 'gitea' || context.provider === 'forgejo')) return rows
    if (!Array.isArray(data)) fail()
    if (!data.length) return rows
    rows.push(...data)
  }
  return fail()
}

function review(runContext: ForgeContext, row: Row, target: string): ForgeReview {
  const github = runContext.provider === 'github'
  const gitlab = runContext.provider === 'gitlab'
  const number = positive(gitlab ? row.iid : row.number)
  const source = gitlab ? row.source_branch : row.head?.ref
  const baseBranch = branchName(string(gitlab ? row.target_branch : row.base?.ref))
  if (source !== runContext.pushBranch || row.state !== (gitlab ? 'opened' : 'open') || row.merged === true) fail()
  if (gitlab) {
    if (row.source_project_id !== runContext.projectId || row.target_project_id !== runContext.targetProjectId) fail()
  } else if (
    repoName(row.head?.repo?.full_name).toLowerCase() !== runContext.repository.toLowerCase() ||
    repoName(row.base?.repo?.full_name).toLowerCase() !== target.toLowerCase()
  )
    fail()
  const url = string(gitlab ? row.web_url : row.html_url)
  const expected = `${runContext.origin}/${target}/${gitlab ? '-/merge_requests' : github ? 'pull' : 'pulls'}/${number}`
  if (url !== expected) fail()
  return {
    number,
    title: string(row.title),
    body: string((gitlab ? row.description : row.body) ?? ''),
    url,
    baseBranch,
    repository: target,
  }
}

async function findReview(
  run: ForgeRun,
  context: ForgeContext,
  targets: { repository: string; id?: number }[]
): Promise<ForgeReview | null> {
  const matches: ForgeReview[] = []
  for (const target of targets) {
    let endpoint: string
    if (context.provider === 'github')
      endpoint = `repos/${target.repository}/pulls?state=open&head=${encodeURIComponent(`${context.repository.split('/')[0]}:${context.pushBranch}`)}`
    else if (context.provider === 'gitlab')
      endpoint = `projects/${target.id}/merge_requests?state=opened&source_branch=${encodeURIComponent(context.pushBranch)}`
    else endpoint = `repos/${target.repository}/pulls?state=open`
    for (const row of await pages(run, context, endpoint)) {
      if (
        context.provider === 'gitlab'
          ? row.source_branch !== context.pushBranch || row.source_project_id !== context.projectId
          : row.head?.ref !== context.pushBranch ||
            row.head?.repo?.full_name?.toLowerCase() !== context.repository.toLowerCase()
      )
        continue
      const scoped = { ...context, targetProjectId: target.id }
      matches.push(review(scoped, row, target.repository))
    }
  }
  if (matches.length > 1) fail('ambiguous_review')
  return matches[0] ?? null
}

export async function inspectForge(run: ForgeRun, provider: ForgeProvider): Promise<ForgeContext> {
  const push = await discoverPush(run)
  if (push.sourceBranch === push.baseBranch || push.pushBranch === push.baseBranch) fail('default_branch')
  const remote = await resolveRemote(run, push.remoteUrl)
  const detected =
    provider === 'auto'
      ? ({ 'github.com': 'github', 'gitlab.com': 'gitlab', 'gitea.com': 'gitea', 'codeberg.org': 'forgejo' } as const)[
          remote.hostname as 'github.com'
        ]
      : provider
  if (!detected) fail('unsupported')
  const host = remote.hostname + (remote.protocol !== 'ssh:' && remote.port ? `:${remote.port}` : '')
  let repository = repoName(
    remote.pathname
      .replace(/^\//, '')
      .replace(/\.git\/?$/, '')
      .replace(/\/$/, '')
  )
  const context: ForgeContext = {
    ...push,
    provider: detected,
    host,
    origin: `${remote.protocol === 'http:' ? 'http' : 'https'}://${host}`,
    repository,
    targetRepository: repository,
    existingReview: null,
  }
  const forge = detected === 'gitea' || detected === 'forgejo'
  if (forge) {
    const logins = json(await run('tea', ['login', 'list', '--output', 'json']))
    if (!Array.isArray(logins)) fail()
    const matches = logins.filter((entry: Row) => {
      const base = new URL(string(entry.url))
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)
        fail()
      if (remote.protocol === 'ssh:')
        return (
          new URL(`ssh://${string(entry.ssh_host)}`).hostname === remote.hostname && repository.split('/').length === 2
        )
      const prefix = base.pathname.replace(/\/$/, '')
      return (
        base.protocol === remote.protocol &&
        base.host === remote.host &&
        remote.pathname.startsWith(`${prefix}/`) &&
        remote.pathname
          .slice(prefix.length + 1)
          .replace(/\.git\/?$/, '')
          .split('/').length === 2
      )
    })
    if (matches.length !== 1) fail('unsupported')
    const entry = matches[0]!
    const base = new URL(entry.url)
    context.login = string(entry.name)
    if (!context.login || context.login.startsWith('-')) fail()
    context.host = base.host
    context.origin = base.href.replace(/\/$/, '')
    if (remote.protocol !== 'ssh:')
      repository = repoName(repository.slice(base.pathname.replace(/^\/|\/$/g, '').length).replace(/^\//, ''))
    context.repository = context.targetRepository = repository
  }
  if (detected === 'github' && repository.split('/').length !== 2) fail('unsupported')
  const metadata = json(
    await api(
      run,
      context,
      detected === 'gitlab' ? `projects/${encodeURIComponent(repository)}` : `repos/${repository}`
    )
  )
  const metadataName = detected === 'gitlab' ? metadata.path_with_namespace : metadata.full_name
  if (repoName(metadataName).toLowerCase() !== repository.toLowerCase()) fail()
  context.baseBranch = branchName(string(metadata.default_branch))
  if (context.sourceBranch === context.baseBranch || context.pushBranch === context.baseBranch) fail('default_branch')
  if (detected === 'gitlab') context.projectId = context.targetProjectId = positive(metadata.id)
  const targets: { repository: string; id?: number }[] = [{ repository, id: context.projectId }]
  const parent = detected === 'gitlab' ? metadata.forked_from_project : metadata.parent
  if (parent)
    targets.push({
      repository: repoName(detected === 'gitlab' ? parent.path_with_namespace : parent.full_name),
      id: detected === 'gitlab' ? positive(parent.id) : undefined,
    })
  context.existingReview = await findReview(run, context, targets)
  if (context.existingReview) {
    context.targetRepository = context.existingReview.repository
    context.baseBranch = context.existingReview.baseBranch
    context.targetProjectId = targets.find((target) => target.repository === context.targetRepository)?.id
  } else if (parent) fail('ambiguous_target')
  let baseSha: unknown
  if (context.existingReview) {
    const endpoint =
      detected === 'gitlab'
        ? `projects/${context.targetProjectId}/merge_requests/${context.existingReview.number}`
        : `repos/${context.targetRepository}/pulls/${context.existingReview.number}`
    const detail = json(await api(run, context, endpoint))
    const snapshot = review(context, detail, context.targetRepository)
    if (snapshot.url !== context.existingReview.url || snapshot.baseBranch !== context.baseBranch) fail('stale_request')
    context.existingReview = snapshot
    baseSha = detected === 'gitlab' ? detail.diff_refs?.base_sha : detail.base?.sha
  } else {
    const refs = await git(run, ['ls-remote', '--', context.remoteUrl, `refs/heads/${context.baseBranch}`])
    baseSha = /^([a-fA-F0-9]{40,64})\s+refs\/heads\//m.exec(refs)?.[1]
  }
  if (typeof baseSha === 'string' && /^[a-fA-F0-9]{40,64}$/.test(baseSha)) {
    const local = await git(run, ['rev-parse', '--verify', '--quiet', `${baseSha}^{commit}`], [0, 1])
    if (local.toLowerCase() === baseSha.toLowerCase()) context.baseRef = local
  }
  return context
}

async function assertPush(run: ForgeRun, context: PushContext) {
  const current = await discoverPush(run)
  if (
    'provider' in context &&
    (current.sourceBranch === current.baseBranch || current.pushBranch === current.baseBranch)
  )
    fail('default_branch')
  if (
    current.remote !== context.remote ||
    current.remoteUrl !== context.remoteUrl ||
    current.sourceBranch !== context.sourceBranch ||
    current.pushBranch !== context.pushBranch
  )
    fail('stale_request')
}

export async function pushBranch(run: ForgeRun, context: PushContext): Promise<void> {
  await assertPush(run, context)
  await git(run, ['push', '--porcelain', '--', context.remoteUrl, `HEAD:refs/heads/${branchName(context.pushBranch)}`])
}

export async function updateReview(
  run: ForgeRun,
  context: ForgeContext,
  texts: { title: string; body: string }
): Promise<{ url: string }> {
  if (
    typeof texts.title !== 'string' ||
    !texts.title.trim() ||
    /[\r\n\0]/.test(texts.title) ||
    typeof texts.body !== 'string' ||
    texts.body.includes('\0') ||
    new TextEncoder().encode(texts.title + texts.body).length > 60000
  )
    fail('invalid_payload')
  await assertPush(run, context)
  // A lost reply can hide a successful create. Find the PR before each write.
  const existing = await findReview(run, context, [
    { repository: context.targetRepository, id: context.targetProjectId },
  ])
  if (context.existingReview && (!existing || existing.url !== context.existingReview.url)) fail('stale_request')
  if (existing && existing.baseBranch !== context.baseBranch) fail('stale_request')
  if (!context.existingReview && existing) {
    if (existing.title === texts.title && existing.body === texts.body) return { url: existing.url }
    fail('stale_request')
  }
  if (
    context.existingReview &&
    existing &&
    (existing.title !== context.existingReview.title || existing.body !== context.existingReview.body)
  ) {
    if (existing.title === texts.title && existing.body === texts.body) return { url: existing.url }
    fail('stale_request')
  }
  const gitlab = context.provider === 'gitlab'
  const endpoint = gitlab
    ? `projects/${context.targetProjectId}/merge_requests${existing ? `/${existing.number}` : ''}`
    : `repos/${context.targetRepository}/pulls${existing ? `/${existing.number}` : ''}`
  const fields: Record<string, string | number> = { title: texts.title, [gitlab ? 'description' : 'body']: texts.body }
  if (!existing) {
    if (gitlab) {
      fields.source_branch = context.pushBranch
      fields.target_branch = context.baseBranch
    } else {
      fields.head =
        context.repository === context.targetRepository
          ? context.pushBranch
          : `${context.repository.split('/')[0]}:${context.pushBranch}`
      fields.base = context.baseBranch
    }
  }
  const result = json(await api(run, context, endpoint, existing ? (gitlab ? 'PUT' : 'PATCH') : 'POST', fields))
  const updated = review(context, result, context.targetRepository)
  if (existing && updated.url !== existing.url) fail('stale_request')
  if (updated.title !== texts.title || updated.body !== texts.body || updated.baseBranch !== context.baseBranch) fail()
  context.existingReview = updated
  return { url: updated.url }
}
