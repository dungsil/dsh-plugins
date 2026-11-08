import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  fixedExtension: false,
  dts: false,
  deps: { neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-experimental-forge', '@deepseek-ai/dsh-subprocess'] },
})
