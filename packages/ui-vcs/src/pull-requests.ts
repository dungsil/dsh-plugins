import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-working-directory'
import {
  actionMethod,
  channel,
  method,
  type RequestAction,
  type RequestItem,
  type RequestView,
} from './pull-requests-protocol.js'

export const name = 'dungsil-vcs-pull-requests'
export const inject = ['connection', 'sessionController', 'workingDirectory', 'subprocess', 'sandbox', 'sandboxPolicy']
export const Config = z.object({ provider: z.union(['auto', 'github', 'gitlab']).default('auto') })
export interface Config {
  provider: 'auto' | 'github' | 'gitlab'
}

function safeUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_response')
  if (!value) return ''
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_response')
  return value
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid_response')
  return value
}

function actionInput(value: unknown): RequestAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_payload')
  const input = value as RequestAction
  if (
    Object.keys(input).some(
      (key) => !['sessionId', 'requestUrl', 'headSha', 'action', 'body', 'strategy'].includes(key)
    ) ||
    typeof input.sessionId !== 'string' ||
    !input.sessionId ||
    input.sessionId.length > 256 ||
    typeof input.requestUrl !== 'string' ||
    input.requestUrl.length > 4096 ||
    !safeUrl(input.requestUrl) ||
    typeof input.headSha !== 'string' ||
    !/^[a-fA-F0-9]{40,64}$/.test(input.headSha) ||
    !['comment', 'approve', 'request_changes', 'merge'].includes(input.action) ||
    (input.body !== undefined &&
      (typeof input.body !== 'string' ||
        new TextEncoder().encode(input.body).length > 60_000 ||
        input.body.includes('\0'))) ||
    (['comment', 'request_changes'].includes(input.action) && !input.body?.trim()) ||
    (input.strategy !== undefined &&
      (input.action !== 'merge' || !['merge', 'squash', 'rebase'].includes(input.strategy))) ||
    (input.action === 'merge' && input.body !== undefined)
  )
    throw new Error('invalid_payload')
  return input
}

export function apply(ctx: Context, config: Config) {
  const lifetime = new AbortController()
  const actionsInFlight = new Set<string>()
  ctx.effect(() => () => lifetime.abort())

  const list = async (
    agent: Agent,
    signal: AbortSignal,
    action?: RequestAction
  ): Promise<RequestView | { completed: true }> => {
    const cwd = ctx.workingDirectory.get(agent.session)
    const run = async (executable: string, args: string[], failure = 'command_failed', allowed = [0], trim = true) => {
      let resolved: string
      try {
        resolved = await ctx.subprocess.resolveExecutable(executable, undefined, signal)
      } catch {
        throw new Error(executable === 'git' ? 'repository' : 'cli_missing')
      }
      const argv = [resolved, ...args]
      const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
      const command =
        policy.mode === 'danger-full-access'
          ? argv
          : (await ctx.sandbox.confine(argv, { ...policy, mode: policy.mode }, signal)).argv
      const child = ctx.subprocess.spawn({
        argv: command,
        cwd,
        signal,
        graceMs: 1000,
        env: {
          GIT_DIR: undefined,
          GIT_WORK_TREE: undefined,
          GIT_COMMON_DIR: undefined,
          GIT_CONFIG: undefined,
          GIT_CONFIG_PARAMETERS: undefined,
          GIT_CONFIG_COUNT: undefined,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GH_REPO: undefined,
          GH_HOST: undefined,
          GITLAB_REPO: undefined,
          GITLAB_HOST: undefined,
          GH_PROMPT_DISABLED: '1',
          GLAB_CHECK_UPDATE: 'false',
          NO_COLOR: '1',
        },
        stdio: { stdin: 'ignore', stdout: { maxBytes: 2_097_152 }, stderr: { maxBytes: 16384 } },
      })
      try {
        const outcome = await child.done
        signal.throwIfAborted()
        const output = child.collected!.stdout!.readFrom(0)
        if (outcome.exitCode === null || !allowed.includes(outcome.exitCode) || output.lossy) throw new Error(failure)
        return trim ? output.text.trim() : output.text
      } finally {
        child.terminate()
        await child.waitForExit()
      }
    }
    const git = (args: string[], allowed?: number[]) =>
      run('git', ['-c', 'core.fsmonitor=false', ...args], 'repository', allowed)
    const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])
    const tracked = branch ? await git(['config', '--get', `branch.${branch}.remote`], [0, 1]) : ''
    const remote = tracked && tracked !== '.' ? tracked : 'origin'
    const raw = await git(['remote', 'get-url', '--', remote])
    // Parse HTTPS, ssh:// and SCP-style remotes, but never pass userinfo or arbitrary Git transports to a CLI.
    let url: URL
    try {
      url = new URL(raw.includes('://') ? raw : `ssh://${raw.replace(/^([^@/]+@)?([^:/]+):/, '$1$2/')}`)
    } catch {
      throw new Error('unsupported')
    }
    if (!['https:', 'http:', 'ssh:'].includes(url.protocol)) throw new Error('unsupported')
    const repository = url.pathname
      .replace(/^\//, '')
      .replace(/\.git\/?$/, '')
      .replace(/\/$/, '')
    if (
      !url.hostname ||
      !repository.includes('/') ||
      repository.split('/').some((part) => !/^[\w.-]+$/.test(part) || part === '.' || part === '..')
    )
      throw new Error('unsupported')
    const provider =
      config.provider === 'auto'
        ? url.hostname === 'github.com'
          ? 'github'
          : url.hostname === 'gitlab.com'
            ? 'gitlab'
            : undefined
        : config.provider
    if (!provider) throw new Error('unsupported')
    const host = url.hostname + (url.protocol !== 'ssh:' && url.port ? `:${url.port}` : '')
    const origin = `${url.protocol === 'http:' ? 'http' : 'https'}://${host}`
    const view = { provider, repository: `${host}/${repository}`, branch, request: null }
    // Detached HEAD has no branch to associate; never fall back to a repository-wide request.
    if (!branch) return view
    const mergeRef = tracked ? await git(['config', '--get', `branch.${branch}.merge`], [0, 1]) : ''
    const pushedBranch = mergeRef.startsWith('refs/heads/') ? mergeRef.slice(11) : branch
    const output =
      provider === 'github'
        ? await run('gh', [
            'pr',
            'status',
            // --repo disables gh's currentBranch lookup. Only discovery uses cwd;
            // every subsequent read/write is pinned to the validated repository/URL.
            '--json',
            'number,title,url,author,headRefName,baseRefName,isDraft,state,headRepository',
            '--jq',
            '.currentBranch',
          ])
        : await run('glab', [
            'mr',
            'list',
            '--repo',
            `${origin}/${repository}`,
            '--source-branch',
            pushedBranch,
            '--all',
            '--output',
            'json',
            '--per-page',
            '1',
            '--page',
            '1',
            '--order',
            'updated_at',
            '--sort',
            'desc',
          ])
    try {
      const data = JSON.parse(output || 'null')
      if (provider === 'gitlab' && (!Array.isArray(data) || data.length > 1)) throw new Error()
      const row = provider === 'github' ? data : data[0]
      if (row == null) return view
      const state = row.state === 'opened' ? 'open' : row.state?.toLowerCase()
      if (!['open', 'closed', 'merged'].includes(state)) throw new Error()
      const item: RequestItem = {
        number: provider === 'github' ? row.number : row.iid,
        title: row.title,
        url: provider === 'github' ? row.url : row.web_url,
        author: (provider === 'github' ? row.author?.login : row.author?.username) ?? '',
        source: provider === 'github' ? row.headRefName : row.source_branch,
        target: provider === 'github' ? row.baseRefName : row.target_branch,
        draft: provider === 'github' ? row.isDraft : (row.draft ?? row.work_in_progress ?? false),
        state,
        body: '',
        headSha: '',
        mergeable: '',
        reviewDecision: '',
        checks: [],
        files: [],
        diff: '',
        diffTruncated: false,
        comments: [],
        reviews: [],
      }
      if (
        !Number.isSafeInteger(item.number) ||
        item.number <= 0 ||
        !['title', 'url', 'author', 'source', 'target'].every(
          (key) => typeof item[key as keyof typeof item] === 'string'
        ) ||
        typeof item.draft !== 'boolean'
      )
        throw new Error()
      const link = new URL(item.url)
      if (
        link.origin !== origin ||
        link.username ||
        link.password ||
        link.search ||
        link.hash ||
        !(provider === 'github'
          ? /^\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(link.pathname) && link.pathname.endsWith(`/pull/${item.number}`)
          : link.pathname === `/${repository}/-/merge_requests/${item.number}`)
      )
        throw new Error()
      // gh resolves the current branch's fork/upstream association itself. Verify its source,
      // not its base repository: a fork's PR may legitimately live in a different repository.
      if (
        item.source !== pushedBranch ||
        (provider === 'github' && row.headRepository?.nameWithOwner?.toLowerCase() !== repository.toLowerCase()) ||
        (provider === 'gitlab' &&
          (!Number.isSafeInteger(row.source_project_id) ||
            row.source_project_id <= 0 ||
            row.source_project_id !== row.target_project_id))
      )
        return view
      // Resolve detail and mutation targets explicitly, including upstream fork PRs.
      const targetRepo =
        provider === 'github'
          ? `${origin}/${link.pathname.split('/').slice(1, 3).join('/')}`
          : `${origin}/${repository}`
      const number = String(item.number)
      const api = (suffix: string) =>
        run('glab', [
          'api',
          '--hostname',
          host,
          `projects/${encodeURIComponent(repository)}/merge_requests/${number}${suffix}`,
        ])
      const pages = async (endpoint: string): Promise<any[]> => {
        const rows: any[] = []
        for (let page = 1; page <= 10; page++) {
          const data = JSON.parse(
            await run('glab', [
              'api',
              '--hostname',
              host,
              `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
            ])
          )
          if (!Array.isArray(data)) throw new Error()
          rows.push(...data)
          if (data.length < 100) return rows
        }
        // Do not present an incomplete CI/comment/file list as complete.
        throw new Error()
      }
      const endpoint = `projects/${encodeURIComponent(repository)}/merge_requests/${number}`
      const section = async (read: () => void | Promise<void>) => {
        try {
          await read()
        } catch {
          item.detailsError = true
        }
      }
      try {
        if (provider === 'github') {
          const detail = JSON.parse(
            await run('gh', [
              'pr',
              'view',
              item.url,
              '--repo',
              targetRepo,
              '--json',
              'number,url,state,isDraft,headRefName,headRepository,body,headRefOid,mergeable,reviewDecision,statusCheckRollup,changedFiles,files,comments,reviews',
            ])
          )
          if (
            detail.number !== item.number ||
            detail.url !== item.url ||
            detail.headRefName !== item.source ||
            detail.headRepository?.nameWithOwner?.toLowerCase() !== repository.toLowerCase()
          )
            throw new Error()
          item.headSha = string(detail.headRefOid)
          if (!['OPEN', 'CLOSED', 'MERGED'].includes(detail.state) || typeof detail.isDraft !== 'boolean')
            throw new Error()
          item.state = detail.state.toLowerCase()
          item.draft = detail.isDraft
          await section(() => {
            item.body = string(detail.body)
          })
          await section(() => {
            item.mergeable = string(detail.mergeable)
          })
          await section(() => {
            item.reviewDecision = string(detail.reviewDecision)
          })
          await section(() => {
            item.checks = (detail.statusCheckRollup === null ? [] : detail.statusCheckRollup).map(
              (check: Record<string, unknown>) => ({
                name: string(check.name ?? check.context),
                status: string(check.conclusion || check.status || check.state),
                url: safeUrl(check.detailsUrl ?? check.targetUrl ?? ''),
              })
            )
            if (item.checks.length >= 100) throw new Error()
          })
          await section(() => {
            item.files = detail.files.map((file: { path: unknown; additions: number; deletions: number }) => ({
              path: string(file.path),
              additions: file.additions,
              deletions: file.deletions,
            }))
            if (detail.changedFiles !== item.files.length) throw new Error()
          })
          await section(() => {
            item.comments = detail.comments.map((comment: Record<string, any>) => ({
              author: string(comment.author?.login ?? ''),
              body: string(comment.body),
              url: safeUrl(comment.url),
            }))
            if (item.comments.length >= 100) throw new Error()
          })
          await section(() => {
            item.reviews = detail.reviews.map((review: Record<string, any>) => ({
              author: string(review.author?.login ?? ''),
              body: string(review.body),
              state: string(review.state),
            }))
            if (item.reviews.length >= 100) throw new Error()
          })
          await section(async () => {
            item.diff = await run(
              'gh',
              ['pr', 'diff', item.url, '--repo', targetRepo, '--color', 'never'],
              'command_failed',
              [0],
              false
            )
          })
        } else {
          const detail = JSON.parse(await run('glab', ['mr', 'view', number, '--repo', targetRepo, '--output', 'json']))
          if (
            detail.iid !== item.number ||
            detail.web_url !== item.url ||
            detail.source_branch !== item.source ||
            detail.source_project_id !== row.source_project_id ||
            detail.target_project_id !== row.target_project_id
          )
            throw new Error()
          item.headSha = string(detail.sha ?? detail.diff_refs?.head_sha)
          if (!['opened', 'closed', 'merged'].includes(detail.state)) throw new Error()
          item.state = detail.state === 'opened' ? 'open' : detail.state
          item.draft = detail.draft ?? detail.work_in_progress ?? false
          if (typeof item.draft !== 'boolean') throw new Error()
          await section(() => {
            item.body = string(detail.description ?? '')
          })
          await section(() => {
            item.mergeable = string(detail.detailed_merge_status ?? detail.merge_status)
          })
          await section(async () => {
            const approvals = JSON.parse(await api('/approvals'))
            if (typeof approvals.approved !== 'boolean') throw new Error()
            item.reviewDecision = approvals.approved
              ? 'APPROVED'
              : approvals.approvals_required === 0 && approvals.approvals_left === 0
                ? ''
                : 'REVIEW_REQUIRED'
            item.reviews = approvals.approved_by.map((entry: Record<string, any>) => ({
              author: string(entry.user?.username),
              body: '',
              state: 'APPROVED',
            }))
          })
          await section(async () => {
            let pipeline
            if (
              detail.head_pipeline?.ref === `refs/merge-requests/${number}/merge` &&
              detail.head_pipeline.sha !== item.headSha
            ) {
              // Merged-result pipelines run a synthetic merge commit, not the
              // source SHA. Trust only this MR snapshot's head pipeline and
              // verify its commit contains the current source head as a parent.
              pipeline = detail.head_pipeline
              if (pipeline.project_id !== row.target_project_id || !/^[a-fA-F0-9]{40,64}$/.test(string(pipeline.sha)))
                throw new Error()
              const commit = JSON.parse(
                await run('glab', [
                  'api',
                  '--hostname',
                  host,
                  `projects/${encodeURIComponent(repository)}/repository/commits/${pipeline.sha}`,
                ])
              )
              if (
                commit.id !== pipeline.sha ||
                !Array.isArray(commit.parent_ids) ||
                !commit.parent_ids.includes(item.headSha)
              )
                throw new Error()
            } else {
              // Older failed runs must not override a successful source rerun.
              const pipelines = await pages(`${endpoint}/pipelines`)
              const matching = pipelines.filter((entry) => entry.sha === item.headSha)
              if (matching.some((entry) => !Number.isSafeInteger(entry.id) || entry.id <= 0)) throw new Error()
              pipeline = matching.sort((a, b) => b.id - a.id)[0]
              if (!pipeline && pipelines.length) throw new Error()
            }
            if (!pipeline) return
            if (!Number.isSafeInteger(pipeline.id) || pipeline.id <= 0) throw new Error()
            item.checks.push({
              name: `Pipeline #${pipeline.id}`,
              status: string(pipeline.status),
              url: safeUrl(pipeline.web_url ?? ''),
            })
            const jobs = await pages(`projects/${encodeURIComponent(repository)}/pipelines/${pipeline.id}/jobs`)
            item.checks.push(
              ...jobs.map((job) => ({
                name: string(job.name),
                status: string(job.status),
                url: safeUrl(job.web_url),
              }))
            )
          })
          await section(async () => {
            const notes = await pages(`${endpoint}/notes?sort=asc`)
            item.comments = notes
              .filter((note) => !note.system)
              .map((note) => {
                if (!Number.isSafeInteger(note.id) || note.id <= 0) throw new Error()
                return {
                  author: string(note.author?.username ?? ''),
                  body: string(note.body),
                  url: `${item.url}#note_${note.id}`,
                }
              })
          })
          await section(async () => {
            const diffs = await pages(`${endpoint}/diffs`)
            item.files = diffs.map((file) => {
              if (file.too_large || file.collapsed || typeof file.diff !== 'string') throw new Error()
              const lines = file.diff.split('\n')
              return {
                path: string(file.new_path),
                additions: lines.filter((line: string) => line.startsWith('+')).length,
                deletions: lines.filter((line: string) => line.startsWith('-')).length,
              }
            })
            item.diff = diffs
              .map((file) => `diff --git a/${string(file.old_path)} b/${string(file.new_path)}\n${file.diff}`)
              .join('\n')
          })
        }
        if (
          !/^[a-fA-F0-9]{40,64}$/.test(item.headSha) ||
          item.files.some(
            (file) =>
              !Number.isSafeInteger(file.additions) ||
              file.additions < 0 ||
              !Number.isSafeInteger(file.deletions) ||
              file.deletions < 0
          )
        )
          throw new Error()
        // Diff endpoints follow a moving MR/PR head. Never show an old SHA next to
        // a newer diff or authorize a review of that inconsistent snapshot.
        const latest = JSON.parse(
          await (provider === 'github'
            ? run('gh', ['pr', 'view', item.url, '--repo', targetRepo, '--json', 'headRefOid'])
            : run('glab', ['mr', 'view', number, '--repo', targetRepo, '--output', 'json']))
        )
        if ((provider === 'github' ? latest.headRefOid : (latest.sha ?? latest.diff_refs?.head_sha)) !== item.headSha)
          throw new Error()
      } catch {
        item.detailsError = true
      }
      item.diffTruncated = item.diff.length > 120_000
      item.diff = item.diff.slice(0, 120_000)
      if (action) {
        if (item.url !== action.requestUrl || item.headSha !== action.headSha) throw new Error('stale_request')
        if (item.detailsError || item.state !== 'open') throw new Error('action_failed')
        if (['approve', 'merge'].includes(action.action) && (item.draft || !item.diff.trim()))
          throw new Error('action_failed')
        if (action.action === 'approve' && item.diffTruncated) throw new Error('action_failed')
        if (
          action.action === 'merge' &&
          (item.checks.some(
            (check) => !['success', 'passed', 'neutral', 'skipped'].includes(check.status.toLowerCase())
          ) ||
            !['', 'APPROVED'].includes(item.reviewDecision) ||
            !(provider === 'github'
              ? item.mergeable === 'MERGEABLE'
              : ['mergeable', 'can_be_merged'].includes(item.mergeable)))
        )
          throw new Error('action_failed')
        if ((await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])) !== branch)
          throw new Error('stale_request')
        if (provider === 'github') {
          if (action.action !== 'merge') {
            const base = [
              'api',
              '--hostname',
              host,
              `repos/${link.pathname.split('/').slice(1, 3).join('/')}/pulls/${number}/reviews`,
              '--method',
              'POST',
              '-f',
              `event=${action.action === 'approve' ? 'APPROVE' : action.action === 'comment' ? 'COMMENT' : 'REQUEST_CHANGES'}`,
              '-f',
              `commit_id=${action.headSha}`,
            ]
            if (action.body !== undefined) base.push('-f', `body=${action.body}`)
            await run('gh', base, 'action_failed')
          } else {
            // REST merge is immediate and SHA-conditional: unlike `gh pr merge`,
            // it cannot silently enqueue/enable auto-merge for a merge queue.
            const result = JSON.parse(
              await run(
                'gh',
                [
                  'api',
                  '--hostname',
                  host,
                  `repos/${link.pathname.split('/').slice(1, 3).join('/')}/pulls/${number}/merge`,
                  '--method',
                  'PUT',
                  '-f',
                  `sha=${action.headSha}`,
                  '-f',
                  `merge_method=${action.strategy ?? 'merge'}`,
                ],
                'action_failed'
              )
            )
            if (result.merged !== true) throw new Error('action_failed')
          }
        } else {
          // GitLab approvals do not accept a review body. Never silently discard
          // text or perform an unrequested second mutation to post it as a note.
          if (
            action.action === 'request_changes' ||
            (action.action === 'merge' && action.strategy === 'rebase') ||
            (action.action === 'approve' && action.body?.trim())
          )
            throw new Error('unsupported_action')
          const base = ['mr', action.action === 'comment' ? 'note' : action.action, number, '--repo', targetRepo]
          if (action.action === 'comment') base.push('--message', action.body!)
          else base.push('--sha', action.headSha)
          if (action.action === 'merge')
            base.push('--auto-merge=false', '--yes', `--squash=${action.strategy === 'squash'}`)
          await run('glab', base, 'action_failed')
        }
        return { completed: true }
      }
      return { ...view, request: item }
    } catch (error) {
      if (error instanceof Error && ['stale_request', 'action_failed', 'unsupported_action'].includes(error.message))
        throw error
      throw new Error(action ? 'action_failed' : 'invalid_response')
    }
  }

  // Exact fetch routes are owner-only, unlike RPC listeners shared with Session viewers.
  for (const route of [method, actionMethod])
    ctx.effect(() =>
      ctx.connection.fetch.register({
        path: `${channel}/${route}`,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          let body
          try {
            body = clientRequestSchema.safeParse(await request.json())
          } catch {
            return new Response('Invalid request', { status: 400 })
          }
          if (!body.success || body.data.method !== route) return new Response('Invalid request', { status: 400 })
          const reply = (result: unknown) =>
            Response.json(
              { type: 'server-response', rpcId: body.data.rpcId, result },
              { headers: { 'Cache-Control': 'no-store' } }
            )
          const input = body.data.payload as { sessionId?: unknown } | null
          if (!input || typeof input.sessionId !== 'string' || !input.sessionId)
            return reply({ ok: false, error: { code: 'unavailable', message: 'Invalid session', details: {} } })
          let inFlight: string | undefined
          try {
            let action: RequestAction | undefined
            if (route === actionMethod) {
              try {
                action = actionInput(body.data.payload)
              } catch {
                throw new Error('invalid_payload')
              }
              if (actionsInFlight.has(action.sessionId)) throw new Error('action_failed')
              actionsInFlight.add(action.sessionId)
              inFlight = action.sessionId
            }
            const resolved = await ctx.sessionController.resolveAgent(SessionId(input.sessionId))
            if ('error' in resolved) throw new Error('unavailable')
            const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(20_000)])
            const value = await list(resolved.agent, signal, action)
            if (action && !('completed' in value)) throw new Error('stale_request')
            return reply({ ok: true, value })
          } catch (error) {
            const code =
              error instanceof Error &&
              [
                'repository',
                'unsupported',
                'cli_missing',
                'command_failed',
                'invalid_response',
                'invalid_payload',
                'stale_request',
                'action_failed',
                'unsupported_action',
              ].includes(error.message)
                ? error.message
                : 'unavailable'
            return reply({
              ok: false,
              error: {
                code,
                message:
                  route === actionMethod
                    ? 'Request action failed; refresh before trying again'
                    : 'Request lookup failed',
                details: {},
              },
            })
          } finally {
            if (inFlight) actionsInFlight.delete(inFlight)
          }
        },
      })
    )
}
