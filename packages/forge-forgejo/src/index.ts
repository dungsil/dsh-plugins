import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { GiteaProvider } from '../../forge-gitea/src/provider.js'
import { createTeaRunner, type RunnerConfig } from '../../forge-gitea/src/runner.js'
export { createTeaRunner }
export { teaEnvironment } from '../../forge-gitea/src/runner.js'
export class ForgejoProvider extends GiteaProvider {
  constructor(run: ConstructorParameters<typeof GiteaProvider>[0], hosts: readonly string[], maxOutputBytes: number) {
    super(run, hosts, maxOutputBytes, 'forgejo')
  }
}
export const name = 'dungsil-forge-forgejo'
export const inject = ['forge']
export const Config = z.object({
  teaCommand: z.string().default('tea'),
  hosts: z.array(z.string()).default(['codeberg.org']),
  timeoutMs: z.number().min(1).max(2147483647).default(30000),
  maxOutputBytes: z.number().min(1).default(4194304),
})
export interface Config extends RunnerConfig {
  hosts: string[]
}
export function apply(ctx: Context, config: Config) {
  ctx.forge.register(new ForgejoProvider(createTeaRunner(config), config.hosts, config.maxOutputBytes))
}
