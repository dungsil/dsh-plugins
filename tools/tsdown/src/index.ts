import type { UserConfig } from 'tsdown'

export { defineConfig } from 'tsdown'

export const nodeConfig = {
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  fixedExtension: false,
  dts: false,
} satisfies UserConfig

export function clientConfig(name: string, options: UserConfig): UserConfig {
  return {
    format: 'cjs',
    platform: 'browser',
    inputOptions: { platform: 'browser' },
    target: 'es2023',
    outExtensions: () => ({ js: '.js' }),
    dts: false,
    // Harness loads browser plugins through its ModuleLoader, not ESM imports.
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory(require) { const module = { exports: {} }; const exports = module.exports;`,
    footer: 'return module.exports; } });',
    ...options,
  }
}
