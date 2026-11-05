import { defineConfig, nodeConfig } from '@dungsil/dsh-tsdown'

export default defineConfig({ ...nodeConfig, deps: { alwaysBundle: ['@dungsil/dsh-task-prompts'] } })
