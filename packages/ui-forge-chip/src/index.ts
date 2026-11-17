import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerIntegration } from './integration.js'
import type { MergeMethod } from './protocol.js'

export const name = 'dungsil-ui-forge-chip'
export const inject = ['connection', 'agents', 'sessions', 'workingDirectory', 'subprocess', 'fs']
export const Config = z.object({ integrationMethod: z.union(['merge', 'rebase', 'squash']).default('merge') })
export interface Config {
  integrationMethod: MergeMethod
}

export function apply(ctx: Context, config: Config) {
  registerIntegration(ctx, () => config.integrationMethod)
}
