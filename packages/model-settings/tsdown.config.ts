import { defineConfig, nodeConfig } from '@dungsil/dsh-tsdown'

export default defineConfig([
  {
    ...nodeConfig,
    entry: ['src/index.ts', 'src/pwsh-adapter.ts'],
    deps: { alwaysBundle: ['@dungsil/dsh-task-prompts'] },
  },
  {
    entry: ['src/protocol.ts', 'src/contract.ts'],
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    fixedExtension: false,
    dts: true,
  },
])
