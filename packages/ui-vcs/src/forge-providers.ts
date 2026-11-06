import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import {
  changeRequestKey,
  type ChangeRequestRef,
  type ChangeRequestSnapshot,
  type ForgeFailure,
  type ForgeProvider,
  type ForgeRepository,
} from '@deepseek-ai/dsh-experimental-forge'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config } from './settings.js'

export const name = 'dungsil-vcs-forge-providers'
export const inject = ['forge', 'subprocess']
type Family = 'gitlab' | 'gitea' | 'forgejo'
export type Api = (
  host: string,
  path: string,
  signal: AbortSignal,
  options?: { method?: string; fields?: Record<string, string>; raw?: boolean }
) => Promise<any>
const unavailable: ForgeFailure = { code: 'unavailable', message: 'Provider operation unavailable' }
const segment = (part: string) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..'

/** Additional hosts are deliberately explicit; a configured provider must not claim every URL. */
export function provider(forge: Family, hosts: readonly string[], api: Api): ForgeProvider {
  const repository = (raw: string): ForgeRepository | undefined => {
    try {
      const url = new URL(raw.includes('://') ? raw : `ssh://${raw.replace(/^([^@/]+@)?([^:/]+):/, '$1$2/')}`)
      const host = (url.protocol === 'ssh:' ? url.hostname : url.host).toLowerCase()
      if (!['https:', 'http:', 'ssh:'].includes(url.protocol) || !hosts.includes(host)) return
      const parts = url.pathname
        .replace(/^\//, '')
        .replace(/\.git\/?$/, '')
        .replace(/\/$/, '')
        .split('/')
      if (parts.length < 2 || !parts.every(segment) || (forge !== 'gitlab' && parts.length !== 2)) return
      return { forge, host, owner: parts.slice(0, -1).join('/'), name: parts.at(-1)! }
    } catch {
      return
    }
  }
  const checked = (ref: ChangeRequestRef) => {
    const r = ref.repository
    if (
      r.forge !== forge ||
      !hosts.includes(r.host) ||
      !r.owner.split('/').every(segment) ||
      !segment(r.name) ||
      !Number.isSafeInteger(ref.number) ||
      ref.number <= 0
    )
      throw new Error('invalid_ref')
    return r
  }
  const path = (ref: ChangeRequestRef) => {
    const r = checked(ref)
    return forge === 'gitlab'
      ? `projects/${encodeURIComponent(`${r.owner}/${r.name}`)}/merge_requests/${ref.number}`
      : `repos/${r.owner}/${r.name}/pulls/${ref.number}`
  }
  const urlOf = (ref: ChangeRequestRef) => {
    const r = checked(ref)
    return `https://${r.host}/${r.owner}/${r.name}/${forge === 'gitlab' ? '-/merge_requests' : 'pulls'}/${ref.number}`
  }
  const pages = async (host: string, path: string, signal: AbortSignal): Promise<any[]> => {
    const result: any[] = []
    for (let page = 1; page <= 10; page++) {
      const rows = await api(
        host,
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&limit=100&page=${page}`,
        signal
      )
      if (!Array.isArray(rows)) throw new Error('invalid_response')
      result.push(...rows)
      if (rows.length < 100) return result
    }
    throw new Error('incomplete_response')
  }
  const safeUrl = (value: unknown): string | null => {
    if (!value) return null
    if (typeof value !== 'string') throw new Error('invalid_url')
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_url')
    return value
  }
  const checkState = (state: string): ChangeRequestSnapshot['checks'][number]['state'] => {
    if (['success', 'passed'].includes(state)) return 'success'
    if (['failure', 'failed', 'error'].includes(state)) return 'failure'
    if (['cancelled', 'canceled'].includes(state)) return 'cancelled'
    if (state === 'skipped') return 'skipped'
    if (state === 'manual') return 'pending'
    if (
      ['pending', 'running', 'created', 'waiting_for_resource', 'preparing', 'scheduled', 'in_progress'].includes(state)
    )
      return 'pending'
    throw new Error('unknown_check_state')
  }
  const snapshot = async (ref: ChangeRequestRef, signal: AbortSignal): Promise<ChangeRequestSnapshot> => {
    const r = checked(ref)
    const row = await api(r.host, path(ref), signal)
    if (
      (forge === 'gitlab' ? row.iid : row.number) !== ref.number ||
      (forge === 'gitlab' ? row.web_url : row.html_url) !== urlOf(ref)
    )
      throw new Error('invalid_identity')
    const headSha = forge === 'gitlab' ? row.sha : row.head?.sha
    if (typeof headSha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(headSha) || typeof row.title !== 'string')
      throw new Error('invalid_response')
    const headBranch = forge === 'gitlab' ? row.source_branch : row.head?.ref
    const baseBranch = forge === 'gitlab' ? row.target_branch : row.base?.ref
    if (typeof headBranch !== 'string' || typeof baseBranch !== 'string') throw new Error('invalid_response')
    const merged = row.merged === true || row.state === 'merged'
    const state = merged ? 'merged' : ['open', 'opened'].includes(row.state) ? 'open' : 'closed'
    const repoPath =
      forge === 'gitlab' ? `projects/${encodeURIComponent(`${r.owner}/${r.name}`)}` : `repos/${r.owner}/${r.name}`
    let reviewDecision: ChangeRequestSnapshot['reviewDecision']
    let mergeability: ChangeRequestSnapshot['mergeability'] = 'unknown'
    let checks: ChangeRequestSnapshot['checks'] = []
    const check = (name: string, status: string, url: unknown) => ({
      name,
      state: checkState(status),
      url: safeUrl(url),
      workflow: null,
      startedAt: null,
      completedAt: null,
    })
    if (forge === 'gitlab') {
      const approvals = await api(r.host, `${path(ref)}/approvals`, signal)
      if (typeof approvals.approved !== 'boolean') throw new Error('invalid_approvals')
      reviewDecision = approvals.approved
        ? 'approved'
        : approvals.approvals_required === 0 && approvals.approvals_left === 0
          ? 'none'
          : 'review-required'
      const status = row.detailed_merge_status ?? row.merge_status
      mergeability = ['mergeable', 'can_be_merged'].includes(status)
        ? 'mergeable'
        : ['conflict', 'cannot_be_merged'].includes(status)
          ? 'conflicting'
          : 'unknown'
      let pipeline = row.head_pipeline
      if (pipeline?.ref === `refs/merge-requests/${ref.number}/merge` && pipeline.sha !== headSha) {
        const commit = await api(r.host, `${repoPath}/repository/commits/${pipeline.sha}`, signal)
        if (
          pipeline.project_id !== row.target_project_id ||
          commit.id !== pipeline.sha ||
          !commit.parent_ids?.includes(headSha)
        )
          throw new Error('stale_pipeline')
      } else {
        const pipelines = await pages(r.host, `${path(ref)}/pipelines`, signal)
        pipeline = pipelines.filter((p) => p.sha === headSha).sort((a, b) => b.id - a.id)[0]
        if (!pipeline && pipelines.length) throw new Error('stale_pipeline')
      }
      if (pipeline) {
        if (!Number.isSafeInteger(pipeline.id) || pipeline.id <= 0) throw new Error('invalid_pipeline')
        const jobs = await pages(r.host, `${repoPath}/pipelines/${pipeline.id}/jobs`, signal)
        checks = [
          check(`Pipeline #${pipeline.id}`, pipeline.status, pipeline.web_url),
          ...jobs.map((job) => check(job.name, job.status, job.web_url)),
        ]
      }
    } else {
      const protection = await api(r.host, `${repoPath}/branches/${encodeURIComponent(baseBranch)}`, signal)
      if (
        typeof protection.user_can_merge !== 'boolean' ||
        typeof protection.enable_status_check !== 'boolean' ||
        !Number.isSafeInteger(protection.required_approvals) ||
        protection.required_approvals < 0
      )
        throw new Error('invalid_protection')
      mergeability =
        row.mergeable === false
          ? 'conflicting'
          : row.mergeable === true && protection.user_can_merge
            ? 'mergeable'
            : 'unknown'
      const votes = new Map<string, any>()
      for (const review of await pages(r.host, `${path(ref)}/reviews`, signal)) {
        if (!Number.isSafeInteger(review.id) || typeof review.user?.login !== 'string')
          throw new Error('invalid_review')
        if (!['APPROVED', 'REQUEST_CHANGES'].includes(review.state)) continue
        if (!votes.has(review.user.login) || votes.get(review.user.login).id < review.id)
          votes.set(review.user.login, review)
      }
      const active = [...votes.values()].filter((v) => !v.dismissed && !v.stale)
      const count = active.filter(
        (v) => v.state === 'APPROVED' && v.commit_id === headSha && v.official && v.user.login !== row.user?.login
      ).length
      reviewDecision = active.some((v) => v.state === 'REQUEST_CHANGES')
        ? 'changes-requested'
        : count < protection.required_approvals
          ? 'review-required'
          : protection.required_approvals
            ? 'approved'
            : 'none'
      const statuses = new Map<string, any>()
      for (const status of await pages(r.host, `${repoPath}/statuses/${headSha}?sort=highestindex`, signal)) {
        if (!Number.isSafeInteger(status.id) || typeof status.context !== 'string') throw new Error('invalid_status')
        if (!statuses.has(status.context) || statuses.get(status.context).id < status.id)
          statuses.set(status.context, status)
      }
      checks = [...statuses.values()].map((s) => check(s.context, s.status, s.target_url))
      if (protection.enable_status_check) {
        const required = protection.status_check_contexts
        if (!Array.isArray(required) || !required.every((v) => typeof v === 'string')) throw new Error('invalid_checks')
        checks = [
          ...checks,
          ...required.filter((name) => !statuses.has(name)).map((name) => check(name, 'pending', null)),
        ]
      }
    }
    const checksRollup = checks.some((c) => ['failure', 'cancelled'].includes(c.state))
      ? 'failure'
      : checks.some((c) => c.state === 'pending')
        ? 'pending'
        : checks.length
          ? 'success'
          : 'none'
    const draft = row.draft === true || row.work_in_progress === true
    const repo = await api(r.host, repoPath, signal)
    const mergeMethods: ChangeRequestSnapshot['mergeMethods'] =
      forge === 'gitlab'
        ? ['merge', 'squash']
        : [
            ...(repo.allow_merge_commits === true ? ['merge' as const] : []),
            ...(repo.allow_squash_merge === true ? ['squash' as const] : []),
            ...(repo.allow_rebase === true ? ['rebase' as const] : []),
          ]
    return {
      ref,
      url: urlOf(ref),
      title: row.title,
      state,
      draft: row.draft === true || row.work_in_progress === true,
      author: row.author?.username ?? row.user?.login ?? null,
      headBranch,
      headSha,
      baseBranch,
      additions: Number(row.additions) || 0,
      deletions: Number(row.deletions) || 0,
      mergeability,
      mergeReady:
        state === 'open' &&
        !draft &&
        mergeability === 'mergeable' &&
        ['none', 'approved'].includes(reviewDecision) &&
        ['none', 'success'].includes(checksRollup),
      mergeMethods,
      reviewDecision,
      checks,
      checksRollup,
      checksTruncated: false,
      unresolvedThreads: 0,
      updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
      closedAt: row.merged_at ?? row.closed_at ?? null,
    }
  }
  return {
    forge,
    repositoryFromRemote: repository,
    changeRequestFromUrl(raw) {
      try {
        const url = new URL(raw)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
        const match = /^(.*)\/(?:-\/merge_requests|pulls)\/([1-9]\d*)(?:\/.*)?$/.exec(url.pathname)
        if (!match || (forge === 'gitlab') !== url.pathname.includes('/-/merge_requests/')) return
        const r = repository(`${url.origin}${match[1]}`)
        const number = Number(match[2])
        return r && Number.isSafeInteger(number) ? { repository: r, number } : undefined
      } catch {
        return
      }
    },
    changeRequestUrl: urlOf,
    async fetch(refs, signal) {
      const result = new Map()
      for (const ref of refs) {
        try {
          result.set(changeRequestKey(ref), await snapshot(ref, signal))
        } catch {
          signal.throwIfAborted()
          result.set(changeRequestKey(ref), unavailable)
        }
      }
      return result
    },
    fetchChecks: snapshot,
    async findByHead(r, branch, signal) {
      checked({ repository: r, number: 1 })
      const base =
        forge === 'gitlab' ? `projects/${encodeURIComponent(`${r.owner}/${r.name}`)}` : `repos/${r.owner}/${r.name}`
      const project = await api(r.host, base, signal)
      if (project.default_branch === branch) return []
      const rows = await api(
        r.host,
        forge === 'gitlab'
          ? `${base}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&per_page=100`
          : `${base}/pulls?state=open&limit=100`,
        signal
      )
      if (!Array.isArray(rows)) throw new Error('invalid_response')
      return rows
        .filter((row) =>
          forge === 'gitlab'
            ? row.source_branch === branch && row.source_project_id === row.target_project_id
            : row.head?.ref === branch && row.head?.repo?.id === row.base?.repo?.id
        )
        .map((row) => ({ repository: r, number: forge === 'gitlab' ? row.iid : row.number }))
        .filter((ref) => Number.isSafeInteger(ref.number) && ref.number > 0)
    },
    async readiness(host, signal) {
      if (!hosts.includes(host)) return { state: 'unavailable', message: 'Host not configured' }
      try {
        await api(host, 'user', signal)
        return { state: 'ready', message: null }
      } catch {
        signal.throwIfAborted()
        return { state: 'unavailable', message: 'CLI authentication or host unavailable' }
      }
    },
    async markReady(ref, signal) {
      try {
        const row = await api(checked(ref).host, path(ref), signal)
        if (forge !== 'gitlab')
          return { code: 'failed', message: 'This host does not expose mark-ready through this adapter' }
        await api(ref.repository.host, path(ref), signal, {
          method: 'PUT',
          fields: { title: row.title.replace(/^(?:draft|wip):\s*/i, '') },
        })
      } catch {
        signal.throwIfAborted()
        return { code: 'failed', message: 'Mark-ready outcome could not be confirmed' }
      }
    },
    async merge(ref, request, signal) {
      try {
        const latest = await snapshot(ref, signal)
        if (latest.headSha !== request.headSha) return { code: 'stale', message: 'The change request head moved' }
        if (!latest.mergeReady || !latest.mergeMethods.includes(request.method))
          return { code: 'failed', message: 'Merge requirements are not met' }
        await api(checked(ref).host, `${path(ref)}/merge`, signal, {
          method: forge === 'gitlab' ? 'PUT' : 'POST',
          fields:
            forge === 'gitlab'
              ? { sha: request.headSha, squash: String(request.method === 'squash') }
              : { head_commit_id: request.headSha, Do: request.method, force_merge: 'false' },
        })
      } catch {
        signal.throwIfAborted()
        return { code: 'failed', message: 'Merge outcome could not be confirmed; check the host before retrying' }
      }
    },
    async submitReview(ref, request, signal) {
      try {
        const latest = await snapshot(ref, signal)
        if (latest.headSha !== request.headSha)
          return { ok: false, code: 'stale', message: 'The change request head moved' }
        if (
          request.kind !== 'review' ||
          request.comments.length ||
          (forge === 'gitlab' && request.event === 'request-changes')
        )
          return { ok: false, code: 'unsupported', message: 'This review form is not supported by the host adapter' }
        if (forge === 'gitlab') {
          if (request.event === 'approve') {
            if (request.body.trim())
              return { ok: false, code: 'unsupported', message: 'Approval with body is not supported' }
            await api(ref.repository.host, `${path(ref)}/approve`, signal, {
              method: 'POST',
              fields: { sha: request.headSha },
            })
          } else
            await api(ref.repository.host, `${path(ref)}/notes`, signal, {
              method: 'POST',
              fields: { body: request.body },
            })
        } else
          await api(ref.repository.host, `${path(ref)}/reviews`, signal, {
            method: 'POST',
            fields: {
              commit_id: request.headSha,
              body: request.body,
              event:
                request.event === 'approve'
                  ? 'APPROVED'
                  : request.event === 'request-changes'
                    ? 'REQUEST_CHANGES'
                    : 'COMMENT',
            },
          })
        return { ok: true, url: urlOf(ref) }
      } catch {
        signal.throwIfAborted()
        return {
          ok: false,
          code: 'unknown',
          message: 'Review outcome could not be confirmed; check the host before retrying',
        }
      }
    },
    async diff(ref, signal) {
      const r = checked(ref)
      if (forge !== 'gitlab') return api(r.host, `${path(ref)}.diff`, signal, { raw: true })
      const rows = await api(r.host, `${path(ref)}/diffs?per_page=100`, signal)
      if (!Array.isArray(rows) || rows.length >= 100 || rows.some((row) => row.collapsed || row.too_large))
        return { code: 'too-large', message: 'Incomplete diff' }
      return rows
        .map(
          (row) =>
            `diff --git a/${row.old_path} b/${row.new_path}\n--- ${row.new_file ? '/dev/null' : `a/${row.old_path}`}\n+++ ${row.deleted_file ? '/dev/null' : `b/${row.new_path}`}\n${row.diff}`
        )
        .join('\n')
    },
    async fileText(ref, commit, file, signal) {
      const r = checked(ref)
      if (!/^[a-f0-9]{40,64}$/i.test(commit) || file.split('/').some((p) => !p || p === '.' || p === '..'))
        return unavailable
      const base =
        forge === 'gitlab'
          ? `projects/${encodeURIComponent(`${r.owner}/${r.name}`)}/repository/files/${encodeURIComponent(file)}`
          : `repos/${r.owner}/${r.name}/contents/${file.split('/').map(encodeURIComponent).join('/')}`
      const row = await api(r.host, `${base}?ref=${commit}`, signal)
      if (row.encoding !== 'base64' || typeof row.content !== 'string' || row.content.length > 2_000_000)
        return unavailable
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(row.content, 'base64'))
    },
    fileUrl(ref, commit, path) {
      const r = checked(ref)
      if (!/^[a-f0-9]{40,64}$/i.test(commit) || path.split('/').some((p) => !p || p === '.' || p === '..'))
        throw new Error('invalid_path')
      return `https://${r.host}/${r.owner}/${r.name}/${forge === 'gitlab' ? '-/blob' : 'src/commit'}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`
    },
  }
}

export function apply(ctx: Context, config: Config) {
  const hosts: Record<Family, string[]> = { gitlab: ['gitlab.com'], gitea: ['gitea.com'], forgejo: ['codeberg.org'] }
  if (config.provider !== 'auto' && config.provider !== 'github') {
    for (const host of config.providerHosts ?? []) hosts[config.provider].push(host)
  }
  for (const forge of ['gitlab', 'gitea', 'forgejo'] as const) {
    const api = hostApi(ctx, forge)
    ctx.forge.register(provider(forge, hosts[forge], api))
  }
}

export function hostApi(ctx: Context, forge: Family | 'github'): Api {
  return async (host, path, signal, options = {}) => {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
    const cli = forge === 'github' ? 'gh' : forge === 'gitlab' ? 'glab' : 'tea'
    // Like forge-github, provider reads run on the host, not in a Session's
    // working directory. Only the CLI's credential store is used.
    const env = Object.fromEntries(Object.keys(process.env).map((key) => [key, undefined]))
    Object.assign(env, scrubbedParentEnv(), {
      GH_PROMPT_DISABLED: '1',
      GLAB_CHECK_UPDATE: 'false',
      NO_COLOR: '1',
      GH_REPO: undefined,
      GH_HOST: undefined,
      GITLAB_REPO: undefined,
      GITLAB_HOST: undefined,
      TEA_REPO: undefined,
      TEA_LOGIN: undefined,
    })
    const execute = async (args: string[], http: boolean, raw = false) => {
      const child = ctx.subprocess.spawn({
        argv: [await ctx.subprocess.resolveExecutable(cli, undefined, bounded), ...args],
        cwd: homedir(),
        env,
        signal: bounded,
        graceMs: 1000,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 2_097_152 }, stderr: { maxBytes: 16384 } },
      })
      try {
        const outcome = await child.done
        bounded.throwIfAborted()
        const output = child.collected!.stdout!.readFrom(0)
        const error = child.collected!.stderr!.readFrom(0)
        if (
          outcome.exitCode !== 0 ||
          output.lossy ||
          (http && (error.lossy || !/^HTTP\/[\d.]+ 2\d\d\b/m.test(error.text)))
        )
          throw new Error('provider_failed')
        return raw ? output.text : output.text.trim() ? JSON.parse(output.text) : null
      } finally {
        child.terminate()
        await child.waitForExit()
      }
    }
    const flags = [
      ...(options.method ? ['--method', options.method] : []),
      ...Object.entries(options.fields ?? {}).flatMap(([key, value]) => [
        ['squash', 'force_merge'].includes(key) ? '-F' : '-f',
        `${key}=${value}`,
      ]),
    ]
    if (forge === 'gitlab' || forge === 'github')
      return execute(['api', '--hostname', host, ...flags, path], false, options.raw)
    const logins = await execute(['login', 'list', '--output', 'json'], false)
    if (!Array.isArray(logins)) throw new Error('invalid_logins')
    const matches = logins.filter((login) => {
      try {
        const url = new URL(login.url)
        return (
          url.protocol === 'https:' &&
          url.host === host &&
          url.pathname === '/' &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        )
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
      throw new Error('ambiguous_login')
    return execute(
      ['api', '--login', matches[0].name, '--include', '--output', '-', ...flags, `/api/v1/${path}`],
      true,
      options.raw
    )
  }
}
