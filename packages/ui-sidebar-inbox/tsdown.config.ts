import { clientConfig, defineConfig, nodeConfig } from '@dungsil/dsh-tsdown'
import manifest from './package.json' with { type: 'json' }

export default defineConfig([
  nodeConfig,
  clientConfig(manifest.name, {
    entry: ['src/client.ts'],
    deps: {
      alwaysBundle: ['@dungsil/dsh-ui'],
      neverBundle: ['react', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'],
    },
  }),
])
