import { defineConfig, nodeConfig } from '@dungsil/dsh-tsdown'

export default defineConfig([
  { ...nodeConfig, deps: { alwaysBundle: ['@dungsil/dsh-task-prompts'] } },
  {
    entry: ['src/protocol.ts'],
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    fixedExtension: false,
    dts: true,
  },
])
