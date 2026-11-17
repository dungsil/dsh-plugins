import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { gitProcessEnvironment, parseRpcRequest, rpcResponse } from '@dungsil/dsh-plugin-server'
import { canEnter, sessionGuardProjection, type SessionGuardState } from './session-guard.js'
import { capWorktrees, parseWorktreeList, type ListedWorktree } from './worktree-list.js'

const channel = '/api'
const endpoint = (method: 'list' | 'enter') => `dungsil-worktree-picker/${method}`
type Session = { readonly header: { readonly cwd?: string }; readonly id: string }
type Agent = {
  readonly session: Session
  readonly status: string
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}
type Host = {
  on(
    event: 'session/event',
    listener: (session: Session, event: { type: string }) => void,
    options: { global: true }
  ): () => void
  agents: { get(id: string): Agent | undefined }
  sessions: { get(id: string): Session | undefined }
  workingDirectory: {
    get(session: Session): string
    set(agent: Agent, path: string, signal: AbortSignal): Promise<string>
  }
  sessionProjections: { register(definition: unknown): Promise<{ stateOf(session: Session): SessionGuardState }> }
  fs: {
    resolve(path: string, options: { cwd?: string; signal: AbortSignal }): Promise<unknown>
    processPath(target: unknown): string
    processPathFromHostPath(path: string): string | undefined
  }
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
}
type Snapshot = {
  origin: { directory: string; root: string; branch: string | null }
  current: string
  worktrees: ListedWorktree[]
}
const key = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)

async function sharedPath(host: Host, path: string, signal: AbortSignal, cwd?: string) {
  const canonical = await realpath(path)
  const mapped = host.fs.processPathFromHostPath(canonical)
  const execution = host.fs.processPath(await host.fs.resolve(path, { cwd, signal }))
  if (!mapped || key(mapped) !== key(execution)) throw Error('filesystem world unavailable')
  return { canonical, execution }
}

async function git(host: Host, session: Session, cwd: string, args: string[], signal: AbortSignal): Promise<string> {
  const control = AbortSignal.any([signal, AbortSignal.timeout(10000)])
  const executable = await host.subprocess.resolveExecutable('git', undefined, control)
  const command = [
    executable,
    '--no-optional-locks',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=false',
    ...args,
  ]
  const policy = host.sandboxPolicy.resolve({ session })
  const argv =
    policy.mode === 'danger-full-access' ? command : (await host.sandbox.confine(command, policy, control)).argv
  control.throwIfAborted()
  const handle = host.subprocess.spawn({
    argv,
    cwd,
    env: gitProcessEnvironment(),
    signal: control,
    graceMs: 1000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1048576 }, stderr: { maxBytes: 65536 } },
  })
  try {
    const outcome = await handle.done
    control.throwIfAborted()
    const read = handle.collected.stdout?.readFrom(0)
    if (outcome.exitCode !== 0 || !read || read.lossy) throw Error('git failed')
    return read.text
  } finally {
    handle.terminate()
    await handle.waitForExit()
  }
}

async function snapshot(host: Host, agent: Agent, signal: AbortSignal): Promise<Snapshot> {
  const origin = agent.session.header.cwd
  if (!origin || !isAbsolute(origin)) throw Error('unavailable')
  const { canonical: directory, execution: cwd } = await sharedPath(host, origin, signal)
  const { canonical: currentDirectory } = await sharedPath(host, host.workingDirectory.get(agent.session), signal)
  const output = await git(host, agent.session, cwd, ['worktree', 'list', '--porcelain', '-z'], signal)
  const entries = (
    await Promise.all(
      parseWorktreeList(output).map(async (entry) => {
        try {
          const { canonical: path } = await sharedPath(host, entry.path, signal, cwd)
          const info = await stat(path)
          return info.isDirectory() ? { ...entry, path, modified: info.mtimeMs } : null
        } catch {
          return null
        }
      })
    )
  ).filter((entry): entry is ListedWorktree & { modified: number } => entry !== null)
  // Without a durable repository identity, an ancestor checkout cannot prove it
  // is the original repository if the origin disappears or is replaced.
  const original = entries.find((entry) => key(entry.path) === key(directory))
  const current = entries.find((entry) => key(entry.path) === key(currentDirectory))
  if (!original || !current) throw Error('not registered')
  const ordered = entries
    .filter((entry) => key(entry.path) !== key(original.path))
    .sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path))
  return {
    origin: { directory, root: original.path, branch: original.branch },
    current: current.path,
    worktrees: capWorktrees(
      ordered,
      ordered.find((entry) => key(entry.path) === key(current.path))
    ),
  }
}

export async function registerWorktrees(ctx: Context) {
  const host = ctx as unknown as Host
  const guard = await host.sessionProjections.register(sessionGuardProjection)
  for (const method of ['list', 'enter'] as const)
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${endpoint(method)}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            const parsed = await parseRpcRequest(request, endpoint(method))
            if (!parsed) return new Response('Invalid request', { status: 400 })
            let result
            try {
              const payload = parsed.payload
              if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('invalid request')
              const value = payload as Record<string, unknown>
              if (
                Object.keys(value).length !== (method === 'list' ? 1 : 2) ||
                typeof value.sessionId !== 'string' ||
                (method === 'enter' && typeof value.path !== 'string')
              )
                throw Error('invalid request')
              const agent = host.agents.get(value.sessionId)
              if (!agent || agent.status !== 'idle' || host.sessions.get(value.sessionId) !== agent.session)
                throw Error('unavailable')
              const state = guard.stateOf(agent.session)
              if (state.started || state.created || (method === 'enter' && state.requested)) throw Error('unavailable')
              if (method === 'list') {
                result = { ok: true, value: await snapshot(host, agent, request.signal) }
              } else {
                const target = value.path as string
                const updated = await agent.runMaintenance(async (maintenance) => {
                  const cancellation = new AbortController()
                  const stop = host.on(
                    'session/event',
                    (session, event) => {
                      if (
                        session === agent.session &&
                        (event.type === 'turn/start' ||
                          event.type === 'step/start' ||
                          String(event.type).startsWith('plugin:client-ui-forge/worktree') ||
                          String(event.type) === 'plugin:worktree/created')
                      )
                        cancellation.abort()
                    },
                    { global: true }
                  )
                  const signal = AbortSignal.any([request.signal, maintenance, cancellation.signal])
                  try {
                    if (
                      host.agents.get(value.sessionId as string) !== agent ||
                      host.sessions.get(value.sessionId as string) !== agent.session ||
                      !canEnter(guard.stateOf(agent.session))
                    )
                      throw Error('unavailable')
                    const list = await snapshot(host, agent, signal)
                    const canonical = await realpath(target)
                    const allowed = [list.origin.directory, ...list.worktrees.map((entry) => entry.path)]
                    const matched = allowed.find((path) => key(path) === key(canonical))
                    if (
                      !matched ||
                      host.agents.get(value.sessionId as string) !== agent ||
                      host.sessions.get(value.sessionId as string) !== agent.session ||
                      !canEnter(guard.stateOf(agent.session))
                    )
                      throw Error('not registered')
                    const origin = await sharedPath(host, list.origin.root, signal)
                    const selected = await sharedPath(host, matched, signal)
                    const expectedRoot = key(matched) === key(list.origin.directory) ? list.origin.root : matched
                    const [originCommon, selectedCommon, selectedRoot] = await Promise.all([
                      git(
                        host,
                        agent.session,
                        origin.execution,
                        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
                        signal
                      ),
                      git(
                        host,
                        agent.session,
                        selected.execution,
                        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
                        signal
                      ),
                      git(
                        host,
                        agent.session,
                        selected.execution,
                        ['rev-parse', '--path-format=absolute', '--show-toplevel'],
                        signal
                      ),
                    ])
                    const [commonA, commonB, root] = await Promise.all([
                      sharedPath(host, originCommon.trim(), signal, origin.execution),
                      sharedPath(host, selectedCommon.trim(), signal, selected.execution),
                      sharedPath(host, selectedRoot.trim(), signal, selected.execution),
                    ])
                    if (key(commonA.canonical) !== key(commonB.canonical) || key(root.canonical) !== key(expectedRoot))
                      throw Error('checkout no longer belongs to repository')
                    signal.throwIfAborted()
                    if (
                      host.agents.get(value.sessionId as string) !== agent ||
                      host.sessions.get(value.sessionId as string) !== agent.session ||
                      !canEnter(guard.stateOf(agent.session))
                    )
                      throw Error('unavailable')
                    return await host.workingDirectory.set(agent, selected.execution, signal)
                  } finally {
                    stop()
                  }
                })
                result = { ok: true, value: updated }
              }
            } catch {
              result = {
                ok: false,
                error: { code: 'unavailable', message: 'Worktree selection is unavailable.', details: {} },
              }
            }
            return rpcResponse(parsed.rpcId, result)
          },
        }),
      'ui-forge-worktree: owner-only worktrees'
    )
}
