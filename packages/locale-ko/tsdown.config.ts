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
  },
  {
    entry: ['src/client.ts'],
    format: 'cjs',
    platform: 'browser',
    inputOptions: { platform: 'browser' },
    target: 'es2023',
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    // Harness loads browser plugins through its ModuleLoader, not ESM imports.
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory(require) { const module = { exports: {} }; const exports = module.exports;`,
    footer: 'return module.exports; } });',
  },
])
