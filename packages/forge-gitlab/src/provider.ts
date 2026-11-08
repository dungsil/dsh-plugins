import {
  changeRequestKey,
  type ForgeProvider,
  type ForgeRepository,
  type ChangeRequestRef,
  type ChangeRequestSnapshot,
  type ChangeRequestKey,
  type ForgeFailure,
  type MergeRequest,
  type ForgeActionFailure,
  type ForgeReadiness,
  type ChangeRequestCheck,
} from '@deepseek-ai/dsh-experimental-forge'

export type Run = (
  args: string[],
  signal: AbortSignal,
  input?: string
) => Promise<{ exitCode: number; stdout: string; stderr: string }>
type Row = Record<string, any>
const text = (v: unknown): string => {
  if (typeof v !== 'string') throw new Error('Invalid GitLab response')
  return v
}
const sha = (v: unknown): string => {
  const s = text(v)
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(s)) throw new Error('Invalid commit')
  return s
}
const number = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error('Invalid number')
  return v
}
const segment = (s: string) => /^[\w.-]+$/.test(s) && s !== '.' && s !== '..'
const failure = (code: ForgeFailure['code'] = 'unavailable'): ForgeFailure => ({
  code,
  message: `GitLab request ${code}`,
})
class ApiError extends Error {
  constructor(readonly code: ForgeFailure['code']) {
    super(`GitLab request ${code}`)
  }
}

export class GitLabProvider implements ForgeProvider {
  readonly forge = 'gitlab'
  private readonly hosts: Set<string>
  constructor(
    private readonly run: Run,
    hosts: readonly string[],
    private readonly maxOutputBytes = 8388608
  ) {
    this.hosts = new Set(hosts.map((host) => host.toLowerCase()))
  }
  repositoryFromRemote(raw: string): ForgeRepository | undefined {
    try {
      if (raw.includes('\\') || Array.from(raw).some((character) => character <= ' ' || character === '\u007f')) return
      const url = new URL(raw.includes('://') ? raw : `ssh://${raw.replace(/^([^@/]+@)?([^:/]+):/, '$1$2/')}`)
      if (
        !['https:', 'ssh:'].includes(url.protocol) ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol === 'https:' && url.username)
      )
        return
      const host = url.protocol === 'ssh:' ? url.hostname : url.host
      if (!this.hosts.has(host.toLowerCase())) return
      const parts = url.pathname
        .replace(/^\//, '')
        .replace(/\.git\/?$/, '')
        .replace(/\/$/, '')
        .split('/')
      if (parts.length < 2 || !parts.every(segment)) return
      return { forge: this.forge, host: host.toLowerCase(), owner: parts.slice(0, -1).join('/'), name: parts.at(-1)! }
    } catch {
      return
    }
  }
  changeRequestFromUrl(raw: string): ChangeRequestRef | undefined {
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || raw.includes('\\'))
        return
      const match = /^(.*)\/-\/merge_requests\/([1-9]\d*)\/?$/.exec(url.pathname)
      if (!match || !Number.isSafeInteger(Number(match[2]))) return
      const repository = this.repositoryFromRemote(`https://${url.host}${match[1]}`)
      return repository ? { repository, number: Number(match[2]) } : undefined
    } catch {
      return
    }
  }
  private repo(repository: ForgeRepository): string {
    if (
      repository.forge !== this.forge ||
      !this.hosts.has(repository.host.toLowerCase()) ||
      !repository.owner.split('/').every(segment) ||
      !segment(repository.name)
    )
      throw new Error('Unsupported GitLab repository')
    return `projects/${encodeURIComponent(`${repository.owner}/${repository.name}`)}`
  }
  private endpoint(ref: ChangeRequestRef): string {
    if (!Number.isSafeInteger(ref.number) || ref.number <= 0) throw new Error('Invalid merge request number')
    return `${this.repo(ref.repository)}/merge_requests/${ref.number}`
  }
  changeRequestUrl(ref: ChangeRequestRef): string {
    this.endpoint(ref)
    return `https://${ref.repository.host}/${ref.repository.owner}/${ref.repository.name}/-/merge_requests/${ref.number}`
  }
  private async api(
    repository: ForgeRepository,
    endpoint: string,
    signal: AbortSignal,
    fields?: Row,
    method = 'GET',
    raw = false
  ): Promise<any> {
    this.repo(repository)
    signal.throwIfAborted()
    const args = ['api', '--hostname', repository.host, '--method', method, endpoint]
    if (fields) args.push('--input', '-')
    const result = await this.run(args, signal, fields ? JSON.stringify(fields) : undefined)
    signal.throwIfAborted()
    if (Buffer.byteLength(result.stdout) > this.maxOutputBytes) throw new ApiError('too-large')
    if (result.exitCode !== 0)
      throw new ApiError(
        /401|403|authentication|glab auth login/i.test(result.stderr)
          ? 'unauthenticated'
          : /404/.test(result.stderr)
            ? 'not-found'
            : 'unavailable'
      )
    if (raw) return result.stdout
    try {
      return JSON.parse(result.stdout)
    } catch {
      throw new ApiError('unavailable')
    }
  }
  private async pages(repository: ForgeRepository, endpoint: string, signal: AbortSignal): Promise<Row[]> {
    const rows: Row[] = []
    let bytes = 0
    for (let page = 1; page <= 20; page++) {
      const value = await this.api(
        repository,
        `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
        signal
      )
      if (!Array.isArray(value)) throw new ApiError('unavailable')
      bytes += Buffer.byteLength(JSON.stringify(value))
      if (bytes > this.maxOutputBytes) throw new ApiError('too-large')
      rows.push(...value)
      if (value.length < 100) return rows
    }
    throw new ApiError('too-large')
  }
  private checked(ref: ChangeRequestRef, row: Row): Row {
    if (
      !row ||
      row.iid !== ref.number ||
      row.web_url !== this.changeRequestUrl(ref) ||
      !['opened', 'closed', 'merged'].includes(row.state)
    )
      throw new ApiError('unavailable')
    sha(row.sha)
    return row
  }
  async fetch(refs: readonly ChangeRequestRef[], signal: AbortSignal) {
    const results = new Map<ChangeRequestKey, ChangeRequestSnapshot | ForgeFailure>()
    for (const ref of refs) results.set(changeRequestKey(ref), await this.fetchChecks(ref, signal))
    return results
  }
  async fetchChecks(ref: ChangeRequestRef, signal: AbortSignal): Promise<ChangeRequestSnapshot | ForgeFailure> {
    try {
      const endpoint = this.endpoint(ref)
      const repo = ref.repository
      const row = this.checked(ref, await this.api(repo, endpoint, signal))
      const commit = sha(row.sha)
      const project = await this.api(repo, this.repo(repo), signal)
      const approvals = await this.api(repo, `${endpoint}/approvals`, signal)
      const discussions = await this.pages(repo, `${endpoint}/discussions`, signal)
      const diffs = await this.pages(repo, `${endpoint}/diffs`, signal)
      const statuses = await this.pages(repo, `${this.repo(repo)}/repository/commits/${commit}/statuses`, signal)
      if (row.head_pipeline && row.head_pipeline.sha !== commit) throw new ApiError('unavailable')
      const checks: ChangeRequestCheck[] = statuses.map((status) => {
        if (status.sha !== commit) throw new ApiError('unavailable')
        const states: Record<string, ChangeRequestCheck['state']> = {
          success: 'success',
          failed: 'failure',
          canceled: 'cancelled',
          skipped: 'skipped',
          pending: 'pending',
          running: 'pending',
          created: 'pending',
          manual: 'pending',
          scheduled: 'pending',
          waiting_for_resource: 'pending',
        }
        const state = states[text(status.status)]
        if (!state) throw new ApiError('unavailable')
        let url: string | null = null
        if (status.target_url) {
          const parsed = new URL(text(status.target_url))
          if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
            throw new ApiError('unavailable')
          url = parsed.href
        }
        return {
          name: text(status.name),
          state,
          url,
          workflow: null,
          startedAt: status.started_at ?? null,
          completedAt: status.finished_at ?? null,
        }
      })
      if (row.head_pipeline) {
        const state = row.head_pipeline.status
        checks.push({
          name: 'GitLab pipeline',
          state:
            state === 'success'
              ? 'success'
              : state === 'failed'
                ? 'failure'
                : state === 'canceled'
                  ? 'cancelled'
                  : state === 'skipped'
                    ? 'skipped'
                    : 'pending',
          url: null,
          workflow: null,
          startedAt: null,
          completedAt: null,
        })
      }
      let additions = 0,
        deletions = 0
      for (const diff of diffs) {
        if (diff.too_large || diff.collapsed || diff.diff === undefined) throw new ApiError('too-large')
        for (const line of text(diff.diff).split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) additions++
          if (line.startsWith('-') && !line.startsWith('---')) deletions++
        }
      }
      const reviewDecision = number(approvals.approvals_left) === 0 ? 'approved' : 'review-required'
      const unresolvedThreads = discussions.filter((discussion) => {
        if (!Array.isArray(discussion.notes)) throw new ApiError('unavailable')
        return discussion.notes.some((note: Row) => note.resolvable === true && note.resolved !== true)
      }).length
      const state = row.state === 'opened' ? 'open' : row.state
      const checksRollup = !checks.length
        ? 'none'
        : checks.some((check) => ['failure', 'cancelled'].includes(check.state))
          ? 'failure'
          : checks.some((check) => check.state === 'pending')
            ? 'pending'
            : 'success'
      const methods: ('merge' | 'squash')[] = project.merge_method === 'merge' ? ['merge'] : []
      if (project.squash_option !== 'never' && typeof project.squash_option === 'string') methods.push('squash')
      if (project.squash_option === 'always') methods.splice(0, methods.length, 'squash')
      const current = this.checked(ref, await this.api(repo, endpoint, signal))
      if (current.sha !== commit || current.state !== row.state) throw new ApiError('unavailable')
      return {
        ref,
        url: this.changeRequestUrl(ref),
        title: text(row.title),
        state,
        draft: row.draft === true || row.work_in_progress === true,
        author: row.author?.username ?? null,
        headBranch: text(row.source_branch),
        headSha: commit,
        baseBranch: text(row.target_branch),
        additions,
        deletions,
        mergeability:
          row.has_conflicts === true
            ? 'conflicting'
            : row.detailed_merge_status === 'mergeable'
              ? 'mergeable'
              : 'unknown',
        mergeReady:
          state === 'open' &&
          row.user?.can_merge === true &&
          row.draft === false &&
          row.detailed_merge_status === 'mergeable' &&
          reviewDecision === 'approved' &&
          unresolvedThreads === 0 &&
          methods.length > 0 &&
          ['success', 'none'].includes(checksRollup),
        mergeMethods: methods,
        reviewDecision,
        checks,
        checksRollup,
        checksTruncated: false,
        unresolvedThreads,
        updatedAt: text(row.updated_at),
        closedAt: row.merged_at ?? row.closed_at ?? null,
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason
      return failure(error instanceof ApiError ? error.code : error instanceof RangeError ? 'too-large' : 'unavailable')
    }
  }
  async findByHead(
    repository: ForgeRepository,
    branch: string,
    signal: AbortSignal
  ): Promise<readonly ChangeRequestRef[]> {
    const project = await this.api(repository, this.repo(repository), signal)
    if (branch === project.default_branch) return []
    const rows = await this.pages(
      repository,
      `${this.repo(repository)}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&order_by=created_at&sort=desc`,
      signal
    )
    return rows
      .filter(
        (row) =>
          row.source_branch === branch && row.source_project_id === project.id && row.target_project_id === project.id
      )
      .map((row) => {
        const ref = { repository, number: number(row.iid) }
        this.checked(ref, row)
        return ref
      })
  }
  async readiness(host: string, signal: AbortSignal): Promise<ForgeReadiness> {
    try {
      await this.api({ forge: this.forge, host, owner: 'probe', name: 'probe' }, 'user', signal)
      return { state: 'ready', message: null }
    } catch (error) {
      if (signal.aborted) throw signal.reason
      return {
        state: error instanceof ApiError && error.code === 'unauthenticated' ? 'unauthenticated' : 'unavailable',
        message: 'GitLab CLI is unavailable or not authenticated',
      }
    }
  }
  async markReady(_ref: ChangeRequestRef, signal: AbortSignal): Promise<ForgeActionFailure> {
    signal.throwIfAborted()
    return { code: 'failed', message: 'Use GitLab to mark this merge request ready' }
  }
  async merge(
    ref: ChangeRequestRef,
    request: MergeRequest,
    signal: AbortSignal
  ): Promise<ForgeActionFailure | undefined> {
    try {
      sha(request.headSha)
      const snapshot = await this.fetchChecks(ref, signal)
      if ('code' in snapshot)
        return { code: snapshot.code === 'unauthenticated' ? 'unauthenticated' : 'failed', message: snapshot.message }
      if (snapshot.headSha !== request.headSha) return { code: 'stale', message: 'The merge request head has changed' }
      if (!snapshot.mergeReady || !snapshot.mergeMethods.includes(request.method))
        return { code: 'failed', message: 'The merge request cannot be merged with this method' }
      const result = this.checked(
        ref,
        await this.api(
          ref.repository,
          `${this.endpoint(ref)}/merge`,
          signal,
          { sha: request.headSha, squash: request.method === 'squash' },
          'PUT'
        )
      )
      if (result.state !== 'merged') return { code: 'failed', message: 'The host did not confirm the merge' }
    } catch (error) {
      if (signal.aborted) throw signal.reason
      return {
        code: error instanceof ApiError && error.code === 'unauthenticated' ? 'unauthenticated' : 'failed',
        message: 'Merge was not confirmed; check GitLab before retrying',
      }
    }
  }
  async diff(ref: ChangeRequestRef, signal: AbortSignal): Promise<string | ForgeFailure> {
    try {
      return await this.api(ref.repository, `${this.endpoint(ref)}/raw_diffs`, signal, undefined, 'GET', true)
    } catch (error) {
      if (signal.aborted) throw signal.reason
      return failure(error instanceof ApiError ? error.code : error instanceof RangeError ? 'too-large' : 'unavailable')
    }
  }
  fileUrl(ref: ChangeRequestRef, commit: string, path: string): string {
    this.endpoint(ref)
    sha(commit)
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').some((part) => !part || part === '.' || part === '..') ||
      Array.from(path).some((character) => character < ' ' || character === '\u007f')
    )
      throw new Error('Invalid file path')
    return `https://${ref.repository.host}/${ref.repository.owner}/${ref.repository.name}/-/blob/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`
  }
  async fileText(
    ref: ChangeRequestRef,
    commit: string,
    path: string,
    signal: AbortSignal
  ): Promise<string | ForgeFailure> {
    try {
      this.fileUrl(ref, commit, path)
      return await this.api(
        ref.repository,
        `${this.repo(ref.repository)}/repository/files/${encodeURIComponent(path)}/raw?ref=${sha(commit)}`,
        signal,
        undefined,
        'GET',
        true
      )
    } catch (error) {
      if (signal.aborted) throw signal.reason
      return failure(error instanceof ApiError ? error.code : error instanceof RangeError ? 'too-large' : 'unavailable')
    }
  }
}
