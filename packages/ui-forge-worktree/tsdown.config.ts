import { copyFile, mkdir } from 'node:fs/promises'
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
    hooks: {
      async 'build:done'() {
        await mkdir(new URL('./dist', import.meta.url), { recursive: true })
        await copyFile(
          new URL('../../tools/ui/src/icons/git-branch.svg', import.meta.url),
          new URL('./dist/icon.svg', import.meta.url)
        )
      },
    },
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
