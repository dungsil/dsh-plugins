import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import { BlockAssembler, ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { Session, SessionId, appendPluginRecord, pluginRecordOf, type PluginRecordMap } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { workspaceDomainState } from '@deepseek-ai/dsh-workspace'
import type { TaskDefinition, TaskRegistration } from '@dungsil/dsh-plugin-model-settings/contract'
import { worktreeInstructions } from '@dungsil/dsh-task-prompts'
import {
  channel,
  endpointPrefix,
  currentWorktree,
  ownershipRecord,
  type WorktreeSettings,
  type WorktreeSelectionView,
  type WorktreeView,
} from './protocol.js'

import WorktreeService, {
  type CreateWorktreeRequest,
  type CreateWorktreePhase,
  type CreatedWorktree,
} from '@deepseek-ai/dsh-experimental-worktree'
export const name = 'dungsil-ui-worktree'
export const inject = [
  ...WorktreeService.inject,
  'connection',
  'sessionController',
  'agents',
  'sessions',
  'configEditor',
  'llm',
  'workingDirectory',
  'subprocess',
  'sandbox',
  'sandboxPolicy',
  'workspaceRegistry',
  'sessionPersistence',
]

export const Config = z.object({
  directory: z.string().default('.agents/worktrees'),
  remote: z.boolean().default(false),
  deleteOnArchive: z.boolean().default(false),
  naming: z.union(['semantic', 'dsh', 'custom']).default('semantic'),
  prefix: z.string().default(''),
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  modelSettings: z.object({
    inherit: z.union(['auxiliary', 'conversation']).default('auxiliary'),
    instructions: z.string(),
  }),
})

function validSettings(value: unknown): value is WorktreeSettings {
  if (!value || typeof value !== 'object') return false
  const input = value as WorktreeSettings
  return (
    typeof input.directory === 'string' &&
    !input.directory.includes('\\') &&
    !input.directory.includes(':') &&
    input.directory.split('/').every((part) => !!part && part !== '.' && part !== '..') &&
    input.directory.trim().length > 0 &&
    input.directory.length <= 4096 &&
    !/[\0\r\n]/.test(input.directory) &&
    typeof input.remote === 'boolean' &&
    typeof input.deleteOnArchive === 'boolean' &&
    ['semantic', 'dsh', 'custom'].includes(input.naming) &&
    typeof input.prefix === 'string' &&
    input.prefix.length <= 100 &&
    (input.prefix === '' || /^[a-zA-Z0-9][a-zA-Z0-9_-]*(\/[a-zA-Z0-9][a-zA-Z0-9_-]*)*\/?$/.test(input.prefix)) &&
    (input.naming !== 'custom' || input.prefix.length > 0)
  )
}

// Do not let inherited Git selectors redirect the repository chosen by the Session.
const gitEnv = Object.fromEntries(
  [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'GIT_CEILING_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_SHALLOW_FILE',
    'GIT_GRAFT_FILE',
    'GIT_REPLACE_REF_BASE',
    'GIT_ATTR_SOURCE',
  ].map((key) => [key, undefined])
)

export interface Config extends WorktreeSettings {
  provider?: string
  model?: string
  reasoningEffort?: string
  modelSettings?: { inherit: 'auxiliary' | 'conversation'; instructions?: string }
}

export const modelSettingsDefinition: TaskDefinition = {
  key: 'branch-name',
  label: { en: 'Worktree branch name', ko: '워크트리 브랜치 이름', zh: '工作树分支名称' },
  description: {
    en: 'Model and instructions for naming new worktree branches.',
    ko: '새 워크트리 브랜치 이름을 생성하는 모델과 지침입니다.',
    zh: '生成新工作树分支名称的模型和指令。',
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
  defaultInstructions: (config) => worktreeInstructions(typeof config.naming === 'string' ? config.naming : 'semantic'),
}

export default class ForgeWorktreeExtensions extends WorktreeService {
  static inject = inject
  static Config = Config
  private readonly prepareRequest: (
    agent: Agent,
    request: CreateWorktreeRequest,
    signal: AbortSignal
  ) => Promise<CreateWorktreeRequest>
  private readonly recordCreated: (agent: Agent, result: CreatedWorktree) => Promise<void>
  private readonly active: Set<string>
  constructor(ctx: Context, config: Config) {
    super(ctx, {
      directory: config.directory,
      namePrefix: 'dsh-',
      gitCommand: 'git',
      nodeCommand: 'node',
      timeoutMs: 60_000,
      graceMs: 3_000,
      maxOutputBytes: 65_536,
    })
    const extension = installExtensions(ctx, config)
    this.prepareRequest = extension.prepareRequest
    this.recordCreated = extension.recordCreated
    this.active = extension.pending
  }
  override async create(
    agent: Agent,
    request: CreateWorktreeRequest = {},
    signal: AbortSignal = new AbortController().signal,
    onPhase?: (phase: CreateWorktreePhase) => void
  ) {
    if (this.active.has(agent.id)) throw new Error('Worktree operation is busy')
    this.active.add(agent.id)
    try {
      const prepared = await this.prepareRequest(agent, request, signal)
      const result = await super.create(agent, prepared, signal, onPhase)
      await this.recordCreated(agent, result)
      return result
    } finally {
      this.active.delete(agent.id)
    }
  }
}

function installExtensions(ctx: Context, config: Config) {
  if (!validSettings(config)) throw new Error('Invalid worktree settings')
  const pending = new Set<string>()
  const prompts = new WeakMap<Agent, string>()
  // Observe input only; Forge alone owns admission, reservations and maintenance holds.
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (!['user', 'user-rpc'].includes(message.source.kind)) return
    prompts.set(
      agent,
      message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .slice(-12_000)
    )
  })
  const lifetime = new AbortController()
  let saving = false
  ctx.effect(() => () => lifetime.abort(), 'ui-worktree: cancel disposed operations')
  let registration: TaskRegistration | undefined
  ctx.inject(['dungsilModelSettings'], (child) => {
    const current = child.dungsilModelSettings.register(ctx, modelSettingsDefinition)
    registration = current
    child.effect(() => () => {
      current.dispose()
      if (registration === current) registration = undefined
    })
  })
  const run = async (
    session: Session,
    cwd: string,
    args: string[],
    signal: AbortSignal,
    executable = 'git',
    env: Record<string, string> = {},
    allowed = [0],
    readOnly = false
  ) => {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(10_000)])
    const argv = [
      await ctx.subprocess.resolveExecutable(executable, undefined, bounded),
      ...(executable === 'git' ? ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'] : []),
      ...args,
    ]
    const policy = ctx.sandboxPolicy.resolve({ session })
    const command =
      policy.mode === 'danger-full-access'
        ? argv
        : (await ctx.sandbox.confine(argv, { ...policy, mode: readOnly ? 'read-only' : policy.mode }, bounded)).argv
    const child = ctx.subprocess.spawn({
      argv: command,
      cwd,
      signal: bounded,
      graceMs: 1000,
      env: {
        ...gitEnv,
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_LFS_SKIP_SMUDGE: '1',
        GIT_NO_LAZY_FETCH: '1',
        ...env,
      },
      stdio: { stdin: 'ignore', stdout: { maxBytes: 1_048_576 }, stderr: { maxBytes: 65536 } },
    })
    let text: string
    try {
      const outcome = await child.done
      bounded.throwIfAborted()
      const output = child.collected!.stdout!.readFrom(0)
      if (outcome.exitCode === null || !allowed.includes(outcome.exitCode) || output.lossy)
        throw new Error('Worktree command failed')
      text = output.text
    } finally {
      child.terminate()
      await child.waitForExit()
    }
    // Cancellation can arrive while the provider waits for the managed process tree to exit.
    bounded.throwIfAborted()
    return text
  }

  // Passive Git reads must not provision Windows workspace-write ACLs across the repository tree.
  const readGit = (session: Session, cwd: string, args: string[], signal: AbortSignal) =>
    run(session, cwd, args, signal, 'git', {}, [0], true)

  const selectionView = (session: Session, _agent?: Agent): WorktreeSelectionView => ({
    cwd: ctx.workingDirectory.get(session),
  })

  const describe = async (session: Session, signal: AbortSignal, agent?: Agent): Promise<WorktreeView> => {
    const cwd = ctx.workingDirectory.get(session)
    const output = await readGit(session, cwd, ['worktree', 'list', '--porcelain', '-z'], signal)
    const worktrees: WorktreeView['worktrees'] = []
    // -z preserves spaces, newlines and backslashes in literal filesystem paths.
    for (const record of output.split('\0\0')) {
      const fields = record.split('\0')
      const path = fields.find((field) => field.startsWith('worktree '))?.slice(9)
      if (!path || fields.includes('bare') || fields.some((field) => /^prunable(?: |$)/.test(field))) continue
      const branch = fields.find((field) => field.startsWith('branch refs/heads/'))?.slice(18) ?? null
      worktrees.push({ path, branch })
    }
    return {
      ...selectionView(session, agent),
      // The Git output belongs to this captured directory, even if a concurrent task has moved on.
      cwd,
      worktrees,
    }
  }
  const entry = () => {
    const entries = ctx.configEditor.entries().filter((item) => item.options.name === '@dungsil/dsh-plugin-ui-worktree')
    if (entries.length !== 1) throw new Error('Settings unavailable')
    return entries[0]!
  }
  const snapshot = () => {
    const current = entry().options.config
    return {
      revision: createHash('sha256')
        .update(JSON.stringify(current ?? {}))
        .digest('hex'),
      settings: {
        directory: current?.directory ?? '.agents/worktrees',
        remote: current?.remote ?? false,
        deleteOnArchive: current?.deleteOnArchive ?? false,
        naming: current?.naming ?? 'semantic',
        prefix: current?.prefix ?? '',
      },
    }
  }
  // Both checkout and status/removal can run repository-defined filter programs.
  const withoutFilters = async (session: Session, path: string, signal: AbortSignal) => {
    const filters = await run(
      session,
      path,
      ['--work-tree', path, 'config', '--null', '--name-only', '--get-regexp', '^filter\\.'],
      signal,
      'git',
      {},
      [0, 1]
    )
    const drivers = new Set(
      filters.split('\0').flatMap((key) => {
        const separator = key.lastIndexOf('.')
        return separator > 7 && ['clean', 'smudge', 'process', 'required'].includes(key.slice(separator + 1))
          ? [key.slice(7, separator)]
          : []
      })
    )
    const env: Record<string, string> = { GIT_CONFIG_COUNT: String(drivers.size * 4) }
    let index = 0
    for (const driver of drivers)
      for (const attribute of ['clean', 'smudge', 'process', 'required']) {
        env[`GIT_CONFIG_KEY_${index}`] = `filter.${driver}.${attribute}`
        env[`GIT_CONFIG_VALUE_${index++}`] = attribute === 'required' ? 'false' : ''
      }
    return env
  }

  // Observe committed archive transitions, not the optional stop-activity request.
  // Never sweep old archives when this option is enabled or the plugin reloads.
  let archived = new Set(ctx.workspaceRegistry.archivedSessionIds)
  const cleanup = async (sessionId: SessionId) => {
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) return
    const { agent } = resolved
    await agent.whenIdle()
    if (pending.has(sessionId) || saving || lifetime.signal.aborted) return
    pending.add(sessionId)
    try {
      await agent.runMaintenance(async (maintenanceSignal) => {
        const signal = AbortSignal.any([maintenanceSignal, lifetime.signal, AbortSignal.timeout(60_000)])
        // Domain events commit before the registry's cached state catches up.
        if (!archived.has(sessionId)) return
        if ((await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))).length) return
        const record = agent.session
          .snapshotEvents()
          .map(pluginRecordOf)
          .findLast((record) => record?.type === ownershipRecord)
        const owned = record?.data as Partial<PluginRecordMap[typeof ownershipRecord]> | undefined
        if (!owned || owned.sessionId !== sessionId) return
        const { path, source, branch } = owned
        if (typeof path !== 'string' || typeof source !== 'string' || typeof branch !== 'string') return
        const contains = (cwd: string) => !!currentWorktree({ cwd, worktrees: [{ path, branch }] })
        if (!contains(ctx.workingDirectory.get(agent.session))) return
        const view = await describe(agent.session, signal, agent)
        const selected = currentWorktree({ cwd: path, worktrees: view.worktrees })
        if (!selected || selected.branch !== branch || !contains(selected.path)) return
        const env = await withoutFilters(agent.session, path, signal)
        if (
          await run(
            agent.session,
            path,
            ['status', '--porcelain', '--untracked-files=all', '--ignored'],
            signal,
            'git',
            env
          )
        )
          return
        // Include closed conversations, not just currently loaded Agents. A fork
        // inherits the ownership record but is never its owner.
        for (const session of ctx.sessions.list()) {
          if (session.id !== sessionId && contains(ctx.workingDirectory.get(session))) return
        }
        for (const { header } of await ctx.sessionPersistence.list({ signal })) {
          if (header.id === sessionId || ctx.sessions.get(header.id)) continue
          const handle = await ctx.sessionPersistence.open(header.id, 'read', { signal })
          try {
            const { events } = await handle.read(undefined, undefined, { signal })
            const cwd = events.findLast((event) => event.type === 'working-directory/change')
            if (
              contains(
                cwd?.type === 'working-directory/change'
                  ? cwd.data.cwd
                  : (header.cwd ?? ctx.workingDirectory.defaultDirectory)
              )
            )
              return
          } finally {
            await handle.close()
          }
        }
        if (!archived.has(sessionId)) return
        // Git refuses dirty, locked and primary checkouts. Never force removal
        // or delete the branch; restoring the conversation keeps its commits.
        await run(agent.session, source, ['worktree', 'remove', '--', path], signal, 'git', env)
        // Keep the recorded directory: Forge detects the missing checkout and offers restore.
        // Falling back to the source would hide Forge's restoration state.
        await ctx.sessions.flush(agent.session)
      })
    } finally {
      pending.delete(sessionId)
    }
  }
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return
    const next = new Set(workspaceDomainState.parse(change.value).archivedSessionIds)
    const added = [...next].filter((id) => !archived.has(id))
    archived = next
    if (!config.deleteOnArchive) return
    for (const id of added)
      void cleanup(id).catch(() => {
        ctx.logger.warn('ui-worktree: archive cleanup skipped or failed; worktree was not force-removed')
      })
  })
  const failure = (code: string) => ({
    ok: false as const,
    error: {
      code,
      message: 'Worktree operation could not be confirmed. Reload the list before retrying.',
      details: {},
    },
  })
  const handle = async (endpoint: string, payload: unknown, signal: AbortSignal) => {
    if (endpoint === 'settings' || endpoint === 'save-settings') {
      if (endpoint === 'save-settings' && (saving || pending.size > 0)) return failure('busy')
      try {
        if (endpoint === 'settings') return { ok: true as const, value: snapshot() }
        const input = payload as { revision?: unknown; settings?: unknown } | null
        if (!input || typeof input.revision !== 'string' || !validSettings(input.settings)) return failure('invalid')
        saving = true
        signal.throwIfAborted()
        await ctx.configEditor.edit(entry(), (current) => {
          if (snapshot().revision !== input.revision) throw new Error('conflict')
          const { directory, remote, deleteOnArchive, naming, prefix } = input.settings as WorktreeSettings
          return { ...current, directory, remote, deleteOnArchive, naming, prefix }
        })
        return { ok: true as const, value: snapshot() }
      } catch (error) {
        return failure(error instanceof Error && error.message === 'conflict' ? 'conflict' : 'save_failed')
      } finally {
        if (endpoint === 'save-settings') saving = false
      }
    }
    return failure('invalid')
  }
  // Exact Connection routes admit only authenticated owner Peers, not shared Session viewers.
  for (const endpoint of ['settings', 'save-settings']) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${endpointPrefix}${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            let body
            try {
              body = clientRequestSchema.safeParse(await request.json())
            } catch {
              return new Response('Invalid request', { status: 400 })
            }
            if (!body.success || body.data.method !== `${endpointPrefix}${endpoint}`)
              return new Response('Invalid request', { status: 400 })
            const result = await handle(endpoint, body.data.payload, request.signal)
            return Response.json(
              { type: 'server-response', rpcId: body.data.rpcId, result },
              { headers: { 'Cache-Control': 'no-store' } }
            )
          },
        }),
      `ui-worktree: owner-only ${endpoint}`
    )
  }
  return {
    pending,
    async prepareRequest(
      this: void,
      agent: Agent,
      request: CreateWorktreeRequest,
      signal: AbortSignal
    ): Promise<CreateWorktreeRequest> {
      const operationSignal = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(60_000)])
      const submitted = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].filter((message) =>
        ['user', 'user-rpc'].includes(message.source.kind)
      )
      let branch = ''
      const conversation = agent.session.requestHeader()?.config ?? agent.options
      const resolved = registration?.resolve({
        provider: conversation.provider ?? '',
        model: conversation.model ?? '',
      })
      const route = resolved?.route ?? (config.provider && config.model ? config : conversation)
      if (!route.provider || !route.model) throw new Error('No model selected')
      const effort = resolved
        ? resolved.reasoningEffort
        : config.provider && config.model
          ? config.reasoningEffort
          : undefined
      const context = submitted
        .flatMap((message) => message.content.filter((block) => block.type === 'text'))
        .map((block) => block.text)
        .join('\n')
        .slice(-12_000)
      const call = await ctx.llm.prepareCall(
        {
          provider: route.provider,
          model: route.model,
          reasoningEffort: effort ? ReasoningEffortId(effort) : undefined,
        },
        operationSignal,
        (controls, model) => ({
          ...controls,
          // Some adapters send an unsupported "none" value when no effort is set.
          reasoningEffort:
            controls.reasoningEffort ??
            model.reasoning?.defaultEffort ??
            model.reasoning?.efforts.find((effort) => effort.id !== 'off')?.id,
        })
      )
      const assembler = new BlockAssembler()
      // A naming-only call uses the submitted prompt, never a conversation turn or tools.
      for await (const chunk of call.stream({
        ...call.config,
        system: [
          resolved?.instructions ?? config.modelSettings?.instructions ?? worktreeInstructions(config.naming),
          resolved?.additionalInstructions,
        ]
          .filter(Boolean)
          .join('\n\n'),
        messages: [
          createUserMessage({
            content: [{ type: 'text', text: context || prompts.get(agent) || 'New worktree' }],
            source: { kind: 'user' },
          }),
        ],
        sessionId: agent.id,
        signal: operationSignal,
      })) {
        operationSignal.throwIfAborted()
        assembler.push(chunk)
      }
      branch = assembler
        .blocks()
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim()
      const pattern =
        config.naming === 'semantic'
          ? /^(feat|fix|refactor|docs|test|chore|perf|build|ci)\/[a-z0-9][a-z0-9-]*$/
          : /^[a-z0-9][a-z0-9-]*$/
      if (assembler.finish.kind !== 'stop' || branch.length > 80 || !pattern.test(branch))
        throw new Error('Invalid generated branch name')
      if (config.naming !== 'semantic') {
        const prefix = config.naming === 'dsh' ? 'dsh/' : config.prefix
        branch = prefix + branch
      }
      let from = request.from
      if (config.remote && !from) {
        const cwd = ctx.workingDirectory.get(agent.session)
        from = (
          await readGit(agent.session, cwd, ['rev-parse', '--symbolic-full-name', '@{upstream}'], operationSignal)
        ).trim()
        if (!from.startsWith('refs/remotes/')) throw new Error('No tracked remote branch')
      }
      return { ...request, name: branch, ...(from ? { from } : {}) }
    },
    async recordCreated(this: void, agent: Agent, result: CreatedWorktree) {
      appendPluginRecord(agent.session, ownershipRecord, {
        path: result.path,
        source: result.repositoryRoot,
        branch: result.branch,
        sessionId: agent.id,
      })
      await ctx.sessions.flush(agent.session)
    },
  }
}
