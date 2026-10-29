import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import semanticRelease from 'semantic-release'

const root = new URL('../', import.meta.url)
const config = JSON.parse(await readFile(new URL('.releaserc.json', root), 'utf8'))

test('release versions, changelog and archive agree; unchanged history does not release again', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-release-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const cwd = join(directory, 'checkout')
  const remote = join(directory, 'remote.git')
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'pipe' })
  execFileSync('git', ['clone', remote, cwd], { stdio: 'pipe' })
  await cp(new URL('packages', root), join(cwd, 'packages'), { recursive: true })
  await rm(join(cwd, 'packages/locale-ko/dist'), { recursive: true, force: true })
  // Use the real plugin build and prepack hook without installing dependencies again.
  await symlink(new URL('node_modules', root).pathname, join(cwd, 'node_modules'))
  await cp(new URL('.gitignore', root), join(cwd, '.gitignore'))
  await cp(new URL('package.json', root), join(cwd, 'package.json'))
  await cp(new URL('pnpm-workspace.yaml', root), join(cwd, 'pnpm-workspace.yaml'))
  await cp(new URL('pnpm-lock.yaml', root), join(cwd, 'pnpm-lock.yaml'))
  await cp(new URL('tools', root), join(cwd, 'tools'), { recursive: true })
  git('config', 'user.name', 'Release test')
  git('config', 'user.email', 'release-test@example.com')
  git('add', '.')
  git('commit', '-m', 'chore: initial fixture')
  git('tag', 'v0.1.1')
  git('push', 'origin', 'main', '--tags')

  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback()
    },
  })
  // No GitHub calls or registry publication: only the disposable local Git remote is written.
  const options = {
    ...config,
    ci: false,
    repositoryUrl: pathToFileURL(remote).href,
    plugins: config.plugins.filter((plugin) => plugin[0] !== '@semantic-release/github'),
  }
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    GIT_AUTHOR_NAME: 'Release test',
    GIT_AUTHOR_EMAIL: 'release-test@example.com',
    GIT_COMMITTER_NAME: 'Release test',
    GIT_COMMITTER_EMAIL: 'release-test@example.com',
  }
  const context = { cwd, env, stdout: output, stderr: output }

  for (const [message, version, type] of [
    ['docs: document installation', null, null],
    ['fix: correct locale fallback', '0.1.2', 'patch'],
    ['feat: add another locale', '0.2.0', 'minor'],
    ['feat!: remove legacy locale API', '1.0.0', 'major'],
    ['fix: change lookup\n\nBREAKING CHANGE: old lookup keys no longer work', '2.0.0', 'major'],
  ]) {
    git('commit', '--allow-empty', '-m', message)
    git('push', 'origin', 'main')
    const result = await semanticRelease(options, context)
    if (!version) {
      assert.equal(result, false)
      assert.equal(git('tag', '--list'), 'v0.1.1')
      continue
    }
    assert.equal(result.nextRelease.version, version)
    assert.equal(result.nextRelease.type, type)
    assert.ok(result.nextRelease.notes.includes(message.split('\n')[0].replace(/^\w+!?: /, '')))
    const manifest = JSON.parse(await readFile(join(cwd, 'packages/locale-ko/package.json'), 'utf8'))
    assert.equal(manifest.version, version)
    const changelog = await readFile(join(cwd, 'CHANGELOG.md'), 'utf8')
    assert.ok(changelog.includes(version))
    assert.ok(changelog.includes(result.nextRelease.notes))
    const archive = (await readdir(join(cwd, 'release'))).find((name) => name.endsWith(`-${version}.tgz`))
    assert.ok(archive)
    const packed = JSON.parse(
      execFileSync('tar', ['-xOf', join(cwd, 'release', archive), 'package/package.json'], { encoding: 'utf8' })
    )
    assert.equal(packed.version, version)
    const contents = execFileSync('tar', ['-tzf', join(cwd, 'release', archive)], { encoding: 'utf8' })
    assert.ok(contents.includes('package/dist/client.js'))
    assert.equal(git('rev-parse', `v${version}`), git('rev-parse', 'HEAD'))
    assert.equal(git('status', '--porcelain'), '')
    assert.equal(await semanticRelease(options, context), false)
  }
})
