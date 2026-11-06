import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { execa } from 'execa'
import type { Run } from './provider.js'

export function createGlabRunner(config: { glabCommand: string; timeoutMs: number; maxOutputBytes: number }): Run {
  return async (args, signal, input) => {
    signal.throwIfAborted()
    const result = await execa(config.glabCommand, args, {
      env: {
        ...scrubbedParentEnv(),
        GLAB_PROMPT_DISABLED: '1',
        GLAB_CHECK_UPDATE: 'false',
        NO_COLOR: '1',
        PAGER: 'cat',
        GIT_TERMINAL_PROMPT: '0',
        GITLAB_HOST: undefined,
        GITLAB_REPO: undefined,
      },
      extendEnv: false,
      ...(input === undefined ? { stdin: 'ignore' as const } : { input }),
      stripFinalNewline: false,
      reject: false,
      timeout: config.timeoutMs,
      cancelSignal: signal,
      maxBuffer: config.maxOutputBytes,
    })
    signal.throwIfAborted()
    if (result.isMaxBuffer) throw new RangeError('GitLab output limit exceeded')
    if (result.timedOut || result.exitCode === undefined) throw new Error('GitLab CLI unavailable')
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }
  }
}
