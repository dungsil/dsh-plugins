import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { parse, parseAllDocuments } from 'yaml'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const manifest = JSON.parse(await read('../package.json'))
const patch = parse(await read(`../${manifest.dsh.bundle.patch}`))
const plugins = patch.flatMap((operation) => operation.insert)
const packageDirectories = await readdir(new URL('../../', import.meta.url), {
  withFileTypes: true,
})
const packages = (
  await Promise.all(
    packageDirectories
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const files = await readdir(new URL(`../../${entry.name}/`, import.meta.url))
        if (!files.includes('package.json')) return null
        return {
          directory: entry.name,
          manifest: JSON.parse(await read(`../../${entry.name}/package.json`)),
        }
      })
  )
).filter(Boolean)

await test('모든 UI 플러그인을 workspace 의존성과 프리셋 등록에 포함한다', () => {
  const uiPackages = packages.filter(
    (entry) => entry.manifest.market?.category === 'ui' && entry.manifest.name.startsWith('@dungsil/dsh-plugin-')
  )
  assert.ok(uiPackages.length > 0)
  for (const { manifest: plugin } of uiPackages) {
    assert.equal(manifest.dependencies[plugin.name], 'workspace:*', plugin.name)
    assert.equal(plugins.filter((entry) => entry.name === plugin.name).length, 1, plugin.name)
  }
})

await test('등록한 모든 플러그인의 설치 의존성을 선언하고 중복 ID를 사용하지 않는다', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), plugins.map((entry) => entry.name).sort())
  assert.equal(new Set(plugins.map((entry) => entry.id)).size, plugins.length)
  assert.ok(Object.values(manifest.dependencies).every((value) => value === 'workspace:*'))
})

await test('잠금 파일이 프리셋의 모든 설치 의존성과 개발 의존성에 일치한다', async () => {
  const documents = parseAllDocuments(await read('../../../pnpm-lock.yaml'))
  for (const document of documents) assert.deepEqual(document.errors, [])
  const importer = documents
    .map((document) => document.toJS())
    .find((document) => document.importers?.['packages/preset-ui'])?.importers['packages/preset-ui']
  assert.ok(importer)
  assert.deepEqual(Object.keys(importer.dependencies).sort(), Object.keys(manifest.dependencies).sort())
  for (const [name, specifier] of Object.entries(manifest.dependencies)) {
    const entry = packages.find((entry) => entry.manifest.name === name)
    assert.ok(entry, name)
    assert.deepEqual(importer.dependencies[name], {
      specifier,
      version: `link:../${entry.directory}`,
    })
  }
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    assert.deepEqual(importer.devDependencies[name], { specifier: version, version })
  }
})

await test('각 플러그인의 기존 ID와 기본 구성을 그대로 등록한다', async () => {
  for (const plugin of plugins) {
    const entry = packages.find((entry) => entry.manifest.name === plugin.name)
    assert.ok(entry, plugin.name)
    const source = parse(await read(`../../${entry.directory}/${entry.manifest.dsh.bundle.patch}`))
    const original = source.flatMap((operation) => operation.insert ?? []).find((entry) => entry.name === plugin.name)
    assert.deepEqual(plugin, original, plugin.name)
  }
})

await test('영어와 한국어와 중국어 메타데이터를 유지한다', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    const locale = JSON.parse(await read(`../locale/${language}.json`))
    assert.deepEqual(locale.meta, {
      title: manifest.market.title[language],
      description: manifest.market.description[language],
    })
    assert.ok(Object.values(locale.meta).every((value) => typeof value === 'string' && value.trim()))
  }
})
