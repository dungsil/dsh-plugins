import { defineConfig } from 'tsdown'

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
    entry: ['src/protocol.ts'],
    format: 'esm',
    platform: 'neutral',
    target: 'es2023',
    fixedExtension: false,
    dts: true,
  },
])
