import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import semver from 'semver'
import { parse } from 'yaml'

const root = new URL('../packages/', import.meta.url)
const packages = new Map()
for (const directory of await readdir(root, { withFileTypes: true })) {
  if (!directory.isDirectory()) continue
  const base = new URL(`${directory.name}/`, root)
  const manifest = JSON.parse(await readFile(new URL('package.json', base), 'utf8'))
  if (!manifest.private) packages.set(manifest.name, { base, manifest })
}

// DSH owns listVersions/updateBundle. Plugins supply installable bundle metadata
// and cleanly disposable registrations, not a separate updater or opt-in flag.
await test('all public plugins satisfy the shared in-place update package contract', async (t) => {
  assert.ok(packages.size > 0)
  for (const [name, { base, manifest }] of packages) {
    await t.test(name, async () => {
      assert.ok(semver.valid(manifest.version), 'DSH must be able to compare the installed version')
      assert.ok(semver.validRange(manifest.engines.dsh))
      for (const version of ['0.2.2-alpha.2', '0.2.2', '0.2.99']) {
        assert.ok(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), version)
      }
      for (const version of ['0.1.99', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
        assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), false, version)
      }

      const patchPath = manifest.dsh.bundle.patch
      assert.ok(manifest.files.includes(patchPath.replace(/^\.\//u, '')), 'the bundle patch must be published')
      assert.ok(manifest.files.includes('dist'), 'the replacement must include its built entry points')
      assert.equal(manifest.exports['.'], './dist/index.js')
      assert.equal(manifest.exports['./package.json'], './package.json')
      const patch = parse(await readFile(new URL(patchPath, base), 'utf8'))
      const rows = patch.flatMap((operation) => operation.insert ?? [])
      assert.equal(rows.filter((row) => row.name === name).length, 1, 'the bundle must activate its own plugin once')
      assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'component IDs must be unique')
      for (const row of rows) {
        assert.ok(row.id, 'components need stable IDs when DSH reconciles the replacement')
        assert.ok(packages.has(row.name), `${row.name} must be an independently loadable package`)
        if (row.name !== name)
          assert.ok(manifest.dependencies?.[row.name], `${row.name} must be installed with the bundle`)
      }
    })
  }
})
