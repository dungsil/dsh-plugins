import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-fs'
import { BlockAssembler, ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { Session, SessionId, appendPluginRecord, pluginRecordOf, type PluginRecordMap } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-working-directory'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { workspaceDomainState } from '@deepseek-ai/dsh-workspace'
import { createTaskQueue } from '@dungsil/dsh-async'
import type { TaskDefinition, TaskRegistration } from '@dungsil/dsh-plugin-model-settings/contract'
import { worktreeInstructions } from '@dungsil/dsh-task-prompts'
import {
  channel,
  endpointPrefix,
  currentWorktree,
  ownershipRecord,
  progressRecord,
  selectionRecord,
  type WorktreeProgress,
  type WorktreeSettings,
  type WorktreeSelectionView,
  type WorktreeView,
} from './protocol.js'

export const name = 'dungsil-ui-worktree'
export const inject = [
  'connection',
  'sessionController',
  'agents',
  'sessions',
  'configEditor',
  'fs',
  'llm',
  'workingDirectory',
  'subprocess',
  'sandbox',
  'sandboxPolicy',
  'workspaceRegistry',
  'sessionPersistence',
]

export const Config = z.object({
  defaultSelection: z.union(['current', 'new']).default('current'),
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
    ['current', 'new'].includes(input.defaultSelection) &&
    typeof input.directory === 'string' &&
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

export function apply(ctx: Context, config: Config) {
  if (!validSettings(config)) throw new Error('Invalid worktree settings')
  const pending = new Set<string>()
  const read = createTaskQueue({ concurrency: 2, maxPending: 128 })
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
  // Reservations follow the live Agent, including browser navigation and reloads.
  // Disposing the Agent or restarting the host cancels unexecuted reservations.
  type Creation = { cwd: string; name: string; failed: boolean }
  type Switching = { cwd: string; path: string; failed: boolean }
  type Selection = { creation?: Creation; switching?: Switching }
  const creations = new WeakMap<Agent, Creation>()
  const switches = new WeakMap<Agent, Switching>()
  const explicitSelections = new WeakSet<Agent>()
  const creating = new WeakSet<Agent>()
  const admitted = new WeakMap<Agent, Map<string, Selection>>()
  const completed = new WeakSet<Creation | Switching>()

  // Freeze intent at prompt admission, not when a queued prompt eventually enters a step.
  ctx.on('agent/inbox/inserted', ({ agent, message }) => {
    if (!['user', 'user-rpc'].includes(message.source.kind)) return
    const creation = creations.get(agent)
    const switching = switches.get(agent)
    if (!creation && !switching) return
    let messages = admitted.get(agent)
    if (!messages) admitted.set(agent, (messages = new Map()))
    messages.set(message.id, { creation, switching })
  })
  ctx.on('agent/inbox/discarded', ({ agent, message }) => {
    admitted.get(agent)?.delete(message.id)
  })

  ctx.on('agent/pre-step', async ({ agent, messages: proposed, signal }, next) => {
    const messages = admitted.get(agent)
    const decision = await next().catch((error: unknown) => {
      for (const message of proposed) messages?.delete(message.id)
      throw error
    })
    const entered = new Set(decision.kind === 'enter' ? decision.messages.map((message) => message.id) : [])
    for (const message of proposed) if (!entered.has(message.id)) messages?.delete(message.id)
    if (decision.kind !== 'enter') return decision
    if (creations.get(agent)?.failed || switches.get(agent)?.failed)
      throw new Error('Worktree selection needs confirmation. Select a worktree before retrying.')
    const submitted = decision.messages.filter((message) => ['user', 'user-rpc'].includes(message.source.kind))
    if (!submitted.length) return decision
    const seen = new Set<Creation | Switching>()
    const selections = submitted.flatMap((message) => {
      const selection = messages?.get(message.id)
      const intent = selection?.creation ?? selection?.switching
      if (!intent) return []
      if (completed.has(intent)) {
        messages!.delete(message.id)
        return []
      }
      if (seen.has(intent)) return []
      seen.add(intent)
      return [{ id: message.id, ...selection }]
    })
    if (selections.length > 1) throw new Error('Conflicting worktree selections in one step')
    const selection = selections[0]
    const creation = selection?.creation
    const switching = selection?.switching
    if (creation?.failed || switching?.failed)
      throw new Error('Worktree selection needs confirmation. Select a worktree before retrying.')
    if (!selection) return decision
    if (switching) {
      switching.failed = true
      const operationSignal = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(60_000)])
      pending.add(agent.id)
      creating.add(agent)
      try {
        if (ctx.workingDirectory.get(agent.session) !== switching.cwd) throw new Error('Working directory changed')
        if (!(await switchWorktree(agent, switching.path, operationSignal))) throw new Error('Invalid worktree')
        await ctx.sessions.flush(agent.session)
        completed.add(switching)
        if (switches.get(agent) === switching) switches.delete(agent)
        return decision
      } catch {
        throw new Error('Worktree switch could not be confirmed. Select a worktree before retrying.')
      } finally {
        for (const message of submitted) messages!.delete(message.id)
        creating.delete(agent)
        pending.delete(agent.id)
      }
    }
    if (!creation) return decision
    // Mark the reservation before any side effect. A timeout or partial failure
    // must never create another checkout on the next prompt.
    creation.failed = true
    const operationSignal = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(60_000)])
    pending.add(agent.id)
    creating.add(agent)
    const progress: WorktreeProgress = {
      id: selection.id,
      step: 0,
      status: 'running',
      updatedAt: Date.now(),
      durations: [0, 0, 0, 0],
    }
    const report = (step: number, status: WorktreeProgress['status'] = 'running', branch?: string) => {
      const now = Date.now()
      progress.durations[progress.step]! += Math.max(0, now - progress.updatedAt)
      progress.step = step
      progress.status = status
      progress.updatedAt = now
      if (branch) progress.branch = branch
      appendPluginRecord(agent.session, progressRecord, progress)
    }
    try {
      report(0)
      if (ctx.workingDirectory.get(agent.session) !== creation.cwd) throw new Error('Working directory changed')
      let branch = creation.name
      if (!branch) {
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
              content: [{ type: 'text', text: context || 'New worktree' }],
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
      }
      operationSignal.throwIfAborted()
      await create(agent, branch, operationSignal, report)
      await ctx.sessions.flush(agent.session)
      completed.add(creation)
      if (creations.get(agent) === creation) creations.delete(agent)
      report(3, 'completed', branch)
      return decision
    } catch {
      report(progress.step, signal.aborted || lifetime.signal.aborted ? 'cancelled' : 'failed')
      throw new Error(
        'Worktree creation could not be confirmed. Refresh the list and select a worktree before retrying.'
      )
    } finally {
      for (const message of submitted) messages!.delete(message.id)
      creating.delete(agent)
      pending.delete(agent.id)
    }
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

  const selectionInitialized = (session: Session) =>
    session.snapshotEvents().some((event) => pluginRecordOf(event)?.type === selectionRecord)

  const selectionView = (session: Session, agent?: Agent): WorktreeSelectionView => {
    const creation = agent ? creations.get(agent) : undefined
    const switching = agent ? switches.get(agent) : undefined
    const running = !!agent && creating.has(agent)
    return {
      cwd: ctx.workingDirectory.get(session),
      ...(creation ? { pendingCreation: { name: creation.name, failed: creation.failed && !running } } : {}),
      ...(switching ? { pendingSwitch: { path: switching.path, failed: switching.failed && !running } } : {}),
    }
  }

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
      ...(!selectionInitialized(session) ? { needsInitialization: true } : {}),
    }
  }

  const initializeSelection = (agent: Agent, cwd: string, applyDefault: boolean) => {
    if (selectionInitialized(agent.session)) return
    if (
      applyDefault &&
      config.defaultSelection === 'new' &&
      !explicitSelections.has(agent) &&
      !switches.has(agent) &&
      !creations.has(agent) &&
      !agent.session.deriveMessages().some((message) => ['user', 'user-rpc'].includes(message.source.kind))
    ) {
      creations.set(agent, { cwd, name: '', failed: false })
    }
    appendPluginRecord(agent.session, selectionRecord, { initialized: true })
  }

  // Shared by deferred prompt execution and the legacy immediate-switch RPC.
  const switchWorktree = async (agent: Agent, targetPath: string, signal: AbortSignal) => {
    const view = await describe(agent.session, signal, agent)
    if (!view.worktrees.some((entry) => entry.path === targetPath)) return false
    const resolve = (path: string, cwd: string) => ctx.fs.resolve(path, { cwd, signal })
    const sourceCwd = await ctx.workingDirectory.ensure(agent, signal)
    const rev = async (cwd: string, option: string) =>
      (await readGit(agent.session, cwd, ['rev-parse', '--path-format=absolute', option], signal)).replace(/\r?\n$/, '')
    const target = await resolve(targetPath, sourceCwd)
    const top = await resolve(await rev(targetPath, '--show-toplevel'), targetPath)
    const common = await resolve(await rev(sourceCwd, '--git-common-dir'), sourceCwd)
    const targetCommon = await resolve(await rev(targetPath, '--git-common-dir'), targetPath)
    if (target.targetKey !== top.targetKey || common.targetKey !== targetCommon.targetKey) return false
    const admin = await resolve(await rev(targetPath, '--absolute-git-dir'), targetPath)
    const dotGitInfo = await ctx.fs.lstat('.git', { cwd: targetPath }, signal)
    if (!dotGitInfo || !['file', 'directory'].includes(dotGitInfo.type)) return false
    const dotGit = await resolve('.git', targetPath)
    if (admin.targetKey !== common.targetKey) {
      const backlink = await resolve('gitdir', ctx.fs.processPath(admin))
      const bytes = await ctx.fs.readBytes(backlink, signal, 8192)
      const linkedPath = new TextDecoder().decode(bytes).replace(/\r?\n$/, '')
      const linked = await resolve(linkedPath, ctx.fs.processPath(admin))
      if (linked.targetKey !== dotGit.targetKey) return false
    }
    signal.throwIfAborted()
    await ctx.workingDirectory.set(agent, ctx.fs.processPath(target), signal)
    return true
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
        defaultSelection: current?.defaultSelection ?? 'current',
        directory: current?.directory ?? '.agents/worktrees',
        remote: current?.remote ?? false,
        deleteOnArchive: current?.deleteOnArchive ?? false,
        naming: current?.naming ?? 'semantic',
        prefix: current?.prefix ?? '',
      },
    }
  }

  const create = async (agent: Agent, branch: string, signal: AbortSignal, report: (step: number) => void) => {
    report(1)
    // Resolve against the source worktree root, never a nested Session directory.
    const cwd = await ctx.workingDirectory.ensure(agent, signal)
    const git = (args: string[], env?: Record<string, string>, allowed?: number[]) =>
      run(agent.session, cwd, args, signal, 'git', env, allowed)
    if (
      branch.startsWith('-') ||
      branch.includes('\\') ||
      branch.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Invalid branch')
    await git(['check-ref-format', `refs/heads/${branch}`])
    const root = (await git(['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '')
    let revision = 'HEAD'
    if (config.remote) {
      revision = (await git(['rev-parse', '--symbolic-full-name', '@{upstream}'])).trim()
      if (!revision.startsWith('refs/remotes/')) throw new Error('No tracked remote branch')
    }
    const commit = (await git(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`])).trim()
    // Existing branches (including a conflicting namespace) are rejected before allocating paths.
    if (await git(['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`]))
      throw new Error('Branch already exists')
    // Keep paths lexical until the allocator has rejected every symlink component.
    // Resolving through ctx.fs first would hide repository-controlled redirects.
    const allocate = async (checkOnly = false) =>
      JSON.parse(
        await run(
          agent.session,
          cwd,
          [
            '--input-type=module',
            '-e',
            `
          import fs from 'node:fs/promises';
          import path from 'node:path';
          const [source, configured, branch, checkOnly] = process.argv.slice(1);
          let pool = path.resolve(source, configured);
          const fromSource = path.relative(source, pool);
          // An explicitly configured external pool may use owner-selected symlinks.
          // Repository-relative pools must be inspected before following links.
          if (fromSource === '..' || fromSource.startsWith('..' + path.sep) || path.isAbsolute(fromSource)) {
            async function canonicalParent(target) {
              try { return await fs.realpath(target); }
              catch (error) {
                if (error.code !== 'ENOENT') throw error;
                const parent = path.dirname(target);
                if (parent === target) throw error;
                return path.join(await canonicalParent(parent), path.basename(target));
              }
            }
            pool = await canonicalParent(pool);
          }
          const destination = path.resolve(pool, branch);
          const relative = path.relative(pool, destination);
          if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
            throw new Error('Invalid destination');
          async function walk(target, create) {
            let current = path.parse(target).root;
            for (const component of target.slice(current.length).split(path.sep).filter(Boolean)) {
              current = path.join(current, component);
              if (create) {
                try { await fs.mkdir(current); }
                catch (error) { if (error.code !== 'EEXIST') throw error; }
              }
              const info = await fs.lstat(current);
              if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe directory');
            }
            if (await fs.realpath(target) !== target) throw new Error('Directory changed');
          }
          await walk(path.dirname(pool), !checkOnly);
          if (!checkOnly) {
            try {
              await fs.mkdir(pool);
              await fs.writeFile(path.join(pool, '.gitignore'), '*\\n', { flag: 'wx' });
            } catch (error) { if (error.code !== 'EEXIST') throw error; }
          }
          await walk(pool, false);
          await walk(path.dirname(destination), !checkOnly);
          if (!checkOnly) await fs.mkdir(destination);
          await walk(destination, false);
          process.stdout.write(JSON.stringify(destination));
        `,
            root,
            config.directory.trim(),
            branch,
            checkOnly ? 'check' : '',
          ],
          signal,
          'node'
        )
      ) as string
    const path = await allocate()
    report(2)
    await allocate(true)
    await git(['worktree', 'add', '--no-checkout', '-b', branch, '--', path, commit])
    const env = await withoutFilters(agent.session, path, signal)
    await allocate(true)
    await run(
      agent.session,
      path,
      ['--work-tree', path, 'reset', '--hard', '--no-recurse-submodules', commit],
      signal,
      'git',
      env
    )
    report(3)
    appendPluginRecord(agent.session, ownershipRecord, { path, source: root, branch, sessionId: agent.id })
    await ctx.sessions.flush(agent.session)
    await ctx.workingDirectory.set(agent, path, signal)
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
        if (!ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) return
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
        if (!ctx.workspaceRegistry.archivedSessionIds.includes(sessionId)) return
        // Git refuses dirty, locked and primary checkouts. Never force removal
        // or delete the branch; restoring the conversation keeps its commits.
        await run(agent.session, source, ['worktree', 'remove', '--', path], signal, 'git', env)
        await ctx.workingDirectory.ensure(agent, signal)
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
  const maintain = <T>(agent: Agent, task: (signal: AbortSignal) => Promise<T>) => {
    try {
      return agent.runMaintenance(task)
    } catch {
      return Promise.resolve(failure('busy'))
    }
  }
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
          const { defaultSelection, directory, remote, deleteOnArchive, naming, prefix } =
            input.settings as WorktreeSettings
          return { ...current, defaultSelection, directory, remote, deleteOnArchive, naming, prefix }
        })
        return { ok: true as const, value: snapshot() }
      } catch (error) {
        return failure(error instanceof Error && error.message === 'conflict' ? 'conflict' : 'save_failed')
      } finally {
        if (endpoint === 'save-settings') saving = false
      }
    }
    if (!payload || typeof payload !== 'object') return failure('invalid')
    const input = payload as { sessionId?: unknown; cwd?: unknown; name?: unknown; path?: unknown; choice?: unknown }
    if (typeof input.sessionId !== 'string' || !input.sessionId) return failure('invalid')
    if (endpoint !== 'describe' && typeof input.cwd !== 'string') return failure('invalid')
    if (
      (endpoint === 'create' || endpoint === 'select') &&
      input.name !== undefined &&
      (typeof input.name !== 'string' || input.name.length > 200)
    )
      return failure('invalid')
    if (endpoint === 'switch' && (typeof input.path !== 'string' || !input.path)) return failure('invalid')
    if (endpoint === 'select') {
      if (!['current', 'new', 'existing'].includes(input.choice as string)) return failure('invalid')
      if (
        input.choice === 'existing' &&
        (typeof input.path !== 'string' || !input.path || input.path.length > 4096 || input.path.includes('\0'))
      )
        return failure('invalid')
    }
    const mutation = endpoint !== 'describe'
    if (mutation && (saving || pending.has(input.sessionId))) return failure('busy')
    if (mutation) pending.add(input.sessionId)
    try {
      const sessionId = SessionId(input.sessionId)
      if (!mutation) {
        const operationSignal = AbortSignal.any([signal, lifetime.signal, AbortSignal.timeout(60_000)])
        return await read(operationSignal, async () => {
          operationSignal.throwIfAborted()
          const live = ctx.agents.get(sessionId)
          if (live) return { ok: true as const, value: await describe(live.session, operationSignal, live) }
          const inspection = await ctx.sessionController.inspect(sessionId, operationSignal)
          const session = Session.create(sessionId, inspection.events, inspection.meta, inspection.inheritedEventCount)
          return { ok: true as const, value: await describe(session, operationSignal) }
        })
      }
      const resolved = await ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved)
        return {
          ok: false as const,
          error: { code: resolved.error.code, message: resolved.error.message, details: {} },
        }
      const { agent } = resolved
      // Directory and approval changes leave non-waking notices, not queued work.
      const queued = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(
        (message) => !['working-directory', 'user-approval'].includes(message.source.kind)
      )
      if (agent.status !== 'idle' || queued) return failure('busy')
      if (endpoint === 'select') {
        // Intent only: no maintenance, filesystem access, Git, log writes, or list refresh.
        // Git membership and backlink validation happen only when the admitted prompt executes.
        AbortSignal.any([signal, lifetime.signal]).throwIfAborted()
        if (ctx.workingDirectory.get(agent.session) !== input.cwd) return failure('conflict')
        explicitSelections.add(agent)
        creations.delete(agent)
        switches.delete(agent)
        if (input.choice === 'new')
          creations.set(agent, {
            cwd: input.cwd as string,
            name: typeof input.name === 'string' ? input.name.trim() : '',
            failed: false,
          })
        else if (input.choice === 'existing')
          switches.set(agent, { cwd: input.cwd as string, path: input.path as string, failed: false })
        return { ok: true as const, value: selectionView(agent.session, agent) }
      }
      return await maintain(agent, async (maintenanceSignal) => {
        const operationSignal = AbortSignal.any([
          signal,
          maintenanceSignal,
          lifetime.signal,
          AbortSignal.timeout(60_000),
        ])
        operationSignal.throwIfAborted()
        if (ctx.workingDirectory.get(agent.session) !== input.cwd) return failure('conflict')
        if (endpoint === 'initialize') {
          const cwd = await ctx.workingDirectory.ensure(agent, operationSignal)
          if (cwd !== input.cwd) return failure('conflict')
          await describe(agent.session, operationSignal, agent)
        } else if (endpoint === 'create') {
          switches.delete(agent)
          creations.set(agent, {
            cwd: input.cwd as string,
            name: typeof input.name === 'string' ? input.name.trim() : '',
            failed: false,
          })
        } else {
          if (!(await switchWorktree(agent, input.path as string, operationSignal))) return failure('invalid')
          creations.delete(agent)
          switches.delete(agent)
        }
        initializeSelection(agent, ctx.workingDirectory.get(agent.session), endpoint === 'initialize')
        await ctx.sessions.flush(agent.session)
        return { ok: true as const, value: await describe(agent.session, operationSignal, agent) }
      })
    } catch (error) {
      if (!mutation && error && typeof error === 'object' && 'code' in error && error.code === 'session/not-found')
        return failure('session/not-found')
      return failure(!mutation && error instanceof Error && error.message === 'busy' ? 'busy' : 'operation_failed')
    } finally {
      if (mutation) pending.delete(input.sessionId)
    }
  }

  // Exact Connection routes admit only authenticated owner Peers, not shared Session viewers.
  for (const endpoint of ['describe', 'initialize', 'select', 'create', 'switch', 'settings', 'save-settings']) {
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
}
