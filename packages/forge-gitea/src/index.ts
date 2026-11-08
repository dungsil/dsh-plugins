import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GiteaProvider } from './provider.js'
import { createTeaRunner, type RunnerConfig } from './runner.js'
export { GiteaProvider, createTeaRunner }
export { teaEnvironment } from './runner.js'
export const name = 'dungsil-forge-gitea'
export const inject = ['forge']
export const Config = z.object({
  teaCommand: z.string().default('tea'),
  hosts: z.array(z.string()).default(['gitea.com']),
  timeoutMs: z.number().min(1).max(2147483647).default(30000),
  maxOutputBytes: z.number().min(1).default(4194304),
})
export interface Config extends RunnerConfig {
  hosts: string[]
}
export function apply(ctx: Context, config: Config) {
  ctx.forge.register(new GiteaProvider(createTeaRunner(config), config.hosts, config.maxOutputBytes))
}
