import {
  changeRequestKey,
  type ForgeProvider,
  type ForgeRepository,
  type ChangeRequestRef,
  type ChangeRequestSnapshot,
  type ForgeFailure,
  type ForgeActionFailure,
  type MergeRequest,
  type ChangeRequestCheck,
  type ChangeRequestKey,
} from '@deepseek-ai/dsh-experimental-forge'
import { TeaError, type TeaRunner } from './runner.js'

const segment = (value: string) => /^[A-Za-z0-9_.-]+$/.test(value) && value !== '.' && value !== '..'
const commitPattern = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/
const unsafeUrl = (raw: string) =>
  raw.includes('\\') ||
  Array.from(raw).some((character) => character <= ' ' || character === '\u007f') ||
  /(?:^|\/)\.{1,2}(?:\/|$)|%2e|%2f|%5c/i.test(raw)
const encodedPath = (path: string) => {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path
      .split('/')
      .some(
        (part) =>
          !part ||
          part === '.' ||
          part === '..' ||
          Array.from(part).some((character) => character < ' ' || character === '\u007f')
      )
  )
    throw new Error('Invalid file path')
  return path.split('/').map(encodeURIComponent).join('/')
}
class Failure extends Error {
  constructor(
    readonly code: ForgeFailure['code'],
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}
function responseMessage(stdout: string, status: number): string {
  let message = ''
  try {
    const body = JSON.parse(stdout)
    if (body && typeof body.message === 'string') message = body.message
  } catch {}
  const detail = Array.from(message.slice(0, 2048), (character) =>
    character < ' ' || character === '\u007f' ? ' ' : character
  )
    .join('')
    .trim()
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:gh[pousr]_|github_pat_|glpat-)[\w-]+/gi, '[redacted]')
  const prefix = Number.isInteger(status) ? `HTTP ${status}` : 'tea API request failed'
  return detail ? `${prefix}: ${detail}` : prefix
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Failure('unavailable', 'Invalid API response')
  return value as Record<string, any>
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Failure('unavailable', 'Invalid API response')
  return value
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Failure('unavailable', 'Invalid API count')
  return value as number
}
function timestamp(value: unknown): string {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result))) throw new Failure('unavailable', 'Invalid API timestamp')
  return result
}
export class GiteaProvider implements ForgeProvider {
  readonly hosts: Set<string>
  constructor(
    readonly run: TeaRunner,
    hosts: readonly string[],
    readonly maxOutputBytes: number,
    readonly forge: 'gitea' | 'forgejo' = 'gitea'
  ) {
    if (!hosts.length) throw new Error('hosts must list at least one host')
    if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new Error('Invalid output limit')
    this.hosts = new Set(
      hosts.map((host) => {
        const url = new URL(`https://${host}`)
        if (
          url.host !== host.toLowerCase() ||
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash
        )
          throw new Error('Invalid forge host')
        return url.host
      })
    )
  }
  repositoryFromRemote(raw: string): ForgeRepository | undefined {
    try {
      if (unsafeUrl(raw)) return
      const url = new URL(raw.includes('://') ? raw : `ssh://${raw.replace(/^([^@/]+@)?([^:/]+):/, '$1$2/')}`)
      if (!['https:', 'ssh:'].includes(url.protocol) || url.password || url.search || url.hash) return
      if (url.protocol === 'https:' && url.username) return
      const host = url.protocol === 'ssh:' ? url.hostname : url.host
      const parts = url.pathname
        .replace(/^\//, '')
        .replace(/\/$/, '')
        .replace(/\.git$/, '')
        .split('/')
      if (!this.hosts.has(host) || parts.length !== 2 || !parts.every(segment)) return
      return { forge: this.forge, host, owner: parts[0]!, name: parts[1]! }
    } catch {
      return
    }
  }
  changeRequestFromUrl(raw: string): ChangeRequestRef | undefined {
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || unsafeUrl(raw)) return
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pulls\/([1-9]\d*)\/?$/)
      if (
        !match ||
        !segment(match[1]!) ||
        !segment(match[2]!) ||
        !this.hosts.has(url.host) ||
        !Number.isSafeInteger(Number(match[3]))
      )
        return
      return {
        repository: { forge: this.forge, host: url.host, owner: match[1]!, name: match[2]! },
        number: Number(match[3]),
      }
    } catch {
      return
    }
  }
  private check(repository: ForgeRepository) {
    if (
      repository.forge !== this.forge ||
      !this.hosts.has(repository.host) ||
      !segment(repository.owner) ||
      !segment(repository.name)
    )
      throw new Failure('unavailable', 'Repository is not served by this provider')
    return `repos/${repository.owner}/${repository.name}`
  }
  private target(ref: ChangeRequestRef) {
    const base = this.check(ref.repository)
    if (!Number.isSafeInteger(ref.number) || ref.number <= 0) throw new Failure('unavailable', 'Invalid request number')
    return `${base}/pulls/${ref.number}`
  }
  changeRequestUrl(ref: ChangeRequestRef) {
    this.target(ref)
    return `https://${ref.repository.host}/${ref.repository.owner}/${ref.repository.name}/pulls/${ref.number}`
  }
  private async api(
    host: string,
    endpoint: string,
    signal: AbortSignal,
    method = 'GET',
    body?: unknown
  ): Promise<string> {
    signal.throwIfAborted()
    if (!this.hosts.has(host)) throw new Failure('unavailable', 'Host is not configured')
    const logins = await this.run(['login', 'list', '--output', 'json'], signal)
    if (Buffer.byteLength(logins.stdout) + Buffer.byteLength(logins.stderr) > this.maxOutputBytes)
      throw new Failure('too-large', 'tea login list exceeds maxOutputBytes')
    if (logins.exitCode !== 0) throw new Failure('unauthenticated', 'tea login list failed')
    let list: unknown
    try {
      list = JSON.parse(logins.stdout)
    } catch {
      throw new Failure('unavailable', 'Invalid tea login response')
    }
    if (!Array.isArray(list)) throw new Failure('unavailable', 'Invalid tea login response')
    const matches = list.filter((entry) => {
      try {
        const url = new URL(object(entry).url)
        return url.href === `https://${host}/` && !url.username && !url.password
      } catch {
        return false
      }
    })
    if (
      matches.length !== 1 ||
      typeof matches[0].name !== 'string' ||
      !matches[0].name ||
      matches[0].name.startsWith('-')
    )
      throw new Failure('unauthenticated', 'Configure exactly one tea login for this HTTPS host')
    const result = await this.run(
      [
        'api',
        '--login',
        matches[0].name,
        '--include',
        '--output',
        '-',
        ...(body === undefined
          ? []
          : [
              '--method',
              method,
              ...Object.entries(object(body)).flatMap(([key, value]) => [
                typeof value === 'string' ? '-f' : '-F',
                `${key}=${value}`,
              ]),
            ]),
        `https://${host}/api/v1/${endpoint}`,
      ],
      signal
    )
    signal.throwIfAborted()
    if (Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > this.maxOutputBytes)
      throw new Failure('too-large', 'API response exceeds maxOutputBytes')
    const statuses = [...result.stderr.matchAll(/^HTTP\/[\d.]+ (\d{3})\b/gm)]
    const status = Number(statuses.at(-1)?.[1])
    if (result.exitCode !== 0 || !Number.isInteger(status) || status < 200 || status >= 300)
      throw new Failure(
        status === 401 ? 'unauthenticated' : status === 404 ? 'not-found' : 'unavailable',
        responseMessage(result.stdout, status),
        status
      )
    return result.stdout
  }
  private async json(host: string, endpoint: string, signal: AbortSignal) {
    try {
      return JSON.parse(await this.api(host, endpoint, signal))
    } catch (error) {
      if (error instanceof SyntaxError) throw new Failure('unavailable', 'Invalid JSON response')
      throw error
    }
  }
  private async pages(host: string, endpoint: string, signal: AbortSignal): Promise<any[]> {
    const rows: any[] = []
    let bytes = 0
    for (let page = 1; page <= 20; page++) {
      const raw = await this.api(host, `${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=50&page=${page}`, signal)
      bytes += Buffer.byteLength(raw)
      if (bytes > this.maxOutputBytes) throw new Failure('too-large', 'Pagination exceeds maxOutputBytes')
      let data: unknown
      try {
        data = JSON.parse(raw)
      } catch {
        throw new Failure('unavailable', 'Invalid page response')
      }
      if (data === null) return rows
      if (!Array.isArray(data)) throw new Failure('unavailable', 'Invalid page response')
      if (!data.length) return rows
      rows.push(...data)
    }
    throw new Failure('too-large', 'Pagination exceeds 20 pages')
  }
  private failure(error: unknown, signal: AbortSignal): ForgeFailure {
    signal.throwIfAborted()
    return {
      code: error instanceof Failure || error instanceof TeaError ? error.code : 'unavailable',
      message: error instanceof Failure || error instanceof TeaError ? error.message : 'Forge request failed',
    }
  }
  private async snapshot(ref: ChangeRequestRef, signal: AbortSignal): Promise<ChangeRequestSnapshot> {
    const base = this.target(ref)
    const row = object(await this.json(ref.repository.host, base, signal))
    if (
      row.number !== ref.number ||
      row.html_url !== this.changeRequestUrl(ref) ||
      !['open', 'closed'].includes(row.state) ||
      typeof row.merged !== 'boolean'
    )
      throw new Failure('unavailable', 'Invalid pull request identity')
    const head = object(row.head),
      target = object(row.base)
    const sha = text(head.sha)
    if (!commitPattern.test(sha)) throw new Failure('unavailable', 'Invalid head commit')
    const checks: ChangeRequestCheck[] = (
      await this.pages(ref.repository.host, `${this.check(ref.repository)}/statuses/${sha}`, signal)
    ).map((item) => {
      const status = object(item)
      const states: Record<string, ChangeRequestCheck['state'] | undefined> = {
        pending: 'pending',
        success: 'success',
        failure: 'failure',
        error: 'failure',
      }
      const state = states[text(status.state)]
      if (!state) throw new Failure('unavailable', 'Invalid check state')
      let url: string | null = null
      if (status.target_url) {
        const parsed = new URL(text(status.target_url))
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
          throw new Failure('unavailable', 'Invalid check URL')
        url = parsed.href
      }
      return { name: text(status.context), state, url, workflow: null, startedAt: null, completedAt: null }
    })
    const draft = row.draft === true || /^\s*(?:\[WIP\]|WIP:|Draft:)/i.test(row.title)
    return {
      ref,
      url: this.changeRequestUrl(ref),
      title: text(row.title),
      state: row.merged ? 'merged' : row.state,
      draft,
      author: row.user?.login == null ? null : text(row.user.login),
      headBranch: text(head.ref),
      headSha: sha,
      baseBranch: text(target.ref),
      additions: count(row.additions),
      deletions: count(row.deletions),
      mergeability: row.mergeable === true ? 'mergeable' : row.mergeable === false ? 'conflicting' : 'unknown',
      mergeReady: row.state === 'open' && !row.merged && !draft && row.mergeable !== false,
      mergeMethods: ['merge', 'squash', 'rebase'],
      reviewDecision: 'none',
      checks,
      checksRollup: !checks.length
        ? 'none'
        : checks.some((check) => check.state === 'failure')
          ? 'failure'
          : checks.some((check) => check.state === 'pending')
            ? 'pending'
            : 'success',
      checksTruncated: false,
      unresolvedThreads: 0,
      updatedAt: timestamp(row.updated_at),
      closedAt: row.closed_at == null ? null : timestamp(row.closed_at),
    }
  }
  async fetch(refs: readonly ChangeRequestRef[], signal: AbortSignal) {
    const results = new Map<ChangeRequestKey, ChangeRequestSnapshot | ForgeFailure>()
    for (const ref of refs) {
      signal.throwIfAborted()
      try {
        results.set(changeRequestKey(ref), await this.snapshot(ref, signal))
      } catch (error) {
        results.set(changeRequestKey(ref), this.failure(error, signal))
      }
    }
    return results
  }
  async fetchChecks(ref: ChangeRequestRef, signal: AbortSignal) {
    try {
      return await this.snapshot(ref, signal)
    } catch (error) {
      return this.failure(error, signal)
    }
  }
  async readiness(host: string, signal: AbortSignal) {
    try {
      object(await this.json(host, 'user', signal))
      return { state: 'ready' as const, message: null }
    } catch (error) {
      const failure = this.failure(error, signal)
      return {
        state: failure.code === 'unauthenticated' ? ('unauthenticated' as const) : ('unavailable' as const),
        message: failure.message,
      }
    }
  }
  async findByHead(repository: ForgeRepository, branch: string, signal: AbortSignal) {
    const base = this.check(repository)
    const repo = object(await this.json(repository.host, base, signal))
    if (repo.default_branch === branch) return []
    const rows = await this.pages(repository.host, `${base}/pulls?state=open&sort=recentupdate`, signal)
    return rows
      .filter(
        (row) =>
          row.head?.ref === branch &&
          row.head?.repo?.full_name === `${repository.owner}/${repository.name}` &&
          row.base?.repo?.full_name === `${repository.owner}/${repository.name}` &&
          Number.isSafeInteger(row.number) &&
          row.number > 0
      )
      .map((row) => ({ repository, number: row.number }))
  }
  async markReady(ref: ChangeRequestRef, signal: AbortSignal): Promise<ForgeActionFailure | undefined> {
    signal.throwIfAborted()
    try {
      this.target(ref)
    } catch (error) {
      return { code: 'failed', message: this.failure(error, signal).message }
    }
    return {
      code: 'failed',
      message: 'This host has no supported atomic draft-ready operation; mark ready on the original page',
    }
  }
  async merge(
    ref: ChangeRequestRef,
    request: MergeRequest,
    signal: AbortSignal
  ): Promise<ForgeActionFailure | undefined> {
    try {
      const base = this.target(ref)
      if (!commitPattern.test(request.headSha) || !['merge', 'squash', 'rebase'].includes(request.method))
        return { code: 'failed', message: 'Invalid merge request' }
      const row = object(await this.json(ref.repository.host, base, signal))
      if (row.head?.sha !== request.headSha) return { code: 'stale', message: 'Head commit changed' }
      if (
        row.state !== 'open' ||
        row.merged ||
        row.draft ||
        row.mergeable === false ||
        /^\s*(?:\[WIP\]|WIP:|Draft:)/i.test(row.title)
      )
        return { code: 'failed', message: 'Pull request is not ready to merge' }
      await this.api(ref.repository.host, `${base}/merge`, signal, 'POST', {
        Do: request.method,
        head_commit_id: request.headSha,
        delete_branch_after_merge: false,
        merge_when_checks_succeed: false,
      })
      return undefined
    } catch (error) {
      const failure = this.failure(error, signal)
      return {
        code:
          failure.code === 'unauthenticated'
            ? 'unauthenticated'
            : error instanceof Failure &&
                error.status === 409 &&
                /(?:head|sha|commit).*(?:match|chang|differ)/i.test(error.message)
              ? 'stale'
              : 'failed',
        message: failure.message,
      }
    }
  }
  async diff(ref: ChangeRequestRef, signal: AbortSignal) {
    try {
      return await this.api(ref.repository.host, `${this.target(ref)}.diff`, signal)
    } catch (error) {
      return this.failure(error, signal)
    }
  }
  async fileText(ref: ChangeRequestRef, commit: string, path: string, signal: AbortSignal) {
    try {
      const base = this.check(ref.repository)
      if (!commitPattern.test(commit)) throw new Failure('unavailable', 'Invalid commit')
      return await this.api(ref.repository.host, `${base}/raw/${encodedPath(path)}?ref=${commit}`, signal)
    } catch (error) {
      return this.failure(error, signal)
    }
  }
  fileUrl(ref: ChangeRequestRef, commit: string, path: string) {
    this.check(ref.repository)
    if (!commitPattern.test(commit)) throw new Error('Invalid commit')
    return `https://${ref.repository.host}/${ref.repository.owner}/${ref.repository.name}/src/commit/${commit}/${encodedPath(path)}`
  }
}
