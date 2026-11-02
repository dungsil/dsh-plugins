import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = join(root, 'node_modules/@changesets/cli/bin.js')

await test('public packages keep independent versions, changelogs and tags across releases', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-release-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const writeJson = (path, value) => writeFileSync(join(cwd, path), JSON.stringify(value))
  const readJson = (path) => JSON.parse(readFileSync(join(cwd, path), 'utf8'))
  const run = (command, args) => execFileSync(command, args, { cwd, encoding: 'utf8' })
  const changeset = (command) => run(process.execPath, [cli, command])

  mkdirSync(join(cwd, '.changeset'))
  cpSync(join(root, '.changeset/config.json'), join(cwd, '.changeset/config.json'))
  symlinkSync(join(root, 'node_modules'), join(cwd, 'node_modules'), 'dir')
  writeJson('package.json', { name: 'release-fixture', private: true })
  writeFileSync(join(cwd, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - tools/*\n')
  for (const [directory, manifest] of Object.entries({
    'packages/locale-ko': { name: '@dungsil/dsh-plugin-locale-ko', version: '0.3.1' },
    'packages/other': { name: '@fixture/other', version: '2.7.4' },
    'tools/tsconfig': { name: '@fixture/tsconfig', version: '0.0.0', private: true },
  })) {
    mkdirSync(join(cwd, directory), { recursive: true })
    writeJson(`${directory}/package.json`, {
      name: manifest.name,
      version: manifest.version,
      private: manifest.private,
    })
  }
  const history = readFileSync(join(root, 'packages/locale-ko/CHANGELOG.md'), 'utf8')
  writeFileSync(join(cwd, 'packages/locale-ko/CHANGELOG.md'), history)
  run('git', ['init', '--initial-branch=main'])
  run('git', ['add', '.'])
  run('git', [
    '-c',
    'user.name=Release Test',
    '-c',
    'user.email=release@example.com',
    'commit',
    '-m',
    'Initial packages',
  ])

  writeFileSync(
    join(cwd, '.changeset/locale-fix.md'),
    '---\n"@dungsil/dsh-plugin-locale-ko": patch\n---\n\nLocale fix.\n'
  )
  changeset('version')
  assert.equal(readJson('packages/locale-ko/package.json').version, '0.3.2')
  assert.equal(readJson('packages/other/package.json').version, '2.7.4')
  const localeNotes = readFileSync(join(cwd, 'packages/locale-ko/CHANGELOG.md'), 'utf8')
  assert.match(localeNotes, /^# @dungsil\/dsh-plugin-locale-ko\n\n## 0\.3\.2/)
  assert.match(localeNotes, /Locale fix\./)
  assert.ok(localeNotes.endsWith(history.slice(history.indexOf('## '))))

  writeFileSync(join(cwd, '.changeset/other-feature.md'), '---\n"@fixture/other": minor\n---\n\nOther feature.\n')
  changeset('version')
  assert.equal(readJson('packages/locale-ko/package.json').version, '0.3.2')
  assert.equal(readJson('packages/other/package.json').version, '2.8.0')
  assert.equal(readJson('tools/tsconfig/package.json').version, '0.0.0')
  assert.equal(readFileSync(join(cwd, 'packages/locale-ko/CHANGELOG.md'), 'utf8'), localeNotes)
  assert.match(readFileSync(join(cwd, 'packages/other/CHANGELOG.md'), 'utf8'), /## 2\.8\.0[\s\S]*Other feature\./)

  changeset('tag')
  assert.deepEqual(run('git', ['tag', '--list']).trim().split('\n'), [
    '@dungsil/dsh-plugin-locale-ko@0.3.2',
    '@fixture/other@2.8.0',
  ])
})
