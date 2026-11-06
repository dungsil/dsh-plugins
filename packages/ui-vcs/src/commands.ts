import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { discoverPush, inspectForge, pushBranch, updateReview } from './forge-commands.js'
import { generateTexts } from './requests.js'
import { channel, executeMethod, validCommitSettings, type GitActionRequest, type GitActionResult } from './protocol.js'
import type { Config } from './settings.js'

export const name = 'dungsil-vcs-commands'
export const inject = [
  'connection',
  'sessionController',
  'workingDirectory',
  'subprocess',
  'sandbox',
  'sandboxPolicy',
  'fs',
  'llm',
]

function actionInput(value: unknown): GitActionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
  const input = value as GitActionRequest
  if (
    Object.keys(input).some((key) => !['sessionId', 'cwd', 'operation', 'requestId'].includes(key)) ||
    typeof input.sessionId !== 'string' ||
    !input.sessionId ||
    input.sessionId.length > 256 ||
    typeof input.cwd !== 'string' ||
    !input.cwd ||
    input.cwd.length > 4096 ||
    /[\0\r\n]/.test(input.cwd) ||
    !['commit', 'push', 'pr'].includes(input.operation) ||
    typeof input.requestId !== 'string' ||
    !/^[a-zA-Z0-9-]{16,100}$/.test(input.requestId)
  )
    throw new Error('invalid')
  return input
}

export function apply(ctx: Context, config: Config) {
  const lifetime = new AbortController()
  const pending = new Set<string>()
  const repositories = new Set<string>()
  const completed = new Map<string, { input: string; result: Result }>()
  ctx.effect(() => () => lifetime.abort(), 'ui-vcs: cancel commands')
  type Progress = { stage: 'inspect' | 'generate' | 'commit' | 'push' | 'pr'; committed: boolean; pushed: boolean }
  const failure = (code: string, details: Partial<Progress> = {}) => ({
    ok: false as const,
    error: {
      code,
      message: 'Git operation could not be confirmed. Check the repository before retrying.',
      details,
    },
  })
  type Result = { ok: true; value: GitActionResult } | ReturnType<typeof failure>

  const execute = async (
    agent: Agent,
    input: GitActionRequest,
    signal: AbortSignal,
    progress: Progress
  ): Promise<GitActionResult> => {
    const settings = {
      authorName: config.authorName ?? '',
      authorEmail: config.authorEmail ?? '',
      noSign: config.noSign ?? false,
    }
    if (!validCommitSettings(settings)) throw new Error('invalid')
    const policy = ctx.sandboxPolicy.resolve({ session: agent.session })
    if (policy.mode === 'read-only') throw new Error('read_only')
    const cwd = await ctx.workingDirectory.ensure(agent, signal)
    if (cwd !== input.cwd) throw new Error('conflict')
    let executionCwd = cwd
    const run = async (
      executable: string,
      args: string[],
      options: { allowed?: number[]; maxBytes?: number; stdin?: string } = {}
    ) => {
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(executable === 'git' ? 60_000 : 90_000)])
      let resolved: string
      try {
        resolved = await ctx.subprocess.resolveExecutable(executable, undefined, bounded)
      } catch {
        bounded.throwIfAborted()
        throw new Error('cli_missing')
      }
      const argv = [resolved, ...args]
      const currentPolicy = ctx.sandboxPolicy.resolve({ session: agent.session })
      if (currentPolicy.mode === 'read-only') throw new Error('read_only')
      const command =
        currentPolicy.mode === 'danger-full-access'
          ? argv
          : (await ctx.sandbox.confine(argv, { ...currentPolicy, mode: currentPolicy.mode }, bounded)).argv
      const child = ctx.subprocess.spawn({
        argv: command,
        cwd: executionCwd,
        signal: bounded,
        graceMs: 1000,
        env: {
          ...Object.fromEntries(
            Object.keys(process.env)
              .filter((key) => key.startsWith('GIT_'))
              .map((key) => [key, undefined])
          ),
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_NO_LAZY_FETCH: '1',
          GH_REPO: undefined,
          GH_HOST: undefined,
          GITLAB_REPO: undefined,
          GITLAB_HOST: undefined,
          TEA_REPO: undefined,
          TEA_LOGIN: undefined,
          ...(executable === 'tea'
            ? {
                GH_TOKEN: undefined,
                GITEA_TOKEN: undefined,
                GITEA_INSTANCE_URL: undefined,
                GITEA_INSTANCE_SSH_HOST: undefined,
                GITEA_INSTANCE_INSECURE: undefined,
              }
            : {}),
        },
        stdio: { stdin: 'ignore', stdout: { maxBytes: options.maxBytes ?? 524_288 }, stderr: { maxBytes: 16_384 } },
      })
      try {
        const outcome = await child.done
        bounded.throwIfAborted()
        const output = child.collected!.stdout!.readFrom(0)
        if (outcome.exitCode === null || !(options.allowed ?? [0]).includes(outcome.exitCode) || output.lossy)
          throw new Error('command_failed')
        if (executable === 'tea' && args[0] === 'api') {
          const headers = child.collected!.stderr!.readFrom(0)
          if (headers.lossy || !/^HTTP\/[\d.]+ 2\d\d\b/m.test(headers.text)) throw new Error('command_failed')
        }
        return output.text
      } catch (error) {
        if (bounded.aborted && bounded.reason?.name === 'TimeoutError') throw new Error('timeout')
        throw error
      } finally {
        child.terminate()
        await child.waitForExit()
      }
    }
    const git = (args: string[], allowed?: number[]) =>
      run('git', ['--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], { allowed })
    const readGit = (args: string[], allowed?: number[]) => git(['-c', 'core.hooksPath=/dev/null', ...args], allowed)
    const root = (await readGit(['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '')
    executionCwd = root
    const common = (await readGit(['rev-parse', '--path-format=absolute', '--git-common-dir'])).replace(/\r?\n$/, '')
    if (repositories.has(common)) throw new Error('busy')
    repositories.add(common)
    try {
      const branch = (await readGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])).trim()
      const sensitive = (path: string) =>
        /(^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]*)?|id_rsa|id_ed25519|credentials(?:\.[^/]*)?)$/i.test(
          path
        ) || /\.(?:pem|p12|pfx|key)$/i.test(path)
      const read = async (path: string, optional = false) => {
        if (sensitive(path)) throw new Error('sensitive_file')
        const target = await ctx.fs.resolve(path, { cwd: root, signal })
        const rootTarget = await ctx.fs.resolve(root, { signal })
        if (!ctx.fs.contains(rootTarget, target)) throw new Error('invalid_plan')
        if (!(await ctx.fs.stat(target, signal))) {
          if (optional) return ''
          throw new Error('conflict')
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(await ctx.fs.readBytes(target, signal, 131_072))
      }
      const snapshot = async () => {
        if (ctx.workingDirectory.get(agent.session) !== cwd) throw new Error('conflict')
        const head = (await readGit(['rev-parse', '--verify', 'HEAD'])).trim()
        const status = await readGit([
          '-c',
          'status.renames=false',
          'status',
          '--porcelain=v1',
          '-z',
          '--untracked-files=all',
        ])
        const entries = status
          .split('\0')
          .filter(Boolean)
          .map((record) => ({ status: record.slice(0, 2), path: record.slice(3) }))
        if (entries.some((entry) => /U/.test(entry.status) || ['AA', 'DD'].includes(entry.status)))
          throw new Error('conflict')
        if (entries.some((entry) => sensitive(entry.path))) throw new Error('sensitive_file')
        const diff = await readGit(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--binary', 'HEAD', '--'])
        const staged = await readGit([
          'diff',
          '--cached',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--binary',
          '--',
        ])
        const untracked: Record<string, string> = {}
        for (const entry of entries.filter((entry) => entry.status === '??')) {
          if ((await ctx.fs.lstat(entry.path, { cwd: root }, signal))?.type !== 'file') throw new Error('invalid_plan')
          untracked[entry.path] = await read(entry.path)
        }
        return { head, status, entries, diff, staged, untracked }
      }
      for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
        const path = (await readGit(['rev-parse', '--git-path', marker])).trimEnd()
        if (await ctx.fs.stat(await ctx.fs.resolve(path, { cwd: root, signal }), signal)) throw new Error('conflict')
      }
      const before = await snapshot()
      const forge = input.operation === 'pr' ? await inspectForge(run, config.provider) : undefined
      const push = input.operation === 'push' ? await discoverPush(run) : undefined
      if (push && (push.sourceBranch !== push.baseBranch || push.pushBranch !== push.baseBranch))
        throw new Error('conflict')
      if (forge && !forge.baseRef) throw new Error('missing_base')
      const rules: Record<string, string> = {}
      const instructionPaths = new Set(['AGENTS.md'])
      for (const entry of before.entries) {
        const parts = entry.path.split('/')
        for (let index = 1; index < parts.length; index++)
          instructionPaths.add(parts.slice(0, index).join('/') + '/AGENTS.md')
      }
      for (const path of instructionPaths) {
        const text = await read(path, true)
        if (text) rules[path] = text
      }
      for (const path of [
        '.github/pull_request_template.md',
        '.github/PULL_REQUEST_TEMPLATE.md',
        '.gitlab/merge_request_templates/Default.md',
      ]) {
        const text = await read(path, true)
        if (text) rules[path] = text
      }
      const context = JSON.stringify({
        cwd: root,
        branch,
        ...before,
        rules,
        forge,
        branchDiff: forge
          ? await readGit(['diff', '--no-ext-diff', '--no-textconv', '--binary', `${forge.baseRef}...HEAD`, '--'])
          : undefined,
        recentCommits: await readGit(['log', '-5', '--format=%s%n%b']),
        conversation: agent.session
          .deriveMessages()
          .filter((message) => message.role === 'assistant' || ['user', 'user-rpc'].includes(message.source.kind))
          .flatMap((message) => message.content.filter((block) => block.type === 'text').map((block) => block.text))
          .join('\n')
          .slice(-24_000),
        checks: ['git diff --check; repository commit hooks run during git commit; no other tests run by this action'],
      })
      progress.stage = 'generate'
      const texts = await generateTexts(ctx, agent, input.operation, context, signal).catch((error) => {
        signal.throwIfAborted()
        throw new Error('generation_failed', { cause: error })
      })
      const paths = texts.paths
      if (paths.some((path) => !before.entries.some((entry) => entry.path === path))) throw new Error('invalid_plan')
      if (
        paths.some((path) =>
          before.entries.some(
            (entry) =>
              entry.path === path && entry.status !== '??' && entry.status[0] !== ' ' && entry.status[1] !== ' '
          )
        )
      )
        throw new Error('partial_stage')
      if ((paths.length === 0) !== (texts.commitMessage === '')) throw new Error('invalid_plan')
      if (JSON.stringify(await snapshot()) !== JSON.stringify(before)) throw new Error('conflict')
      if ((await readGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])).trim() !== branch)
        throw new Error('conflict')
      const value: GitActionResult = { operation: input.operation, branch, checks: [] }
      if (paths.length) {
        progress.stage = 'commit'
        await readGit(['diff', '--check', 'HEAD', '--', ...paths])
        value.checks.push('git diff --check')
        const additions = paths.filter((path) =>
          before.entries.some((entry) => entry.path === path && entry.status === '??')
        )
        if (additions.length) await git(['add', '--', ...additions])
        await git([
          'commit',
          ...(settings.authorName ? [`--author=${settings.authorName} <${settings.authorEmail}>`] : []),
          ...(settings.noSign ? ['--no-gpg-sign'] : []),
          '--only',
          '-m',
          texts.commitMessage,
          '--',
          ...paths,
        ])
        progress.committed = true
        value.commit = (await readGit(['rev-parse', '--verify', 'HEAD'])).trim()
        value.checks.push('git commit hooks')
      }
      if (input.operation === 'push' || input.operation === 'pr') {
        progress.stage = 'push'
        await pushBranch(run, input.operation === 'pr' ? forge! : push!)
        progress.pushed = true
      }
      if (input.operation === 'pr') {
        progress.stage = 'pr'
        value.url = (await updateReview(run, forge!, texts)).url
      }
      return value
    } finally {
      repositories.delete(common)
    }
  }

  const handle = async (payload: unknown, signal: AbortSignal): Promise<Result> => {
    let input: GitActionRequest
    try {
      input = actionInput(payload)
    } catch {
      return failure('invalid')
    }
    const key = `${input.sessionId}/${input.requestId}`
    const fingerprint = JSON.stringify(input)
    const cached = completed.get(key)
    if (cached) return cached.input === fingerprint ? cached.result : failure('invalid')
    if (pending.has(input.sessionId)) return failure('busy')
    pending.add(input.sessionId)
    let result: Result
    const progress: Progress = { stage: 'inspect', committed: false, pushed: false }
    try {
      const resolved = await ctx.sessionController.resolveAgent(SessionId(input.sessionId))
      if ('error' in resolved) return failure('session_not_found')
      const { agent } = resolved
      const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(
        (message) => !['working-directory', 'user-approval'].includes(message.source.kind)
      )
      if (agent.status !== 'idle' || queued) return failure('busy')
      result = await agent.runMaintenance(async (maintenanceSignal) => {
        const bounded = AbortSignal.any([signal, maintenanceSignal, lifetime.signal, AbortSignal.timeout(300_000)])
        bounded.throwIfAborted()
        return { ok: true as const, value: await execute(agent, input, bounded, progress) }
      })
    } catch (error) {
      const code = error instanceof Error ? (error.name === 'TimeoutError' ? 'timeout' : error.message) : ''
      // Only fixed codes and confirmed milestones cross the UI boundary, never CLI output or model text.
      result = failure(
        [
          'busy',
          'invalid',
          'conflict',
          'read_only',
          'partial_stage',
          'invalid_plan',
          'missing_base',
          'unsupported',
          'default_branch',
          'detached_head',
          'ambiguous_review',
          'ambiguous_target',
          'stale_request',
          'cli_missing',
          'command_failed',
          'generation_failed',
          'timeout',
          'sensitive_file',
        ].includes(code)
          ? code
          : 'operation_failed',
        { ...progress }
      )
    } finally {
      pending.delete(input.sessionId)
    }
    completed.set(key, { input: fingerprint, result })
    if (completed.size > 100) completed.delete(completed.keys().next().value!)
    return result
  }

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: `${channel}/${executeMethod}`,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          let body
          try {
            body = clientRequestSchema.safeParse(await request.json())
          } catch {
            return new Response('Invalid request', { status: 400 })
          }
          if (!body.success || body.data.method !== executeMethod)
            return new Response('Invalid request', { status: 400 })
          return Response.json(
            {
              type: 'server-response',
              rpcId: body.data.rpcId,
              result: await handle(body.data.payload, request.signal),
            },
            { headers: { 'Cache-Control': 'no-store' } }
          )
        },
      }),
    'ui-vcs: owner-only commands'
  )
}
