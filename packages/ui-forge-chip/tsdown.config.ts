import { clientConfig, defineConfig, nodeConfig } from '@dungsil/dsh-tsdown'
import manifest from './package.json' with { type: 'json' }

export default defineConfig([
  {
    ...nodeConfig,
    deps: {
      alwaysBundle: ['@dungsil/dsh-plugin-server', '@dungsil/dsh-task-prompts'],
      neverBundle: ['@deepseek-ai/dsh-client-connection'],
    },
  },
  clientConfig(manifest.name, {
    entry: ['src/client.tsx'],
    deps: {
      alwaysBundle: ['@dungsil/dsh-ui'],
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
    },
  }),
])
