import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// npm's release plugin cannot pack this pnpm-only workspace (devEngines).
export async function prepare(_config, { cwd, env, nextRelease, logger }) {
  const manifestPath = join(cwd, 'packages/locale-ko/package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version = nextRelease.version
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const output = execFileSync('pnpm', ['--filter', manifest.name, 'pack', '--pack-destination', join(cwd, 'release')], {
    cwd,
    env,
    encoding: 'utf8',
  })
  logger.log(output)
}
