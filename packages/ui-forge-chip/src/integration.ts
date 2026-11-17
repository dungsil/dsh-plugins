import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { gitProcessEnvironment, parseRpcRequest, rpcResponse } from '@dungsil/dsh-plugin-server'

import {
  inspectMethod,
  mergeMethods,
  runMethod,
  type IntegrationBlocker,
  type IntegrationErrorCode,
  type IntegrationMethod,
  type IntegrationProposal,
  type MergeMethod,
} from './protocol.js'

type Session = { readonly header: { readonly cwd?: string }; readonly id: string }
type Agent = {
  readonly session: Session
  readonly status: string
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}
type Collected = { readFrom(offset: number): { text: string; lossy: boolean } }
type Host = {
  agents: { get(id: string): Agent | undefined }
  sessions: { get(id: string): Session | undefined }
  workingDirectory: { get(session: Session): string }
  sandboxPolicy: { resolve(options: { session: Session }): { mode: string } }
  sandbox: { confine(argv: string[], policy: { mode: string }, signal: AbortSignal): Promise<{ argv: string[] }> }
  fs: {
    resolve(path: string, options: { cwd?: string; signal: AbortSignal }): Promise<unknown>
    processPath(target: unknown): string
    processPathFromHostPath(path: string): string | undefined
  }
  subprocess: {
    resolveExecutable(name: string, env: Record<string, string> | undefined, signal: AbortSignal): Promise<string>
    spawn(spec: unknown): {
      done: Promise<{ exitCode: number | null }>
      collected: { stdout?: Collected; stderr?: Collected }
      terminate(): void
      waitForExit(): Promise<void>
    }
  }
}
type Place = { canonical: string; execution: string }
/** Git runs with the Session's own sandbox policy, so it reads and writes only what the Session may. */
type Scope = { readonly host: Host; readonly session: Session }
type Inspection = { proposal: IntegrationProposal; source: Place; target: Place; gitDir: string; picks: string[] }

const key = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)
const markers = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
  'REBASE_HEAD',
  'BISECT_LOG',
  'rebase-merge',
  'rebase-apply',
  'sequencer',
]

class IntegrationError extends Error {
  constructor(
    readonly code: IntegrationErrorCode,
    readonly diagnostic?: string
  ) {
    super(code)
  }
}

async function sharedPath(host: Host, path: string, signal: AbortSignal, cwd?: string): Promise<Place> {
  const canonical = await realpath(path)
  const mapped = host.fs.processPathFromHostPath(canonical)
  const execution = host.fs.processPath(await host.fs.resolve(path, { cwd, signal }))
  if (!mapped || key(mapped) !== key(execution)) throw new IntegrationError('unavailable')
  return { canonical, execution }
}

async function git(scope: Scope, cwd: string, args: string[], signal: AbortSignal, timeoutMs = 10000) {
  const { host, session } = scope
  const control = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  const executable = await host.subprocess.resolveExecutable('git', undefined, control)
  const command = [executable, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args]
  const policy = host.sandboxPolicy.resolve({ session })
  const argv =
    policy.mode === 'danger-full-access' ? command : (await host.sandbox.confine(command, policy, control)).argv
  control.throwIfAborted()
  const handle = host.subprocess.spawn({
    argv,
    cwd,
    env: gitProcessEnvironment({ GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' }),
    signal: control,
    graceMs: 1000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1048576 }, stderr: { maxBytes: 65536 } },
  })
  try {
    const outcome = await handle.done
    control.throwIfAborted()
    const stdout = handle.collected.stdout?.readFrom(0)
    if (!stdout || stdout.lossy) throw new IntegrationError('unavailable')
    return { code: outcome.exitCode, stdout: stdout.text, stderr: handle.collected.stderr?.readFrom(0).text ?? '' }
  } finally {
    handle.terminate()
    await handle.waitForExit()
  }
}

async function read(scope: Scope, cwd: string, args: string[], signal: AbortSignal) {
  const result = await git(scope, cwd, args, signal)
  if (result.code !== 0) throw new IntegrationError('unavailable')
  return result.stdout
}

/** Exit 0 is yes and exit 1 is no; anything else is an error. */
async function ask(scope: Scope, cwd: string, args: string[], signal: AbortSignal) {
  const { code } = await git(scope, cwd, args, signal)
  if (code !== 0 && code !== 1) throw new IntegrationError('unavailable')
  return code === 0
}

async function branchOf(scope: Scope, cwd: string, signal: AbortSignal) {
  const { code, stdout } = await git(scope, cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)
  if (code !== 0 && code !== 1) throw new IntegrationError('unavailable')
  return code === 0 ? stdout.trim() : null
}

async function headOf(scope: Scope, cwd: string, signal: AbortSignal) {
  const { code, stdout } = await git(scope, cwd, ['rev-parse', '--quiet', '--verify', 'HEAD^{commit}'], signal)
  return code === 0 ? stdout.trim() : null
}

const list = (output: string) => output.split('\0').filter(Boolean)
const lines = (output: string) => output.split('\n').filter(Boolean)

async function present(gitDir: string) {
  const found: string[] = []
  for (const name of markers) {
    try {
      await stat(join(gitDir, name))
      found.push(name)
    } catch {
      /* Missing marker. */
    }
  }
  return found
}

/** The Session's checkout and the checkout it started from, when both are worktrees of one repository. */
async function locate(host: Host, session: Session, signal: AbortSignal) {
  const origin = session.header.cwd
  if (!origin || !isAbsolute(origin)) return null
  const start = await sharedPath(host, origin, signal)
  const current = await sharedPath(host, host.workingDirectory.get(session), signal)
  const scope = { host, session }
  const facts = async (place: Place) => {
    const result = await git(
      scope,
      place.execution,
      ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir', '--absolute-git-dir'],
      signal
    )
    if (result.code !== 0) return null
    const [root, common, gitDir] = lines(result.stdout)
    if (!root || !common || !gitDir) return null
    return {
      root: await sharedPath(host, root, signal, place.execution),
      common: (await sharedPath(host, common, signal, place.execution)).canonical,
      gitDir: (await sharedPath(host, gitDir, signal, place.execution)).canonical,
    }
  }
  const [target, source] = await Promise.all([facts(start), facts(current)])
  if (!target || !source || key(target.common) !== key(source.common)) return null
  if (key(target.root.canonical) === key(source.root.canonical)) return null
  return { target: target.root, source: source.root, gitDir: target.gitDir }
}

async function inspect(
  host: Host,
  session: Session,
  preferred: MergeMethod,
  signal: AbortSignal,
  chosen?: IntegrationMethod
): Promise<Inspection | null> {
  const located = await locate(host, session, signal)
  if (!located) return null
  const { source, target, gitDir } = located
  const scope = { host, session }
  const S = source.execution
  const T = target.execution
  const [sourceHead, targetHead, sourceBranch, targetBranch] = await Promise.all([
    headOf(scope, S, signal),
    headOf(scope, T, signal),
    branchOf(scope, S, signal),
    branchOf(scope, T, signal),
  ])
  if (!sourceHead || !targetHead) return null
  if (await ask(scope, T, ['merge-base', '--is-ancestor', sourceHead, targetHead], signal)) return null
  const range = `${targetHead}...${sourceHead}`
  const [ff, picks, merges, total] = await Promise.all([
    ask(scope, T, ['merge-base', '--is-ancestor', targetHead, sourceHead], signal),
    read(scope, T, ['rev-list', '--reverse', '--right-only', '--cherry-pick', '--no-merges', range], signal).then(
      lines
    ),
    read(scope, T, ['rev-list', '--count', '--merges', `${targetHead}..${sourceHead}`], signal).then(Number),
    read(scope, T, ['rev-list', '--count', `${targetHead}..${sourceHead}`], signal).then(Number),
  ])
  // Every source commit already has an equivalent patch in the target.
  if (!ff && picks.length === 0 && merges === 0) return null
  const single = picks.length === 1 && merges === 0
  const method: IntegrationMethod = ff ? 'ff' : single ? 'cherry-pick' : preferred
  const methods: IntegrationMethod[] = [...(ff ? ['ff' as const] : []), ...(single ? ['cherry-pick' as const] : [])]
  methods.push(...mergeMethods)
  const effective = chosen ?? method
  let blocker: IntegrationBlocker | null = null
  let paths: string[] = []
  // Integration commits inside the Session's sandbox, which a read-only Session cannot write.
  if (host.sandboxPolicy.resolve({ session }).mode === 'read-only') blocker = 'read-only'
  else if (!targetBranch) blocker = 'detached'
  else if ((await present(gitDir)).length > 0) blocker = 'in-progress'
  else {
    const staged = list(await read(scope, T, ['diff', '--cached', '--no-renames', '--name-only', '-z'], signal))
    if (staged.length > 0) {
      blocker = 'staged'
      paths = staged
    } else {
      const changed = new Set(
        list(
          await read(
            scope,
            T,
            effective === 'cherry-pick'
              ? ['diff-tree', '--no-commit-id', '--no-renames', '--name-only', '-r', '-z', picks[0]!]
              : ['diff', '--no-renames', '--name-only', '-z', range],
            signal
          )
        )
      )
      const dirty = list(
        await read(scope, T, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], signal)
      ).map((entry) => entry.slice(3))
      paths = dirty.filter((path) => changed.has(path))
      if (paths.length > 0) blocker = 'overlap'
    }
  }
  return {
    proposal: {
      source: { root: source.canonical, branch: sourceBranch, head: sourceHead },
      target: { root: target.canonical, branch: targetBranch, head: targetHead },
      method,
      methods,
      commits: total,
      blocker,
      paths: paths.slice(0, 5),
    },
    source,
    target,
    gitDir,
    picks,
  }
}

function steps(method: IntegrationMethod, inspection: Inspection): string[][] {
  const { source } = inspection.proposal
  switch (method) {
    case 'ff':
      return [['merge', '--ff-only', '--no-edit', source.head]]
    case 'cherry-pick':
      return [['cherry-pick', inspection.picks[0]!]]
    case 'merge': {
      const subject = source.branch ? `Merge branch '${source.branch}'` : `Merge commit '${source.head.slice(0, 12)}'`
      return [['merge', '--no-ff', '--no-edit', '-m', subject, source.head]]
    }
    case 'squash':
      return [
        ['merge', '--squash', source.head],
        ['commit', '--no-edit'],
      ]
    case 'rebase':
      // Replays the source commits onto the target branch; the source branch itself never moves.
      return [['cherry-pick', ...inspection.picks]]
  }
}

/**
 * Cleans up only what this run started: the target is still on the same branch, HEAD (or the
 * sequencer's start) is the head the run began from, and every in-progress marker names this run.
 */
async function cleanup(
  scope: Scope,
  method: IntegrationMethod,
  inspection: Inspection,
  started: number,
  failure: string
): Promise<{ cleaned: boolean; diagnostic: string }> {
  const T = inspection.target.execution
  const { target, source } = inspection.proposal
  const signal = AbortSignal.timeout(60000)
  const [branch, head, found] = await Promise.all([
    branchOf(scope, T, signal),
    headOf(scope, T, signal),
    present(inspection.gitDir),
  ])
  const revision = async (name: string) =>
    (await git(scope, T, ['rev-parse', '--quiet', '--verify', name], signal)).stdout.trim()
  const describe = (reason: string) =>
    [
      `Integration ${method} of ${source.head} into ${target.branch} at ${target.root} failed: ${reason}.`,
      `Expected HEAD ${target.head} on ${target.branch}; found ${head ?? 'none'} on ${branch ?? 'detached HEAD'}.`,
      `In-progress state: ${found.length ? found.join(', ') : 'none'}.`,
      failure.trim().slice(-2000),
    ]
      .filter(Boolean)
      .join('\n')
  if (branch !== target.branch) return { cleaned: false, diagnostic: describe('the target branch changed') }
  let command: string[] | null = null
  if (found.length === 0 && head === target.head) {
    if (method === 'squash') {
      let squash = 0
      try {
        squash = (await stat(join(inspection.gitDir, 'SQUASH_MSG'))).mtimeMs
      } catch {
        /* Git stopped before preparing the squash. */
      }
      if (squash >= started) command = ['reset', '--merge']
      else if (squash > 0) return { cleaned: false, diagnostic: describe('a squash this run did not start is pending') }
    }
  } else if (method === 'ff' || method === 'merge') {
    if (found.length === 1 && found[0] === 'MERGE_HEAD' && head === target.head) {
      if ((await revision('MERGE_HEAD')) === source.head) command = ['merge', '--abort']
    }
  } else if (method === 'cherry-pick' || method === 'rebase') {
    const own = found.every((name) => name === 'CHERRY_PICK_HEAD' || name === 'sequencer')
    const picking = found.includes('CHERRY_PICK_HEAD') ? await revision('CHERRY_PICK_HEAD') : null
    let origin = head
    if (found.includes('sequencer')) {
      try {
        origin = (await readFile(join(inspection.gitDir, 'sequencer', 'head'), 'utf8')).trim()
      } catch {
        origin = null
      }
    }
    if (own && origin === target.head && (picking === null || inspection.picks.includes(picking)))
      command = ['cherry-pick', '--abort']
  }
  if (!command) {
    if (found.length === 0 && head === target.head)
      return { cleaned: true, diagnostic: describe('nothing was changed') }
    return { cleaned: false, diagnostic: describe('the remaining Git state may belong to another operation') }
  }
  const undone = await git(scope, T, command, signal, 60000)
  const [after, left] = await Promise.all([headOf(scope, T, signal), present(inspection.gitDir)])
  if (undone.code !== 0 || after !== target.head || left.length > 0)
    return { cleaned: false, diagnostic: describe(`cleanup with git ${command.join(' ')} did not finish`) }
  return { cleaned: true, diagnostic: describe(`the run was cleaned up with git ${command.join(' ')}`) }
}

export function registerIntegration(ctx: Context, preferred: () => MergeMethod) {
  const host = ctx as unknown as Host
  const running = new Set<string>()
  const agentOf = (sessionId: unknown) => {
    if (typeof sessionId !== 'string') throw new IntegrationError('unavailable')
    const agent = host.agents.get(sessionId)
    if (!agent || host.sessions.get(sessionId) !== agent.session) throw new IntegrationError('unavailable')
    return agent
  }
  const handlers = {
    async [inspectMethod](payload: Record<string, unknown>, signal: AbortSignal) {
      if (Object.keys(payload).length !== 1) throw new IntegrationError('unavailable')
      const agent = agentOf(payload.sessionId)
      return (await inspect(host, agent.session, preferred(), signal))?.proposal ?? null
    },
    async [runMethod](payload: Record<string, unknown>, signal: AbortSignal) {
      const { sessionId, method, targetBranch, targetHead, sourceHead } = payload
      if (
        Object.keys(payload).length !== 5 ||
        typeof method !== 'string' ||
        !['ff', 'cherry-pick', ...mergeMethods].includes(method) ||
        typeof targetBranch !== 'string' ||
        typeof targetHead !== 'string' ||
        typeof sourceHead !== 'string'
      )
        throw new IntegrationError('unavailable')
      const agent = agentOf(sessionId)
      if (agent.status !== 'idle') throw new IntegrationError('busy')
      const chosen = method as IntegrationMethod
      const scope = { host, session: agent.session }
      // Like the other chip actions, integration runs in the maintenance window so no turn starts meanwhile.
      return agent.runMaintenance(async (maintenance) => {
        const control = AbortSignal.any([signal, maintenance])
        const located = await locate(host, agent.session, control)
        if (!located) throw new IntegrationError('stale')
        const lock = key(located.target.canonical)
        if (running.has(lock)) throw new IntegrationError('busy')
        running.add(lock)
        try {
          const inspection = await inspect(host, agent.session, preferred(), control, chosen)
          const proposal = inspection?.proposal
          if (
            !inspection ||
            !proposal ||
            proposal.target.branch !== targetBranch ||
            proposal.target.head !== targetHead ||
            proposal.source.head !== sourceHead ||
            !proposal.methods.includes(chosen)
          )
            throw new IntegrationError('stale')
          if (proposal.blocker) throw new IntegrationError('blocked')
          // Writes ignore the request signal: killing Git halfway leaves state only cleanup can judge.
          const started = Date.now() - 1000
          let failure = ''
          for (const args of steps(chosen, inspection)) {
            try {
              const result = await git(scope, inspection.target.execution, args, AbortSignal.timeout(120000), 120000)
              if (result.code === 0) continue
              failure = `git ${args[0]}:\n${[result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n')}`
            } catch (error) {
              // The sandbox refused or Git could not finish; only cleanup can judge what changed.
              failure = `git ${args[0]} could not run in the Session sandbox: ${String(error)}`
            }
            break
          }
          if (failure) {
            let outcome
            try {
              outcome = await cleanup(scope, chosen, inspection, started, failure)
            } catch (error) {
              outcome = { cleaned: false, diagnostic: `${failure}\nCleanup could not run: ${String(error)}` }
            }
            throw new IntegrationError(outcome.cleaned ? 'failed' : 'cleanup-refused', outcome.diagnostic)
          }
          return { method: chosen, head: await headOf(scope, inspection.target.execution, AbortSignal.timeout(10000)) }
        } finally {
          running.delete(lock)
        }
      })
    },
  }
  for (const method of [inspectMethod, runMethod] as const)
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `/api/${method}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            const parsed = await parseRpcRequest(request, method)
            if (!parsed) return new Response('Invalid request', { status: 400 })
            let result
            try {
              const payload = parsed.payload
              if (!payload || typeof payload !== 'object' || Array.isArray(payload))
                throw new IntegrationError('unavailable')
              result = { ok: true, value: await handlers[method](payload as Record<string, unknown>, request.signal) }
            } catch (error) {
              const code = error instanceof IntegrationError ? error.code : 'unavailable'
              const diagnostic = error instanceof IntegrationError ? error.diagnostic : undefined
              if (diagnostic) ctx.logger.warn(diagnostic)
              result = {
                ok: false,
                error: { code, message: 'Integration is unavailable.', details: diagnostic ? { diagnostic } : {} },
              }
            }
            return rpcResponse(parsed.rpcId, result)
          },
        }),
      'ui-forge-chip: owner-only worktree integration'
    )
}
