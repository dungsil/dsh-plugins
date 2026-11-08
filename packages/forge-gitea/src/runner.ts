import { execa } from 'execa'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

export interface RunnerConfig {
  teaCommand: string
  timeoutMs: number
  maxOutputBytes: number
}
export type TeaRunner = (
  args: string[],
  signal: AbortSignal,
  input?: string
) => Promise<{ exitCode: number; stdout: string; stderr: string }>
export class TeaError extends Error {
  constructor(
    readonly code: 'unavailable' | 'too-large',
    message: string
  ) {
    super(message)
  }
}
export function teaEnvironment() {
  const env = scrubbedParentEnv()
  for (const key of Object.keys(env))
    if (/^(?:TEA_|GITEA_|FORGEJO_|GH_|GITHUB_|GLAB_|GITLAB_)/i.test(key)) delete env[key]
  return { ...env, NO_COLOR: '1', CLICOLOR: '0', TERM: 'dumb', GIT_TERMINAL_PROMPT: '0', TEA_NO_UPDATE_CHECK: '1' }
}
export function createTeaRunner(config: RunnerConfig): TeaRunner {
  if (!config.teaCommand.trim()) throw new Error('teaCommand must not be empty')
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > 2147483647)
    throw new Error('timeoutMs must be a positive timer-safe integer')
  if (!Number.isSafeInteger(config.maxOutputBytes) || config.maxOutputBytes <= 0)
    throw new Error('maxOutputBytes must be a positive safe integer')
  return async (args, signal, input) => {
    signal.throwIfAborted()
    const result = await execa(config.teaCommand, args, {
      env: teaEnvironment(),
      extendEnv: false,
      ...(input === undefined ? { stdin: 'ignore' as const } : { input }),
      reject: false,
      stripFinalNewline: false,
      timeout: config.timeoutMs,
      cancelSignal: signal,
      maxBuffer: config.maxOutputBytes,
    })
    if (signal.aborted || result.isCanceled) throw signal.reason
    if (result.isMaxBuffer) throw new TeaError('too-large', 'tea output exceeds maxOutputBytes')
    if (result.timedOut) throw new TeaError('unavailable', 'tea timed out')
    if (
      result.exitCode === undefined ||
      result.code === 'ENOENT' ||
      result.code === 'EACCES' ||
      (process.platform === 'win32' && /is not recognized as an internal or external command/i.test(result.stderr))
    )
      throw new TeaError('unavailable', 'tea could not start')
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}
