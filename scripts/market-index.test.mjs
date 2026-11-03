import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { MarketIndexError, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import {
  AUTHOR,
  CATEGORIES,
  INDEX_URL,
  LABELS,
  buildMarketIndex,
  generateRegistryDocuments,
  normalizeRepository,
  recordRelease,
} from './market-index.mjs'

const root = new URL('../', import.meta.url)

const market = (overrides = {}) => ({
  order: 1,
  title: { en: 'Plugin', ko: '플러그인' },
  description: { en: 'Fixture plugin.', ko: '테스트 플러그인입니다.' },
  category: 'ui',
  labels: ['korean'],
  keywords: ['fixture'],
  ...overrides,
})

const alpha = {
  name: '@fixture/alpha',
  repository: {
    type: 'git',
    url: 'git+https://github.com/fixture/plugins.git',
    directory: 'packages/alpha',
  },
  market: market({
    order: 2,
    title: { en: 'Alpha', ko: '알파' },
    category: 'ui',
    labels: ['korean'],
    keywords: ['alpha', 'ui'],
  }),
}

const beta = {
  name: '@fixture/beta',
  repository: {
    type: 'git',
    url: 'git+https://github.com/fixture/plugins.git',
    directory: 'packages/beta',
  },
  market: market({
    order: 1,
    title: { en: 'Beta', ko: '베타' },
    category: 'skills',
    labels: ['accessibility'],
    keywords: ['beta', 'skills'],
  }),
}

const unpublished = {
  name: '@fixture/unpublished',
  repository: {
    type: 'git',
    url: 'git+https://github.com/fixture/plugins.git',
    directory: 'packages/unpublished',
  },
  market: market({ order: 3, title: { en: 'Unpublished', ko: '미배포' } }),
}

const alphaDocument = {
  versions: {
    '0.2.0': { name: alpha.name, engines: { dsh: '^0.2.1-rc.5' } },
    '1.0.0': { name: alpha.name },
    '0.1.0': { name: alpha.name, engines: { dsh: '0.2.1-rc.2' } },
    '0.1.0-stage': { name: alpha.name },
  },
  time: {
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-01-04T00:00:00.000Z',
    '0.1.0': '2026-01-02T00:00:00.000Z',
    '0.1.0-stage': '2026-01-01T00:00:00.000Z',
    '0.2.0': '2026-01-03T00:00:00.000Z',
    '1.0.0': '2026-01-04T00:00:00.000Z',
  },
}

const registryDocuments = new Map([
  [alpha.name, alphaDocument],
  [
    beta.name,
    {
      versions: { '2.0.0': { name: beta.name } },
      time: { created: '2026-02-01T00:00:00.000Z', '2.0.0': '2026-02-01T12:34:56.789Z' },
    },
  ],
])

const timestamp = (iso) => Math.floor(Date.parse(iso) / 1000)

const fixtureBuild = (packages = [alpha, beta, unpublished], documents = registryDocuments) => {
  const warnings = []
  const index = buildMarketIndex({
    packages,
    registryDocuments: documents,
    indexUrl: INDEX_URL,
    onWarning: (message) => warnings.push(message),
  })
  return { index, warnings }
}

await test('buildMarketIndex maps market metadata and npm registry versions to format 1', () => {
  const { index, warnings } = fixtureBuild()

  assert.equal(index.format, 1)
  assert.deepEqual(index.title, { en: "DUNGSIL's DSH Plugins", ko: 'DUNGSIL의 DSH 플러그인' })
  assert.deepEqual(index.description, {
    en: 'Korean-focused DeepSeek Harness plugins: Korean UI, writing skills, sidebar inbox, and secret input.',
    ko: '한국어 UI, 윤문 스킬, 사이드바 수신함, 비밀값 입력 등 DUNGSIL이 만든 DeepSeek Harness 플러그인 모음입니다.',
  })
  assert.deepEqual(index.metadata, { categories: CATEGORIES, labels: LABELS })
  assert.equal(Object.hasOwn(index.metadata, 'sortKeys'), false)

  // market.order wins over the package name: beta is declared first.
  assert.deepEqual(
    index.plugins.map((plugin) => plugin.name),
    [beta.name, alpha.name]
  )

  const [betaPlugin, alphaPlugin] = index.plugins
  assert.deepEqual(betaPlugin.title, { en: 'Beta', ko: '베타' })
  assert.deepEqual(betaPlugin.description, { en: 'Fixture plugin.', ko: '테스트 플러그인입니다.' })
  assert.equal(betaPlugin.author, AUTHOR)
  assert.deepEqual(betaPlugin.repository, {
    url: 'https://github.com/fixture/plugins',
    directory: 'packages/beta',
  })
  assert.deepEqual(betaPlugin.metadata, {
    category: 'skills',
    keywords: ['beta', 'skills'],
    labels: ['accessibility'],
    sortKeys: {},
  })
  assert.deepEqual(betaPlugin.versions, [
    {
      version: '2.0.0',
      publishTimestamp: timestamp('2026-02-01T12:34:56.789Z'),
      source: { type: 'npm' },
    },
  ])

  // Versions are sorted by descending SemVer precedence; created/modified are not versions.
  assert.deepEqual(
    alphaPlugin.versions.map((version) => version.version),
    ['1.0.0', '0.2.0', '0.1.0', '0.1.0-stage']
  )
  assert.equal(new Set(alphaPlugin.versions.map((version) => version.version)).size, alphaPlugin.versions.length)
  const byVersion = new Map(alphaPlugin.versions.map((version) => [version.version, version]))
  assert.equal(byVersion.get('1.0.0').publishTimestamp, timestamp('2026-01-04T00:00:00.000Z'))
  assert.equal(byVersion.get('0.2.0').publishTimestamp, timestamp('2026-01-03T00:00:00.000Z'))
  assert.equal(byVersion.get('0.1.0').publishTimestamp, timestamp('2026-01-02T00:00:00.000Z'))
  assert.equal(byVersion.get('0.1.0-stage').publishTimestamp, timestamp('2026-01-01T00:00:00.000Z'))
  assert.deepEqual(byVersion.get('1.0.0').source, { type: 'npm' })
  assert.equal(Object.hasOwn(byVersion.get('1.0.0'), 'engines'), false)
  assert.deepEqual(byVersion.get('0.2.0').engines, { dsh: '^0.2.1-rc.5' })
  assert.deepEqual(byVersion.get('0.1.0').engines, { dsh: '0.2.1-rc.2' })

  // The unpublished package is omitted, and the omission is reported once.
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /@fixture\/unpublished/)

  // The generator output must satisfy the official format-1 validator.
  const parsed = parseMarketIndex(index, INDEX_URL)
  assert.deepEqual(
    parsed.plugins.map((plugin) => plugin.name),
    [beta.name, alpha.name]
  )
  assert.deepEqual(
    parsed.plugins[1].versions.map((version) => version.version),
    ['1.0.0', '0.2.0', '0.1.0', '0.1.0-stage']
  )

  // Identical inputs serialize to identical text, so `--check` has no drift.
  assert.equal(JSON.stringify(fixtureBuild().index), JSON.stringify(index))
})

await test('recordRelease adds only the confirmed version and preserves history through registry reconciliation', () => {
  const { index } = fixtureBuild()
  const before = structuredClone(index)
  const manifest = { ...alpha, version: '0.3.0', engines: { dsh: '^0.2.1-rc.5' } }
  const packages = [manifest, beta, unpublished]
  const publishTimestamp = timestamp('2026-03-01T12:34:56.000Z')
  const updated = recordRelease({ index, packages, packageName: alpha.name, publishTimestamp })
  const plugin = updated.plugins.find((entry) => entry.name === alpha.name)
  const published = {
    version: '0.3.0',
    publishTimestamp,
    source: { type: 'npm' },
    engines: { dsh: '^0.2.1-rc.5' },
  }
  assert.deepEqual(plugin.versions, [before.plugins[1].versions[0], published, ...before.plugins[1].versions.slice(1)])
  assert.deepEqual(updated.plugins[0], before.plugins[0])
  assert.deepEqual(index, before)
  assert.doesNotThrow(() => parseMarketIndex(updated, INDEX_URL))
  assert.deepEqual(
    recordRelease({ index: updated, packages, packageName: alpha.name, publishTimestamp: publishTimestamp + 60 }),
    updated
  )

  const propagated = new Map(registryDocuments)
  propagated.set(alpha.name, {
    versions: { ...alphaDocument.versions, '0.3.0': manifest },
    time: { ...alphaDocument.time, '0.3.0': '2026-03-01T12:35:00.000Z' },
  })
  assert.deepEqual(buildMarketIndex({ packages, registryDocuments: propagated, previousIndex: updated }), updated)

  // A package absent from the old index is added only when it is the release target.
  const first = { ...unpublished, version: '0.1.0', market: market({ order: 0 }) }
  const initial = recordRelease({
    index: updated,
    packages: [manifest, beta, first],
    packageName: first.name,
    publishTimestamp,
  })
  assert.equal(initial.plugins[0].name, first.name)
  assert.deepEqual(initial.plugins[0].versions, [{ version: '0.1.0', publishTimestamp, source: { type: 'npm' } }])
  assert.deepEqual(initial.plugins.slice(1), updated.plugins)
  assert.doesNotThrow(() => parseMarketIndex(initial, INDEX_URL))
})

await test('buildMarketIndex skips private packages and 404 registry entries', () => {
  const privatePackage = {
    name: '@fixture/private',
    private: true,
    repository: { type: 'git', url: 'git+https://github.com/fixture/plugins.git' },
    market: market({ order: 0 }),
  }
  const warnings = []
  const index = buildMarketIndex({
    // A plain object must be accepted like the Map the CLI passes.
    packages: [privatePackage, beta, unpublished],
    registryDocuments: { [beta.name]: registryDocuments.get(beta.name), [unpublished.name]: null },
    indexUrl: INDEX_URL,
    onWarning: (message) => warnings.push(message),
  })

  assert.deepEqual(
    index.plugins.map((plugin) => plugin.name),
    [beta.name]
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /@fixture\/unpublished/)
})

await test('generateRegistryDocuments retries a lagging publish until the local version appears', async () => {
  const lagging = {
    versions: { '0.1.0': { name: '@fixture/alpha' } },
    time: { '0.1.0': '2026-02-01T00:00:00.000Z' },
  }
  const propagated = {
    versions: { '0.1.0': { name: '@fixture/alpha' }, '0.2.0': { name: '@fixture/alpha' } },
    time: { '0.1.0': '2026-02-01T00:00:00.000Z', '0.2.0': '2026-03-01T00:00:00.000Z' },
  }
  const responses = [lagging, propagated]
  const fetched = []
  const sleeps = []
  const warnings = []
  const documents = await generateRegistryDocuments({
    packages: [{ name: '@fixture/alpha', version: '0.2.0' }],
    fetchDocument: async (name) => {
      fetched.push(name)
      return responses.shift()
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
    },
    retryDelayMs: 1_000,
    maxRetryDelayMs: 4_000,
    onWarning: (message) => warnings.push(message),
  })

  assert.deepEqual(fetched, ['@fixture/alpha', '@fixture/alpha'])
  assert.deepEqual(sleeps, [1_000])
  assert.deepEqual(warnings, [])
  assert.equal(documents.get('@fixture/alpha'), propagated)
})

await test('generateRegistryDocuments reports a stale index when the local version never appears', async () => {
  const stale = {
    versions: { '0.1.0': { name: '@fixture/alpha' } },
    time: { '0.1.0': '2026-02-01T00:00:00.000Z' },
  }
  const fetched = []
  const sleeps = []
  const warnings = []
  const documents = await generateRegistryDocuments({
    packages: [{ name: '@fixture/alpha', version: '0.2.0' }],
    fetchDocument: async (name) => {
      fetched.push(name)
      return stale
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
    },
    attempts: 4,
    retryDelayMs: 1_000,
    maxRetryDelayMs: 4_000,
    onWarning: (message) => warnings.push(message),
  })

  assert.equal(fetched.length, 4)
  assert.deepEqual(sleeps, [1_000, 2_000, 4_000])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /@fixture\/alpha@0\.2\.0 is not visible on npm yet; the market index may be stale/)
  assert.equal(documents.get('@fixture/alpha'), stale)
})

await test('generateRegistryDocuments retries a missing document until a first release appears', async () => {
  const published = {
    versions: { '0.1.0': { name: '@fixture/new' } },
    time: { '0.1.0': '2026-04-01T00:00:00.000Z' },
  }
  const responses = [null, published]
  const fetched = []
  const sleeps = []
  const warnings = []
  const newPackage = {
    name: '@fixture/new',
    version: '0.1.0',
    market: market({ order: 1, title: { en: 'New', ko: '신규' } }),
  }
  const documents = await generateRegistryDocuments({
    packages: [newPackage],
    fetchDocument: async (name) => {
      fetched.push(name)
      return responses.shift()
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
    },
    missingDocumentRetryDelayMs: 500,
    onWarning: (message) => warnings.push(message),
  })

  assert.deepEqual(fetched, ['@fixture/new', '@fixture/new'])
  assert.deepEqual(sleeps, [500])
  assert.deepEqual(warnings, [])
  assert.equal(documents.get('@fixture/new'), published)

  // The first release is already listed by the index generated by that release.
  const index = buildMarketIndex({
    packages: [newPackage],
    registryDocuments: documents,
    indexUrl: INDEX_URL,
  })
  assert.deepEqual(
    index.plugins.map((plugin) => plugin.name),
    ['@fixture/new']
  )
})

await test('generateRegistryDocuments excludes a package whose document never appears', async () => {
  const privatePackage = { name: '@fixture/private', private: true, version: '9.9.9' }
  const unpublished = { name: '@fixture/unpublished', version: '0.1.0', market: market({ order: 1 }) }
  const fetched = []
  const sleeps = []
  const warnings = []
  const documents = await generateRegistryDocuments({
    packages: [privatePackage, unpublished],
    fetchDocument: async (name) => {
      fetched.push(name)
      return null
    },
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
    },
    missingDocumentRetryDelayMs: 500,
    onWarning: (message) => warnings.push(message),
  })

  assert.deepEqual(fetched, ['@fixture/unpublished', '@fixture/unpublished', '@fixture/unpublished'])
  assert.deepEqual(sleeps, [500, 500])
  assert.deepEqual(warnings, [])
  assert.equal(documents.get('@fixture/unpublished'), null)
  assert.equal(documents.has('@fixture/private'), false)

  // Exhausting the bound keeps the existing omission warning from buildMarketIndex.
  const buildWarnings = []
  const index = buildMarketIndex({
    packages: [privatePackage, unpublished],
    registryDocuments: documents,
    indexUrl: INDEX_URL,
    onWarning: (message) => buildWarnings.push(message),
  })
  assert.deepEqual(index.plugins, [])
  assert.equal(buildWarnings.length, 1)
  assert.match(buildWarnings[0], /@fixture\/unpublished is not published on npm/)
})

await test('buildMarketIndex fails clearly when a public package has no market metadata', () => {
  assert.throws(
    () =>
      buildMarketIndex({
        packages: [
          {
            name: '@fixture/bare',
            repository: { type: 'git', url: 'git+https://github.com/fixture/plugins.git' },
          },
        ],
        registryDocuments: new Map(),
        indexUrl: INDEX_URL,
      }),
    /@fixture\/bare is missing the "market" metadata block/
  )
})

await test('buildMarketIndex rejects market ids that the index does not declare', () => {
  const unknownCategory = {
    ...beta,
    name: '@fixture/unknown-category',
    market: market({ category: 'extension' }),
  }
  assert.throws(
    () => fixtureBuild([unknownCategory], registryDocuments),
    /@fixture\/unknown-category market\.category "extension" is not declared/
  )

  const unknownLabel = {
    ...beta,
    name: '@fixture/unknown-label',
    market: market({ labels: ['spanish'] }),
  }
  assert.throws(() => fixtureBuild([unknownLabel], registryDocuments), /market\.labels must be an array of ids/)
})

await test('normalizeRepository strips the git transport prefix and .git suffix', () => {
  assert.deepEqual(normalizeRepository(alpha.repository), {
    url: 'https://github.com/fixture/plugins',
    directory: 'packages/alpha',
  })
  assert.deepEqual(normalizeRepository('git+https://github.com/dungsil/dsh-plugins.git'), {
    url: 'https://github.com/dungsil/dsh-plugins',
  })
  assert.equal(normalizeRepository(undefined), undefined)
})

await test('format 1 rejects duplicate versions that a generator must never emit', () => {
  const { index } = fixtureBuild()
  const duplicated = structuredClone(index)
  duplicated.plugins[0].versions.push({ ...duplicated.plugins[0].versions[0] })
  assert.throws(() => parseMarketIndex(duplicated, INDEX_URL), MarketIndexError)
})

await test('committed market index is a valid format-1 index of this workspace', async () => {
  const committed = JSON.parse(await readFile(new URL('market/index.json', root), 'utf8'))
  assert.doesNotThrow(() => parseMarketIndex(committed, INDEX_URL))
  const parsed = parseMarketIndex(committed, INDEX_URL)

  // The committed text is already in the order the validator would return.
  const parsedByName = new Map(parsed.plugins.map((plugin) => [plugin.name, plugin]))
  for (const plugin of committed.plugins) {
    const validated = parsedByName.get(plugin.name)
    assert.ok(validated, `${plugin.name} must survive validation`)
    assert.deepEqual(
      plugin.versions.map((version) => version.version),
      validated.versions.map((version) => version.version)
    )
    for (const version of plugin.versions) {
      assert.ok(Number.isInteger(version.publishTimestamp) && version.publishTimestamp >= 0)
      assert.deepEqual(version.source, { type: 'npm' })
      if (version.engines !== undefined) assert.equal(typeof version.engines.dsh, 'string')
    }
  }

  const local = new Map()
  for (const entry of await readdir(new URL('packages/', root), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const manifest = JSON.parse(await readFile(new URL(`packages/${entry.name}/package.json`, root), 'utf8'))
    if (!manifest.private) local.set(manifest.name, manifest)
  }

  assert.ok(parsed.plugins.length > 0)
  for (const plugin of parsed.plugins) {
    const manifest = local.get(plugin.name)
    assert.ok(manifest, `${plugin.name} must be a local non-private package`)
    assert.ok(manifest.market, `${plugin.name} must declare market metadata`)
    assert.deepEqual(plugin.title, manifest.market.title)
    assert.deepEqual(plugin.description, manifest.market.description)
    assert.equal(plugin.author, AUTHOR)
    assert.deepEqual(plugin.repository, normalizeRepository(manifest.repository))
    assert.equal(plugin.metadata.category, manifest.market.category)
    assert.deepEqual(plugin.metadata.keywords, manifest.market.keywords)
    assert.deepEqual(plugin.metadata.labels, manifest.market.labels)
    assert.ok(
      Object.hasOwn(parsed.metadata.categories, manifest.market.category),
      `${manifest.market.category} must be declared`
    )
    for (const label of manifest.market.labels) assert.ok(Object.hasOwn(parsed.metadata.labels, label))
  }

  assert.deepEqual(Object.keys(parsed.metadata.categories).sort(), ['skills', 'tools', 'ui'])
  assert.deepEqual(Object.keys(parsed.metadata.labels).sort(), ['accessibility', 'korean'])

  const orders = parsed.plugins.map((plugin) => local.get(plugin.name).market.order)
  assert.deepEqual(
    orders,
    [...orders].sort((left, right) => left - right)
  )

  // Every package published so far is listed; unpublished packages stay out until a release adds them.
  for (const name of [
    '@dungsil/dsh-plugin-locale-ko',
    '@dungsil/dsh-plugin-korean-ime',
    '@dungsil/dsh-plugin-yoonmoon',
    '@dungsil/dsh-plugin-i-have-adhd',
    '@dungsil/dsh-plugin-sidebar-inbox',
  ])
    assert.ok(parsedByName.has(name), `${name} must be in the market index`)
})
