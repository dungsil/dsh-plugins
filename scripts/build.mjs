import { readFile, rm } from 'node:fs/promises'
import { build } from 'esbuild'

// pnpm executes this script from the package being built.
const { name } = JSON.parse(await readFile('package.json', 'utf8'))
await rm('dist', { recursive: true, force: true })
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
})
await build({
  entryPoints: ['src/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2023',
  // Harness loads browser plugins through its ModuleLoader, not ESM imports.
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory(require) { const module = { exports: {} }; const exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})
