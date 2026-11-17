import { clientConfig, defineConfig, nodeConfig } from '@dungsil/dsh-tsdown'
import manifest from './package.json' with { type: 'json' }

export default defineConfig([
  { ...nodeConfig, entry: ['src/index.ts', 'src/install.ts'], deps: { alwaysBundle: ['@dungsil/dsh-plugin-server'] } },
  clientConfig(manifest.name, {
    entry: ['src/client.tsx'],
    deps: {
      alwaysBundle: ['@dungsil/dsh-ui'],
      neverBundle: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
    },
  }),
])
