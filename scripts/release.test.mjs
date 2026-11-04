import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import release from 'release-it'
import { buildMarketIndex } from './market-index.mjs'
import { releaseOptions, releaseWorkspace } from './release.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))

await test('commit-driven releases preserve independent history, versions, tags and archives', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-release-'))
  const cwd = join(directory, 'repo')
  const previousCwd = process.cwd()
  t.after(() => {
    process.chdir(previousCwd)
    rmSync(directory, { recursive: true, force: true })
  })
  mkdirSync(cwd)
  const run = (command, args) => execFileSync(command, args, { cwd, encoding: 'utf8' })
  const write = (path, contents) => writeFileSync(join(cwd, path), contents)
  const manifest = (name) => JSON.parse(readFileSync(join(cwd, 'packages', name, 'package.json'), 'utf8'))
  const notes = (name) => readFileSync(join(cwd, 'packages', name, 'CHANGELOG.md'), 'utf8')
  const commit = (message) => {
    run('git', ['add', '.'])
    run('git', ['commit', '-m', message])
  }
  const publishLocally = async (name, dryRun = false) => {
    process.chdir(join(cwd, 'packages', name))
    const options = releaseOptions({ dryRun })
    // Exercise real versioning, packing, commits and pushes, but only to a local
    // bare Git repository. Never call npm or GitHub publishing in this test.
    options.npm.publish = false
    options.github.release = false
    return release(options)
  }

  run('git', ['init', '--bare', join(directory, 'remote.git')])
  run('git', ['init', '--initial-branch=main'])
  run('git', ['config', 'user.name', 'Release Test'])
  run('git', ['config', 'user.email', 'release@example.com'])
  run('git', ['remote', 'add', 'origin', join(directory, 'remote.git')])
  write(
    'package.json',
    JSON.stringify({
      name: 'release-fixture',
      private: true,
      scripts: { 'market:index': 'node --import ./deny-fetch.mjs scripts/market-index.mjs' },
    })
  )
  // Exercise the real generator offline, not a replacement that hides registry propagation bugs.
  mkdirSync(join(cwd, 'scripts'))
  write('scripts/market-index.mjs', readFileSync(join(root, 'scripts/market-index.mjs'), 'utf8'))
  write('deny-fetch.mjs', 'globalThis.fetch = async () => { throw new Error("Release indexing must not query npm") }\n')
  mkdirSync(join(cwd, 'market'))
  const emptyIndex = JSON.stringify(buildMarketIndex({ packages: [], registryDocuments: {} }))
  write('market/index.json', emptyIndex)
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
  write('.gitignore', 'node_modules/\nrelease/\n')
  mkdirSync(join(cwd, 'node_modules/.bin'), { recursive: true })
  mkdirSync(join(cwd, 'node_modules/@deepseek-ai'), { recursive: true })
  for (const dependency of ['.bin/oxfmt', 'semver', '@deepseek-ai/dsh-plugin-market-index']) {
    symlinkSync(join(root, 'node_modules', dependency), join(cwd, 'node_modules', dependency))
  }
  for (const [name, packageName, version] of [
    ['locale-ko', '@dungsil/dsh-plugin-locale-ko', '0.3.1'],
    ['other', '@fixture/other', '2.7.4'],
    ['new', '@fixture/new', '0.0.0'],
  ]) {
    mkdirSync(join(cwd, 'packages', name), { recursive: true })
    write(
      `packages/${name}/package.json`,
      JSON.stringify({
        name: packageName,
        version,
        market: { title: packageName },
        engines: { dsh: '^0.2.1-rc.5' },
        ...(name === 'locale-ko' ? { dependencies: { '@fixture/new': 'workspace:*' } } : {}),
      })
    )
  }
  const history = '# @dungsil/dsh-plugin-locale-ko\n\n## 0.3.1\n\nPrevious release.\n'
  write('packages/locale-ko/CHANGELOG.md', history)
  commit('chore: initial packages')
  write('packages/new/index.js', '// new feature\n')
  commit('feat(new): first feature')
  run('git', ['tag', 'v0.3.1'])
  run('git', ['tag', '@fixture/other@2.7.4'])
  run('git', ['push', '-u', 'origin', 'main', '--tags'])

  write('packages/locale-ko/index.js', '// locale fix\n')
  commit('fix(unrelated-scope): locale correction')
  write('README.md', 'Root-only change\n')
  commit('feat!: root-only change must not bump packages')
  write('packages/other/README.md', 'Documentation\n')
  commit('docs(other): documentation only')

  const head = run('git', ['rev-parse', 'HEAD'])
  const preview = await publishLocally('locale-ko', true)
  assert.equal(preview.version, '0.3.2')
  assert.equal(manifest('locale-ko').version, '0.3.1')
  assert.equal(notes('locale-ko'), history)
  assert.equal(run('git', ['rev-parse', 'HEAD']), head)
  assert.equal(readFileSync(join(cwd, 'market/index.json'), 'utf8'), emptyIndex)

  // Workspace discovery lists locale-ko before new. The production release loop
  // must bump the dependency first so the bundle's archive gets the new range.
  process.chdir(cwd)
  await releaseWorkspace({ dryRun: true, npm: { publish: false }, github: { release: false } })
  assert.equal(run('git', ['rev-parse', 'HEAD']), head)
  assert.equal(run('git', ['status', '--porcelain']), '')
  assert.equal(run('git', ['tag', '--list', '@fixture/new@*']), '')
  await releaseWorkspace({ npm: { publish: false }, github: { release: false } })
  assert.equal(process.cwd(), cwd)
  assert.equal(run('git', ['rev-list', '--count', `${head.trim()}..HEAD`]).trim(), '1')
  const releaseHead = run('git', ['rev-parse', 'HEAD'])
  for (const tag of ['@fixture/new@0.1.0', '@dungsil/dsh-plugin-locale-ko@0.3.2']) {
    assert.equal(run('git', ['rev-parse', `${tag}^{commit}`]), releaseHead)
    assert.equal(run('git', ['--git-dir', join(directory, 'remote.git'), 'rev-parse', `${tag}^{commit}`]), releaseHead)
  }
  assert.equal(run('git', ['rev-parse', 'origin/main']), releaseHead)
  assert.equal(run('git', ['status', '--porcelain']), '')
  await releaseWorkspace({ npm: { publish: false }, github: { release: false } })
  assert.equal(run('git', ['rev-parse', 'HEAD']), releaseHead)
  assert.equal(manifest('new').version, '0.1.0')
  assert.match(notes('new'), /first feature/)
  assert.doesNotMatch(notes('new'), /locale correction|0\.3\.1/)

  assert.equal(manifest('locale-ko').version, '0.3.2')
  assert.match(notes('locale-ko'), /locale correction/)
  assert.doesNotMatch(notes('locale-ko'), /first feature|root-only change/)
  assert.ok(notes('locale-ko').endsWith(history.slice(history.indexOf('## '))))
  const localeNotes = notes('locale-ko')
  const archive = join(cwd, 'release/dungsil-dsh-plugin-locale-ko/dungsil-dsh-plugin-locale-ko-0.3.2.tgz')
  const packed = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']))
  assert.equal(packed.version, '0.3.2')
  assert.deepEqual(packed.dependencies, { '@fixture/new': '^0.1.0' })
  assert.deepEqual(manifest('locale-ko').dependencies, { '@fixture/new': 'workspace:*' })
  assert.equal(run('tar', ['-xOf', archive, 'package/CHANGELOG.md']), localeNotes)

  assert.equal((await publishLocally('other')).version, undefined)
  assert.equal(manifest('other').version, '2.7.4')
  assert.equal((await publishLocally('locale-ko')).version, undefined)

  write('packages/other/index.js', '// feature\n')
  commit('feat(other): independent feature')
  assert.equal((await publishLocally('other')).version, '2.8.0')
  assert.equal(notes('locale-ko'), localeNotes)
  write('packages/locale-ko/index.js', '// breaking API\n')
  commit('refactor(locale-ko)!: incompatible locale API')
  assert.equal((await publishLocally('locale-ko')).version, '0.4.0')
  assert.match(notes('locale-ko'), /BREAKING CHANGES/)
  assert.match(notes('locale-ko'), /incompatible locale API/)
  assert.equal(manifest('other').version, '2.8.0')
  assert.equal((await publishLocally('locale-ko')).version, undefined)
  write('packages/other/index.js', '// breaking stable API\n')
  commit('refactor(other): incompatible stable API\n\nBREAKING CHANGE: remove the old stable API')
  assert.equal((await publishLocally('other')).version, '3.0.0')
  assert.deepEqual(run('git', ['tag', '--list']).trim().split('\n'), [
    '@dungsil/dsh-plugin-locale-ko@0.3.2',
    '@dungsil/dsh-plugin-locale-ko@0.4.0',
    '@fixture/new@0.1.0',
    '@fixture/other@2.7.4',
    '@fixture/other@2.8.0',
    '@fixture/other@3.0.0',
    'v0.3.1',
  ])
  assert.equal(run('git', ['status', '--porcelain']), '')
  assert.equal(run('git', ['rev-parse', 'HEAD']), run('git', ['rev-parse', 'origin/main']))

  // A first OIDC release can use the already-verified manifest version without
  // bumping it or publishing unrelated packages that have pending features.
  mkdirSync(join(cwd, 'packages', 'initial'))
  write(
    'packages/initial/package.json',
    JSON.stringify({ name: '@fixture/initial', version: '0.1.0', market: { title: 'Initial' } })
  )
  write('packages/other/index.js', '// another pending feature\n')
  commit('feat: initial package and unrelated work')
  process.chdir(cwd)
  await assert.rejects(releaseWorkspace({ version: '0.1.0' }), /requires a package name/)
  await assert.rejects(releaseWorkspace({ packageName: '@fixture/initial', version: 'latest' }), /semantic version/)
  await assert.rejects(releaseWorkspace({ packageName: '@fixture/missing' }), /Unknown public package/)
  await releaseWorkspace({
    packageName: '@fixture/initial',
    version: '0.1.0',
    npm: { publish: false },
    github: { release: false },
  })
  assert.equal(manifest('initial').version, '0.1.0')
  assert.equal(manifest('other').version, '3.0.0')
  assert.match(notes('initial'), /0\.1\.0/)
  assert.equal(run('git', ['tag', '--list', '@fixture/initial@*']).trim(), '@fixture/initial@0.1.0')
  assert.equal(run('git', ['tag', '--list', '@fixture/other@3.1.0']), '')
  assert.equal(process.cwd(), cwd)

  for (const tag of [
    '@fixture/new@0.1.0',
    '@dungsil/dsh-plugin-locale-ko@0.3.2',
    '@fixture/other@2.8.0',
    '@dungsil/dsh-plugin-locale-ko@0.4.0',
    '@fixture/other@3.0.0',
    '@fixture/initial@0.1.0',
  ]) {
    const separator = tag.lastIndexOf('@')
    const index = JSON.parse(run('git', ['show', `${tag}:market/index.json`]))
    const plugin = index.plugins.find((entry) => entry.name === tag.slice(0, separator))
    assert.equal(plugin.versions[0].version, tag.slice(separator + 1), tag)
    assert.deepEqual(plugin.versions[0].source, { type: 'npm' })
    if (plugin.name !== '@fixture/initial') assert.deepEqual(plugin.versions[0].engines, { dsh: '^0.2.1-rc.5' })
    assert.ok(run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', tag]).includes('market/index.json'), tag)
  }
  const index = JSON.parse(readFileSync(join(cwd, 'market/index.json'), 'utf8'))
  assert.deepEqual(
    index.plugins
      .find((plugin) => plugin.name === '@dungsil/dsh-plugin-locale-ko')
      .versions.map((entry) => entry.version),
    ['0.4.0', '0.3.2']
  )
  assert.equal(run('git', ['status', '--porcelain']), '')
  assert.equal(run('git', ['rev-parse', 'HEAD']), run('git', ['rev-parse', 'origin/main']))
})
