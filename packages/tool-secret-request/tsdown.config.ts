import { clientConfig, defineConfig, nodeConfig } from '@dungsil/dsh-tsdown'
import manifest from './package.json' with { type: 'json' }

export default defineConfig([
  { ...nodeConfig, deps: { alwaysBundle: ['@dungsil/dsh-plugin-server'] } },
  clientConfig(manifest.name, {
    entry: ['src/client.tsx'],
    deps: { neverBundle: ['react', 'react/jsx-runtime'] },
  }),
])
