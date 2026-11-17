import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-config-editor'
import { BlockAssembler, ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { TaskDefinition, TaskRegistration } from '@dungsil/dsh-plugin-model-settings/contract'
import { gitProcessEnvironment, parseRpcRequest, rpcResponse } from '@dungsil/dsh-plugin-server'
import { commitMessageInstructions } from '@dungsil/dsh-task-prompts'
import { registerIntegration } from './integration.js'
import { messageInput, normalizeMessage } from './message.js'
import { channel, methods, type ActionErrorCode, type DefaultAction, type MergeMethod } from './protocol.js'

export const name = 'dungsil-ui-forge-chip'
export const inject = [
  'connection',
  'configEditor',
  'llm',
  'agents',
  'sessions',
  'workingDirectory',
  'subprocess',
  'fs',
  'sandbox',
  'sandboxPolicy',
  'forge',
  'forgeSession',
]

export const Config = z.object({
  defaultAction: z.union(['commit', 'push']).default('commit').volatile(),
  integrationMethod: z.union(['merge', 'rebase', 'squash']).default('merge'),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  modelSettings: z.object({
    inherit: z.union(['auxiliary', 'conversation']).default('auxiliary'),
    instructions: z.string(),
  }),
})

export interface Config {
  defaultAction: Volatile<DefaultAction>
  integrationMethod: MergeMethod
  provider?: string
  model?: string
  reasoningEffort?: string
  modelSettings?: { inherit: 'auxiliary' | 'conversation'; instructions?: string }
}

export const modelSettingsDefinition: TaskDefinition = {
  key: 'commit-message',
  label: { en: 'Commit message', ko: '커밋 메시지', zh: '提交信息' },
  description: {
    en: 'Model and instructions that write commit messages for the composer commit chip.',
    ko: '입력창 커밋 칩이 커밋 메시지를 작성할 때 사용하는 모델과 지침입니다.',
    zh: '输入框提交按钮生成提交信息时使用的模型和指令。',
  },
  automaticReasoningLabel: { en: 'Model default', ko: '모델 기본값', zh: '模型默认值' },
  read(config) {
    const local = config.modelSettings as Config['modelSettings']
    return {
      selection:
        typeof config.provider === 'string' && config.provider && typeof config.model === 'string' && config.model
          ? {
              mode: 'model',
              route: { provider: config.provider, model: config.model },
              reasoningEffort: typeof config.reasoningEffort === 'string' ? config.reasoningEffort : null,
            }
          : { mode: local?.inherit === 'conversation' ? 'conversation' : 'auxiliary' },
      instructions: local?.instructions ?? null,
    }
  },
  write(config, settings) {
    const { provider: _provider, model: _model, reasoningEffort: _effort, modelSettings: _settings, ...rest } = config
    return {
      ...rest,
      ...(settings.selection.mode === 'model'
        ? {
            ...settings.selection.route,
            ...(settings.selection.reasoningEffort ? { reasoningEffort: settings.selection.reasoningEffort } : {}),
          }
        : {}),
      modelSettings: {
        inherit: settings.selection.mode === 'conversation' ? 'conversation' : 'auxiliary',
        ...(settings.instructions !== null ? { instructions: settings.instructions } : {}),
      },
    }
  },
  defaultInstructions: () => commitMessageInstructions,
}

type Session = { readonly id: string; requestHeader(): { config?: { provider?: string; model?: string } } | undefined }
type Agent = {
  readonly session: Session
  readonly status: string
  readonly options: { provider?: string; model?: string }
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}
type Repository = { forge: string; host: string; owner: string; name: string }
type Host = {
  agents: { get(id: string): Agent | undefined }
  sessions: { get(id: string): Session | undefined }
  workingDirectory: { get(session: Session): string }
  sandboxPolicy: { resolve(options: { session: Session }): { mode: string } }
  sandbox: { confine(argv: string[], policy: { mode: string }, signal: AbortSignal): Promise<{ argv: string[] }> }
  subprocess: {
    resolveExecutable(name: string, env: Record<string, string> | undefined, signal: AbortSignal): Promise<string>
    spawn(spec: unknown): {
      done: Promise<{ exitCode: number | null }>
      collected: { stdout?: { readFrom(offset: number): { text: string; lossy: boolean } } }
      terminate(): void
      waitForExit(): Promise<void>
    }
  }
  forge: {
    repositoryFromRemote(url: string): Repository | undefined
    findByHead(repository: Repository, branch: string, signal: AbortSignal): Promise<readonly unknown[]>
    changeRequestFromUrl(url: string): { repository: Repository; number: number } | undefined
    changeRequestUrl(ref: unknown): string
  }
  forgeSession: {
    track(session: Session, url: string): void
    discoverBranch(session: Session, remote: string, branch: string): Promise<void>
  }
}

class ActionError extends Error {
  constructor(readonly code: ActionErrorCode) {
    super(code)
  }
}

interface RunOptions {
  /** Run outside the Session sandbox. Only network commands that run no repository hooks use this. */
  unconfined?: boolean
  /** Keep repository hooks, for `git commit` inside the sandbox. */
  hooks?: boolean
  allowed?: number[]
  timeoutMs?: number
  env?: Record<string, string | undefined>
}

/** Pull request CLIs by forge family; other families report `unsupported`. */
const prCommands: Record<string, (branch: string) => { executable: string; args: string[] }> = {
  github: (branch) => ({ executable: 'gh', args: ['pr', 'create', '--fill', '--head', branch] }),
  gitlab: (branch) => ({ executable: 'glab', args: ['mr', 'create', '--fill', '--yes', '--source-branch', branch] }),
}
/** Families whose registry providers read pull requests through tea; tea creates their PRs too. */
const teaForges = new Set(['gitea', 'forgejo'])

/** Like the tea providers, ignore tea and other forge credentials from the environment so the chosen login applies. */
const teaEnvironment = () =>
  gitProcessEnvironment({
    ...Object.fromEntries(
      Object.keys(process.env)
        .filter((key) => /^(?:TEA_|GITEA_|FORGEJO_|GH_|GITHUB_|GLAB_|GITLAB_)/iu.test(key))
        .map((key) => [key, undefined])
    ),
    NO_COLOR: '1',
    CLICOLOR: '0',
    TERM: 'dumb',
    TEA_NO_UPDATE_CHECK: '1',
  })

export function apply(ctx: Context, config: Config) {
  const host = ctx as unknown as Host
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  let registration: TaskRegistration | undefined
  ctx.inject(['dungsilModelSettings'], (child) => {
    const current = child.dungsilModelSettings.register(ctx, modelSettingsDefinition)
    registration = current
    child.effect(() => () => {
      current.dispose()
      if (registration === current) registration = undefined
    })
  })

  const run = async (session: Session, cwd: string, args: string[], signal: AbortSignal, options: RunOptions = {}) => {
    const control = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)])
    const env = options.env ?? gitProcessEnvironment()
    const executable = await host.subprocess.resolveExecutable(args[0]!, undefined, control)
    const command =
      args[0] === 'git'
        ? [
            executable,
            '--no-optional-locks',
            ...(options.hooks ? [] : ['-c', 'core.hooksPath=/dev/null']),
            '-c',
            'core.fsmonitor=false',
            ...args.slice(1),
          ]
        : [executable, ...args.slice(1)]
    const policy = host.sandboxPolicy.resolve({ session })
    const argv =
      options.unconfined || policy.mode === 'danger-full-access'
        ? command
        : (await host.sandbox.confine(command, policy, control)).argv
    control.throwIfAborted()
    const handle = host.subprocess.spawn({
      argv,
      cwd,
      env,
      signal: control,
      graceMs: 1000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 4_194_304 }, stderr: { maxBytes: 65_536 } },
    })
    try {
      const outcome = await handle.done
      control.throwIfAborted()
      const read = handle.collected.stdout?.readFrom(0)
      if (!(options.allowed ?? [0]).includes(outcome.exitCode ?? -1) || !read || read.lossy) throw Error('failed')
      return { text: read.text, exitCode: outcome.exitCode! }
    } finally {
      handle.terminate()
      await handle.waitForExit()
    }
  }
  const git = (session: Session, cwd: string, args: string[], signal: AbortSignal, options?: RunOptions) =>
    run(session, cwd, ['git', ...args], signal, options).then((output) => output.text)

  /** Branch, upstream remote and remote URL of the checkout; null fields when Git has none. */
  const checkout = async (session: Session, cwd: string, signal: AbortSignal) => {
    const branch = (
      await git(session, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal).catch(() => '')
    ).trim()
    if (!branch) throw new ActionError('unavailable')
    const upstreamRemote = (
      await git(session, cwd, ['config', '--get', `branch.${branch}.remote`], signal, { allowed: [0, 1] })
    ).trim()
    const remotes = (await git(session, cwd, ['remote'], signal)).split('\n').filter(Boolean)
    const remote = upstreamRemote || (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0]! : '')
    const url = remote ? (await git(session, cwd, ['remote', 'get-url', remote], signal)).trim() : ''
    return { branch, remote: remote || null, url: url || null, tracked: !!upstreamRemote }
  }

  const generateMessage = async (agent: Agent, cwd: string, signal: AbortSignal) => {
    const session = agent.session
    const [status, stat, diff, recent] = await Promise.all([
      git(session, cwd, ['diff', '--cached', '--name-status'], signal),
      git(session, cwd, ['diff', '--cached', '--stat'], signal),
      git(session, cwd, ['diff', '--cached', '--no-color', '--no-ext-diff'], signal),
      git(session, cwd, ['log', '-n', '10', '--format=%s'], signal, { allowed: [0, 128] }),
    ])
    const conversation = session.requestHeader()?.config ?? agent.options
    const resolved = registration?.resolve({ provider: conversation.provider ?? '', model: conversation.model ?? '' })
    const route = resolved?.route ?? (config.provider && config.model ? config : conversation)
    if (!route.provider || !route.model) throw new ActionError('message-failed')
    const effort = resolved
      ? resolved.reasoningEffort
      : config.provider && config.model
        ? config.reasoningEffort
        : undefined
    try {
      const call = await ctx.llm.prepareCall(
        {
          provider: route.provider,
          model: route.model,
          reasoningEffort: effort ? ReasoningEffortId(effort) : undefined,
        },
        signal,
        (controls, model) => ({
          ...controls,
          // Some adapters send an unsupported "none" value when no effort is set.
          reasoningEffort:
            controls.reasoningEffort ??
            model.reasoning?.defaultEffort ??
            model.reasoning?.efforts.find((item) => item.id !== 'off')?.id,
        })
      )
      const assembler = new BlockAssembler()
      for await (const chunk of call.stream({
        ...call.config,
        system: [
          resolved?.instructions ?? config.modelSettings?.instructions ?? commitMessageInstructions,
          resolved?.additionalInstructions,
        ]
          .filter(Boolean)
          .join('\n\n'),
        messages: [
          createUserMessage({
            content: [{ type: 'text', text: messageInput({ status, stat, diff, recent }) }],
            source: { kind: 'user' },
          }),
        ],
        sessionId: agent.session.id as never,
        signal,
      })) {
        signal.throwIfAborted()
        assembler.push(chunk)
      }
      const message =
        assembler.finish.kind === 'stop'
          ? normalizeMessage(
              assembler
                .blocks()
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('')
            )
          : undefined
      if (!message) throw new ActionError('message-failed')
      return message
    } catch (error) {
      throw error instanceof ActionError ? error : new ActionError('message-failed')
    }
  }

  const commit = async (agent: Agent, push: boolean, signal: AbortSignal) => {
    const session = agent.session
    const cwd = host.workingDirectory.get(session)
    const target = await checkout(session, cwd, signal)
    // Respect a deliberate partial staging; otherwise commit every change, as the chip shows them.
    const staged = await run(session, cwd, ['git', 'diff', '--cached', '--quiet'], signal, { allowed: [0, 1] })
    if (staged.exitCode === 0) {
      await git(session, cwd, ['add', '--all'], signal)
      const all = await run(session, cwd, ['git', 'diff', '--cached', '--quiet'], signal, { allowed: [0, 1] })
      if (all.exitCode === 0) throw new ActionError('nothing-to-commit')
    }
    const message = await generateMessage(agent, cwd, AbortSignal.any([signal, AbortSignal.timeout(90_000)]))
    // Hooks run inside the Session sandbox, the same way the agent's own commits run them.
    await git(session, cwd, ['commit', '--quiet', '--cleanup=strip', '-m', message], signal, {
      hooks: true,
      timeoutMs: 120_000,
    }).catch(() => {
      throw new ActionError('commit-failed')
    })
    const sha = (await git(session, cwd, ['rev-parse', 'HEAD'], signal)).trim()
    if (push) {
      if (!target.remote) throw new ActionError('no-remote')
      // Pushing needs the network and credentials outside the sandbox, so no repository hook may run.
      await git(
        session,
        cwd,
        target.tracked ? ['push', '--quiet'] : ['push', '--quiet', '--set-upstream', target.remote, 'HEAD'],
        signal,
        { unconfined: true, timeoutMs: 120_000 }
      ).catch(() => {
        throw new ActionError('push-failed')
      })
      if (target.url) await host.forgeSession.discoverBranch(session, target.url, target.branch).catch(() => {})
    }
    return { commit: sha, subject: message.split('\n')[0]!, pushed: push }
  }

  /**
   * Opens a Gitea or Forgejo PR with `tea pulls create`, which prints JSON from tea 0.16 on. Like the tea
   * providers, it uses the one tea login for the repository's HTTPS host, and it fills title and description from
   * the commits the way `gh pr create --fill` does; without a known default branch tea titles the PR after the branch.
   */
  const createTeaPr = async (
    session: Session,
    cwd: string,
    repository: Repository,
    target: { branch: string; remote: string | null },
    signal: AbortSignal
  ) => {
    const env = teaEnvironment()
    const tea = (args: string[], timeoutMs: number) =>
      run(session, cwd, ['tea', ...args], signal, { unconfined: true, timeoutMs, env }).catch(() => {
        signal.throwIfAborted()
        throw new ActionError('pr-failed')
      })
    const listed = await tea(['login', 'list', '--output', 'json'], 15_000)
    let logins: unknown
    try {
      logins = JSON.parse(listed.text)
    } catch {
      throw new ActionError('pr-failed')
    }
    const matches = (Array.isArray(logins) ? logins : []).filter((entry) => {
      try {
        const url = new URL(entry?.url)
        return url.href === `https://${repository.host}/` && !url.username && !url.password
      } catch {
        return false
      }
    })
    const login = matches.length === 1 ? matches[0].name : undefined
    if (typeof login !== 'string' || !login || login.startsWith('-')) throw new ActionError('pr-failed')

    const fill: string[] = []
    const base = target.remote
      ? (
          await git(session, cwd, ['rev-parse', '--quiet', '--verify', `refs/remotes/${target.remote}/HEAD`], signal, {
            allowed: [0, 1],
          })
        ).trim()
      : ''
    if (base) {
      const commits = (await git(session, cwd, ['log', '--reverse', '--format=%s%x00%b%x1e', `${base}..HEAD`], signal))
        .split('\x1e')
        .map((entry) => entry.trim().split('\0'))
        .filter(([subject]) => subject)
      if (commits.length === 1) {
        fill.push(`--title=${commits[0]![0]}`)
        if (commits[0]![1]?.trim()) fill.push(`--description=${commits[0]![1].trim()}`)
      } else if (commits.length > 1) fill.push(`--description=${commits.map(([subject]) => `- ${subject}`).join('\n')}`)
    }

    const output = await tea(
      [
        'pulls',
        'create',
        `--login=${login}`,
        `--repo=${repository.owner}/${repository.name}`,
        `--head=${target.branch}`,
        ...fill,
        '--output=json',
      ],
      60_000
    )
    let created: { url?: unknown; head?: unknown } | undefined
    try {
      created = JSON.parse(output.text)
    } catch {
      // tea before 0.16 ignores `--output` here and prints the created PR's details, which end with its URL.
      created = { url: output.text.match(/https:\/\/\S+/gu)?.at(-1), head: target.branch }
    }
    const ref = typeof created?.url === 'string' ? host.forge.changeRequestFromUrl(created.url) : undefined
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
    if (
      !ref ||
      created?.head !== target.branch ||
      ref.repository.forge !== repository.forge ||
      ref.repository.host !== repository.host ||
      !same(ref.repository.owner, repository.owner) ||
      !same(ref.repository.name, repository.name)
    )
      throw new ActionError('pr-failed')
    const url = host.forge.changeRequestUrl(ref)
    try {
      host.forgeSession.track(session, url)
    } catch {
      // The PR exists; the panel discovers it on the next branch lookup.
    }
    return { url, reused: false }
  }

  const createPr = async (agent: Agent, signal: AbortSignal) => {
    const session = agent.session
    const cwd = host.workingDirectory.get(session)
    const target = await checkout(session, cwd, signal)
    const repository = target.url ? host.forge.repositoryFromRemote(target.url) : undefined
    if (!target.tracked || !repository) throw new ActionError('no-remote')
    // Creating a PR never commits or pushes; local commits must already be on the remote branch.
    const ahead = await git(session, cwd, ['rev-list', '--count', '@{upstream}..HEAD'], signal).catch(() => '')
    if (ahead.trim() !== '0') throw new ActionError('not-pushed')
    const existing = await host.forge.findByHead(repository, target.branch, signal).catch(() => [])
    if (existing.length > 0) {
      const url = host.forge.changeRequestUrl(existing[0])
      host.forgeSession.track(session, url)
      return { url, reused: true }
    }
    const command = prCommands[repository.forge]
    if (!command && !teaForges.has(repository.forge)) throw new ActionError('unsupported')
    await host.subprocess
      .resolveExecutable(command ? command(target.branch).executable : 'tea', undefined, signal)
      .catch(() => {
        signal.throwIfAborted()
        throw new ActionError('pr-unavailable')
      })
    if (!command) return createTeaPr(session, cwd, repository, target, signal)
    const { executable, args } = command(target.branch)
    const output = await run(session, cwd, [executable, ...args], signal, {
      unconfined: true,
      timeoutMs: 60_000,
      env: gitProcessEnvironment({ GH_PROMPT_DISABLED: '1', NO_COLOR: '1', GLAB_NO_PROMPT: '1' }),
    }).catch(() => {
      throw new ActionError('pr-failed')
    })
    const url = output.text.match(/https?:\/\/\S+/gu)?.at(-1)
    if (!url) throw new ActionError('pr-failed')
    try {
      host.forgeSession.track(session, url)
    } catch {
      // The PR exists; the panel discovers it on the next branch lookup.
    }
    return { url, reused: false }
  }

  registerIntegration(ctx, () => config.integrationMethod)

  const handlers: Record<string, (payload: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>> = {
    async [methods.settings]() {
      return { defaultAction: config.defaultAction.get() }
    },
    async [methods.saveDefault](payload) {
      const value = payload.defaultAction
      if (value !== 'commit' && value !== 'push') throw new ActionError('unavailable')
      const entry = ctx.fiber.entry
      if (!entry) throw new ActionError('unavailable')
      await ctx.configEditor.edit(entry, (current, inherited) => ({ ...inherited, ...current, defaultAction: value }))
      return { defaultAction: value }
    },
    async [methods.commit](payload, signal) {
      if (typeof payload.push !== 'boolean') throw new ActionError('unavailable')
      return withAgent(payload, (agent, maintenance) =>
        commit(agent, payload.push as boolean, AbortSignal.any([signal, maintenance]))
      )
    },
    async [methods.pr](payload, signal) {
      return withAgent(payload, (agent, maintenance) => createPr(agent, AbortSignal.any([signal, maintenance])))
    },
  }
  /** Git actions run only for an idle Session, inside its maintenance window so no turn starts meanwhile. */
  const withAgent = async <T>(
    payload: Record<string, unknown>,
    task: (agent: Agent, signal: AbortSignal) => Promise<T>
  ) => {
    const id = payload.sessionId
    const agent = typeof id === 'string' ? host.agents.get(id) : undefined
    if (!agent || agent.status !== 'idle' || host.sessions.get(id as string) !== agent.session)
      throw new ActionError('unavailable')
    return agent.runMaintenance((signal) => task(agent, signal))
  }

  for (const method of Object.values(methods))
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${method}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            const parsed = await parseRpcRequest(request, method)
            if (!parsed) return new Response('Invalid request', { status: 400 })
            let result
            try {
              const payload = parsed.payload
              if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                throw new ActionError('unavailable')
              result = { ok: true, value: await handlers[method]!(payload as Record<string, unknown>, request.signal) }
            } catch (error) {
              const code = error instanceof ActionError ? error.code : 'unavailable'
              result = { ok: false, error: { code, message: 'Git action failed.', details: {} } }
            }
            return rpcResponse(parsed.rpcId, result)
          },
        }),
      `ui-forge-chip: ${method}`
    )
}
