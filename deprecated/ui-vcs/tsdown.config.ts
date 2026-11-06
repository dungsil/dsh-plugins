import { defineConfig } from 'tsdown'
import manifest from './package.json' with { type: 'json' }

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    target: 'node24',
    fixedExtension: false,
    dts: false,
    deps: { alwaysBundle: ['@dungsil/dsh-async'] },
  },
  {
    entry: ['src/client.tsx'],
    format: 'cjs',
    platform: 'browser',
    inputOptions: { platform: 'browser' },
    loader: { '.svg': 'text' },
    deps: {
      alwaysBundle: ['@dungsil/dsh-ui'],
      neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
    },
    target: 'es2023',
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory(require) { const module = { exports: {} }; const exports = module.exports;`,
    footer: 'return module.exports; } });',
  },
])
