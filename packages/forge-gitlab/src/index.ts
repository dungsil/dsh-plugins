import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-experimental-forge'
import z from '@deepseek-ai/schemastery'
import { GitLabProvider } from './provider.js'
import { createGlabRunner } from './runner.js'

export { GitLabProvider } from './provider.js'
export const name = 'dungsil-forge-gitlab'
export const inject = ['forge']
export const Config = z.object({
  glabCommand: z.string().default('glab'),
  hosts: z.array(z.string()).default(['gitlab.com']),
  timeoutMs: z.number().default(30000),
  maxOutputBytes: z.number().default(8388608),
})
export interface Config {
  glabCommand: string
  hosts: string[]
  timeoutMs: number
  maxOutputBytes: number
}
export function apply(ctx: Context, config: Config) {
  if (
    !config.glabCommand.trim() ||
    !config.hosts.length ||
    config.hosts.some((host) => !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d+)?$/i.test(host))
  )
    throw new Error('Invalid GitLab CLI or hosts configuration')
  if (
    ![config.timeoutMs, config.maxOutputBytes].every((value) => Number.isSafeInteger(value) && value > 0) ||
    config.timeoutMs > 2147483647
  )
    throw new Error('Invalid GitLab limits')
  ctx.forge.register(new GitLabProvider(createGlabRunner(config), config.hosts, config.maxOutputBytes))
}
