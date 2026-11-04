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
import { channel, method, type RequestItem, type RequestView } from './protocol.js'

export const name = 'dungsil-ui-pull-requests'
export const inject = ['connection', 'sessionController', 'workingDirectory', 'subprocess', 'sandbox', 'sandboxPolicy']
export const Config = z.object({ provider: z.union(['auto', 'github', 'gitlab']).default('auto') })
export interface Config {
  provider: 'auto' | 'github' | 'gitlab'
}

export function apply(ctx: Context, config: Config) {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())

  const list = async (agent: Agent, signal: AbortSignal): Promise<RequestView> => {
    const cwd = ctx.workingDirectory.get(agent.session)
    const run = async (executable: string, args: string[], failure = 'command_failed', allowed = [0]) => {
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
        return output.text.trim()
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
        !(provider === 'github'
          ? /^\/[^/]+\/[^/]+\/pull\/\d+$/.test(link.pathname)
          : link.pathname === `/${repository}/-/merge_requests/${item.number}`)
      )
        throw new Error()
      // gh resolves the current branch's fork/upstream association itself. Verify its source,
      // not its base repository: a fork's PR may legitimately live in a different repository.
      if (
        item.source !== pushedBranch ||
        (provider === 'github' && row.headRepository?.nameWithOwner?.toLowerCase() !== repository.toLowerCase()) ||
        (provider === 'gitlab' && row.source_project_id !== row.target_project_id)
      )
        return view
      return { ...view, request: item }
    } catch {
      throw new Error('invalid_response')
    }
  }

  // Exact fetch routes are owner-only, unlike RPC listeners shared with Session viewers.
  ctx.effect(() =>
    ctx.connection.fetch.register({
      path: `${channel}/${method}`,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        let body
        try {
          body = clientRequestSchema.safeParse(await request.json())
        } catch {
          return new Response('Invalid request', { status: 400 })
        }
        if (!body.success || body.data.method !== method) return new Response('Invalid request', { status: 400 })
        const reply = (result: unknown) =>
          Response.json(
            { type: 'server-response', rpcId: body.data.rpcId, result },
            { headers: { 'Cache-Control': 'no-store' } }
          )
        const input = body.data.payload as { sessionId?: unknown } | null
        if (!input || typeof input.sessionId !== 'string' || !input.sessionId)
          return reply({ ok: false, error: { code: 'unavailable', message: 'Invalid session', details: {} } })
        try {
          const resolved = await ctx.sessionController.resolveAgent(SessionId(input.sessionId))
          if ('error' in resolved) throw new Error('unavailable')
          const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(20_000)])
          return reply({ ok: true, value: await list(resolved.agent, signal) })
        } catch (error) {
          const code =
            error instanceof Error &&
            ['repository', 'unsupported', 'cli_missing', 'command_failed', 'invalid_response'].includes(error.message)
              ? error.message
              : 'unavailable'
          return reply({ ok: false, error: { code, message: 'Request lookup failed', details: {} } })
        }
      },
    })
  )
}
