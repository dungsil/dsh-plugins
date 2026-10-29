import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = {
  ...process.env,
  DSH_HOME: `${root}.dsh-dev`,
  DSH_TELEMETRY_DISABLED: '1',
}
const result = spawnSync(
  'pnpm',
  ['exec', 'dsh', 'plugin', '--profile', 'web', 'add', `link:${root}packages/locale-ko`],
  { cwd: root, env, stdio: 'inherit' }
)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
const child = spawn('pnpm', ['exec', 'dsh', 'web', '--no-open', ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: 'inherit',
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', (error) => {
  throw error
})
child.on('exit', (code) => process.exit(code ?? 1))
