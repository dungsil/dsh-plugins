import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
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
await test('all public bundles satisfy the shared in-place update package contract', async (t) => {
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
      if (manifest.exports['.'] !== undefined) {
        assert.ok(manifest.files.includes('dist'), 'the replacement must include its built entry points')
        assert.equal(manifest.exports['.'], './dist/index.js')
      }
      assert.equal(manifest.exports['./package.json'], './package.json')
      assert.ok(manifest.files.includes('locale'), 'plugin metadata must be published')
      assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
      for (const language of ['en', 'ko', 'zh']) {
        const { meta } = JSON.parse(await readFile(new URL(`locale/${language}.json`, base), 'utf8'))
        assert.ok(meta.title.trim(), `${language} title must not be blank`)
        assert.ok(meta.description.trim(), `${language} description must not be blank`)
      }
      const patch = parse(await readFile(new URL(patchPath, base), 'utf8'))
      const rows = patch.flatMap((operation) => operation.insert ?? [])
      assert.equal(
        rows.filter((row) => row.name === name).length,
        manifest.exports['.'] === undefined ? 0 : 1,
        'only runtime plugins activate themselves'
      )
      assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, 'component IDs must be unique')
      const dependencies = new Set(Object.keys(manifest.dependencies ?? {}))
      for (const dependency of dependencies) {
        for (const child of Object.keys(packages.get(dependency)?.manifest.dependencies ?? {})) dependencies.add(child)
      }
      for (const row of rows) {
        assert.ok(row.id, 'components need stable IDs when DSH reconciles the replacement')
        if (!packages.has(row.name))
          assert.doesNotThrow(
            () => createRequire(new URL('package.json', base)).resolve(row.name),
            `${row.name} must be an independently loadable package`
          )
        if (row.name !== name) assert.ok(dependencies.has(row.name), `${row.name} must be installed with the bundle`)
      }
    })
  }
})

await test('UI preset activates the seven existing bundles without its own runtime plugin', async () => {
  const { base, manifest } = packages.get('@dungsil/dsh-preset-ui')
  const names = [
    '@dungsil/dsh-plugin-locale-ko',
    '@dungsil/dsh-plugin-ui-sidebar-inbox',
    '@dungsil/dsh-plugin-ui-model-settings',
    '@dungsil/dsh-plugin-ui-setting-skills',
    '@dungsil/dsh-plugin-ui-worktree',
    '@dungsil/dsh-plugin-ui-model-picker',
    '@dungsil/dsh-plugin-ui-turn-rail-left',
  ]
  assert.deepEqual(new Set(Object.keys(manifest.dependencies)), new Set(names))
  assert.equal(manifest.exports['.'], undefined)
  assert.equal(manifest.exports['./client'], undefined)
  assert.equal(manifest.dsh.client, undefined)
  assert.equal(manifest.files.includes('dist'), false)
  const expected = []
  for (const name of names) {
    const bundle = packages.get(name)
    const patch = parse(await readFile(new URL(bundle.manifest.dsh.bundle.patch, bundle.base), 'utf8'))
    expected.push(...patch.flatMap((operation) => operation.insert ?? []))
  }
  const patch = parse(await readFile(new URL(manifest.dsh.bundle.patch, base), 'utf8'))
  assert.deepEqual(patch, [{ insert: expected }])
})

await test('task model API works without a client and the UI bundle activates its API dependency', async () => {
  const apiName = '@dungsil/dsh-plugin-model-settings'
  const uiName = '@dungsil/dsh-plugin-ui-model-settings'
  const api = packages.get(apiName)
  const ui = packages.get(uiName)
  assert.equal(api.manifest.dsh.client, undefined)
  assert.equal(api.manifest.exports['./client'], undefined)
  assert.equal(api.manifest.dependencies?.[uiName], undefined)
  assert.equal(ui.manifest.exports['./client'], './dist/client.js')
  assert.equal(ui.manifest.dsh.client.platform, 'web')
  assert.ok(ui.manifest.dependencies[apiName])
  const patch = parse(await readFile(new URL(ui.manifest.dsh.bundle.patch, ui.base), 'utf8'))
  assert.deepEqual(
    patch.flatMap((operation) => operation.insert ?? []).map(({ id, name }) => ({ id, name })),
    [
      { id: 'dungsil-ui-model-settings', name: uiName },
      { id: 'dungsil-model-settings', name: apiName },
    ]
  )
})

await test('worktree UI bundle owns creation and loads the settings UI without the model tool', async () => {
  const { base, manifest } = packages.get('@dungsil/dsh-plugin-ui-worktree')
  assert.ok(manifest.peerDependencies['@deepseek-ai/dsh-config-editor'])
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  const patch = parse(await readFile(new URL(manifest.dsh.bundle.patch, base), 'utf8'))
  const rows = patch.flatMap((operation) => operation.insert ?? [])
  assert.deepEqual(
    rows.map(({ name }) => name),
    [manifest.name]
  )
})
