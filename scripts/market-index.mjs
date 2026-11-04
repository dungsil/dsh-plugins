import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import semver from 'semver'

/** URL the published index is served from; relative icon references resolve against it. */
export const INDEX_URL = 'https://raw.githubusercontent.com/dungsil/dsh-plugins/main/market/index.json'
/** npm registry origin queried for each plugin's published versions. */
export const REGISTRY_URL = 'https://registry.npmjs.org'
/** Author shared by every plugin in this repository. */
export const AUTHOR = 'dungsil'
/** Committed index file, relative to the repository root. */
export const INDEX_FILE = 'market/index.json'
/** Index-level display title. */
export const INDEX_TITLE = { en: "DUNGSIL's DSH Plugins", ko: 'DUNGSIL의 DSH 플러그인', zh: 'DUNGSIL 的 DSH 插件' }
/** Index-level display description. */
export const INDEX_DESCRIPTION = {
  en: 'Korean-focused DeepSeek Harness plugins: Korean UI, writing skills, sidebar inbox, and secret input.',
  ko: '한국어 UI, 윤문 스킬, 사이드바 수신함, 비밀값 입력 등 DUNGSIL이 만든 DeepSeek Harness 플러그인 모음입니다.',
  zh: 'DUNGSIL 开发的 DeepSeek Harness 插件集，专注于韩语使用体验，包含韩语界面、写作技能、侧边栏收件箱和私密凭据输入。',
}
/** Categories a plugin's `market.category` may reference. */
export const CATEGORIES = {
  ui: { title: { en: 'Interface', ko: '인터페이스', zh: '界面' } },
  skills: { title: { en: 'Skills', ko: '스킬', zh: '技能' } },
  tools: { title: { en: 'Tools', ko: '도구', zh: '工具' } },
}
/** Labels a plugin's `market.labels` may reference. */
export const LABELS = {
  korean: { title: { en: 'Korean', ko: '한국어', zh: '韩语' } },
  accessibility: { title: { en: 'Accessibility', ko: '접근성', zh: '无障碍' } },
}

const FETCH_TIMEOUT_MS = 15_000
/** Registry document attempts before a lagging publish is reported as a stale index. */
export const PUBLISH_ATTEMPTS = 6
/** First delay between registry document attempts; later delays double up to the cap. */
export const PUBLISH_RETRY_DELAY_MS = 2_000
/** Upper bound of one retry delay. */
export const PUBLISH_RETRY_MAX_DELAY_MS = 8_000
/** Registry document attempts while a brand-new package's document is still propagating. */
export const MISSING_DOCUMENT_ATTEMPTS = 3
/** Delay between attempts while the registry document does not exist yet. */
export const MISSING_DOCUMENT_RETRY_DELAY_MS = 2_000
const LANGUAGE_ID = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/u
const root = fileURLToPath(new URL('../', import.meta.url))
const packagesDirectory = join(root, 'packages')
const indexPath = join(root, INDEX_FILE)

/** Turn a `repository` manifest member into the index's display-only repository record. */
export function normalizeRepository(repository) {
  if (repository === undefined || repository === null) return undefined
  const source = typeof repository === 'string' ? { url: repository } : repository
  if (typeof source.url !== 'string' || source.url.trim() === '')
    throw new Error('package.json "repository" must provide a URL')
  const url = source.url.replace(/^git\+/u, '').replace(/\.git$/u, '')
  return {
    url,
    ...(source.directory === undefined ? {} : { directory: source.directory }),
  }
}

/** Read every workspace package manifest, sorted by name so discovery is deterministic. */
export function readLocalPackages(directory = packagesDirectory) {
  const manifests = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    let text
    try {
      text = readFileSync(join(directory, entry.name, 'package.json'), 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    manifests.push(JSON.parse(text))
  }
  return manifests.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

function localizedText(value, at) {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${at} must be a non-empty string or an object of localized strings`)
  const entries = Object.entries(value)
  if (entries.length === 0) throw new Error(`${at} must not be empty`)
  for (const [language, text] of entries) {
    if (!LANGUAGE_ID.test(language)) throw new Error(`${at}.${language} must be keyed by a lowercase language id`)
    if (typeof text !== 'string' || text.trim() === '') throw new Error(`${at}.${language} must be a non-empty string`)
  }
  if (!Object.hasOwn(value, 'en')) throw new Error(`${at} must contain en`)
  return value
}

function marketMetadata(manifest) {
  const { market, name } = manifest
  if (market === undefined || market === null)
    throw new Error(
      `Package ${String(name)} is missing the "market" metadata block required for the plugin market index`
    )
  const title = localizedText(market.title, `${name} market.title`)
  const description =
    market.description === undefined ? undefined : localizedText(market.description, `${name} market.description`)
  if (market.category !== undefined && !Object.hasOwn(CATEGORIES, market.category))
    throw new Error(`${name} market.category ${JSON.stringify(market.category)} is not declared in the index metadata`)
  const labels = market.labels ?? []
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string' || !Object.hasOwn(LABELS, label)))
    throw new Error(`${name} market.labels must be an array of ids declared in the index metadata`)
  if (new Set(labels).size !== labels.length) throw new Error(`${name} market.labels must not repeat a label`)
  const keywords = market.keywords ?? []
  if (!Array.isArray(keywords) || keywords.some((keyword) => typeof keyword !== 'string'))
    throw new Error(`${name} market.keywords must be an array of strings`)
  if (market.order !== undefined && (typeof market.order !== 'number' || !Number.isFinite(market.order)))
    throw new Error(`${name} market.order must be a finite number`)
  return { title, description, category: market.category, labels, keywords, order: market.order }
}

function versionRecords(name, document) {
  const versions = document.versions
  if (versions === null || typeof versions !== 'object' || Array.isArray(versions))
    throw new Error(`${name}: the npm registry document has no versions map`)
  const time = document.time === null || typeof document.time !== 'object' ? {} : document.time
  const records = Object.keys(versions)
    .filter((version) => version !== '0.0.0-stage')
    .map((version) => {
      if (semver.valid(version) === null)
        throw new Error(`${name}@${version}: the npm registry lists an invalid version`)
      const published = time[version]
      const timestamp = typeof published === 'string' ? Date.parse(published) : Number.NaN
      if (!Number.isFinite(timestamp))
        throw new Error(`${name}@${version}: the npm registry document has no publish time`)
      const dsh = versions[version]?.engines?.dsh
      if (dsh !== undefined && (typeof dsh !== 'string' || dsh.trim() === ''))
        throw new Error(`${name}@${version}: engines.dsh must be a non-empty string`)
      return {
        version,
        publishTimestamp: Math.floor(timestamp / 1000),
        source: { type: 'npm' },
        ...(dsh === undefined ? {} : { engines: { dsh } }),
      }
    })
  // Format 1 requires descending SemVer precedence; the same value serializes the same file.
  return records.sort(compareVersions)
}

function compareVersions(left, right) {
  const precedence = semver.rcompare(left.version, right.version)
  return precedence !== 0 ? precedence : left.version < right.version ? -1 : 1
}

function marketPlugin(manifest, market = marketMetadata(manifest)) {
  const repository = normalizeRepository(manifest.repository)
  return {
    name: manifest.name,
    ...(market.title === undefined ? {} : { title: market.title }),
    ...(market.description === undefined ? {} : { description: market.description }),
    ...(manifest.homepage === undefined ? {} : { homepage: manifest.homepage }),
    ...(repository === undefined ? {} : { repository }),
    author: AUTHOR,
    metadata: {
      ...(market.category === undefined ? {} : { category: market.category }),
      keywords: market.keywords,
      labels: market.labels,
      sortKeys: {},
    },
  }
}

function compareEntries(left, right) {
  const leftOrder = left.order ?? Number.POSITIVE_INFINITY
  const rightOrder = right.order ?? Number.POSITIVE_INFINITY
  if (leftOrder !== rightOrder) return leftOrder - rightOrder
  if (left.name < right.name) return -1
  if (left.name > right.name) return 1
  return 0
}

/**
 * Build a format-1 market index from local package manifests and npm registry documents.
 * Packages missing from `registryDocuments` are unpublished (404) and are skipped with a warning.
 * Preserve recorded release timestamps when npm later reports a different publication time.
 */
export function buildMarketIndex({
  packages,
  registryDocuments,
  previousIndex,
  indexUrl = INDEX_URL,
  onWarning = () => {},
}) {
  if (!URL.canParse(indexUrl)) throw new Error(`Index URL ${JSON.stringify(indexUrl)} must be an absolute URL`)
  const entries = []
  for (const manifest of packages) {
    if (manifest.private || manifest.market === false) continue
    const { name } = manifest
    if (typeof name !== 'string' || name === '') throw new Error('Every package manifest must have a name')
    const market = marketMetadata(manifest)
    const document = registryDocuments instanceof Map ? registryDocuments.get(name) : registryDocuments[name]
    if (document === undefined || document === null) {
      onWarning(`${name} is not published on npm; it is omitted from the market index`)
      continue
    }
    const versions = versionRecords(name, document)
    if (versions.length === 0) {
      onWarning(`${name} has no published versions; it is omitted from the market index`)
      continue
    }
    const previous = previousIndex?.plugins.find((entry) => entry.name === name)
    for (const version of versions) {
      const recorded = previous?.versions.find((entry) => entry.version === version.version)
      if (recorded) version.publishTimestamp = recorded.publishTimestamp
    }
    entries.push({
      name,
      order: market.order,
      plugin: { ...marketPlugin(manifest, market), versions },
    })
  }
  entries.sort(compareEntries)
  return {
    format: 1,
    title: INDEX_TITLE,
    description: INDEX_DESCRIPTION,
    metadata: { categories: CATEGORIES, labels: LABELS },
    plugins: entries.map((entry) => entry.plugin),
  }
}

/** Record a successfully published package without querying npm or changing other version histories. */
export function recordRelease({ index, packages, packageName, publishTimestamp = Math.floor(Date.now() / 1000) }) {
  const manifest = packages.find((pkg) => !pkg.private && pkg.name === packageName)
  if (!manifest) throw new Error(`Unknown public package: ${packageName}`)
  if (manifest.market === false)
    return { ...index, plugins: index.plugins.filter((plugin) => plugin.name !== packageName) }
  if (manifest.version === '0.0.0-stage') return index
  const versions = (index.plugins.find((plugin) => plugin.name === packageName)?.versions ?? []).filter(
    (entry) => entry.version !== '0.0.0-stage'
  )
  const published = versions.find((entry) => entry.version === manifest.version) ?? {
    version: manifest.version,
    publishTimestamp,
    source: { type: 'npm' },
    ...(manifest.engines?.dsh === undefined ? {} : { engines: { dsh: manifest.engines.dsh } }),
  }
  const plugins = [
    ...index.plugins.filter((plugin) => plugin.name !== packageName),
    {
      ...marketPlugin(manifest),
      versions: [...versions.filter((entry) => entry.version !== manifest.version), published].sort(compareVersions),
    },
  ]
  return {
    ...index,
    plugins: plugins
      .map((plugin) => ({
        name: plugin.name,
        order: packages.find((pkg) => pkg.name === plugin.name)?.market?.order,
        plugin,
      }))
      .sort(compareEntries)
      .map((entry) => entry.plugin),
  }
}

async function fetchRegistryDocument(name) {
  const url = `${REGISTRY_URL}/${encodeURIComponent(name)}`
  let response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`Cannot fetch ${url}: ${error.message}`)
  }
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Cannot fetch ${url}: HTTP ${response.status}`)
  return response.json()
}

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function listsVersion(document, version) {
  const versions = document.versions
  return (
    versions !== null && typeof versions === 'object' && !Array.isArray(versions) && Object.hasOwn(versions, version)
  )
}

/**
 * Fetch the npm registry document of every public package. A brand-new package's document 404s
 * until npm finishes propagating it, and an existing document can lag behind the local publish
 * for a few seconds, so both cases are polled with bounded retries. A package that is still
 * missing after the bound keeps its current behavior (warning and omission); a document that
 * still lacks the local version is returned unchanged and the caller is warned that the index
 * may be stale.
 */
export async function generateRegistryDocuments({
  packages,
  fetchDocument = fetchRegistryDocument,
  sleep = defaultSleep,
  onWarning = () => {},
  attempts = PUBLISH_ATTEMPTS,
  retryDelayMs = PUBLISH_RETRY_DELAY_MS,
  maxRetryDelayMs = PUBLISH_RETRY_MAX_DELAY_MS,
  missingDocumentAttempts = MISSING_DOCUMENT_ATTEMPTS,
  missingDocumentRetryDelayMs = MISSING_DOCUMENT_RETRY_DELAY_MS,
}) {
  const documents = new Map()
  for (const manifest of packages) {
    if (manifest.private || manifest.market === false) continue
    const { name, version } = manifest
    const checkPublishedVersion = typeof version === 'string' && version !== ''
    let document = (await fetchDocument(name)) ?? null
    // A package's very first release creates its registry document after publish returns.
    for (let attempt = 1; document === null && attempt < missingDocumentAttempts; attempt += 1) {
      await sleep(missingDocumentRetryDelayMs)
      document = (await fetchDocument(name)) ?? null
    }
    // An existing document can lag behind the local publish by a few seconds.
    let delay = retryDelayMs
    for (let attempt = 1; attempt < attempts; attempt += 1) {
      if (!checkPublishedVersion || document === null || listsVersion(document, version)) break
      await sleep(delay)
      delay = Math.min(delay * 2, maxRetryDelayMs)
      document = (await fetchDocument(name)) ?? null
    }
    if (checkPublishedVersion && document !== null && !listsVersion(document, version))
      onWarning(`${name}@${version} is not visible on npm yet; the market index may be stale`)
    documents.set(name, document)
  }
  return documents
}

async function generateIndex(releasePackage) {
  const packages = readLocalPackages()
  const warnings = []
  const previousIndex = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : undefined
  const index = releasePackage
    ? recordRelease({ index: previousIndex, packages, packageName: releasePackage })
    : buildMarketIndex({
        packages,
        registryDocuments: await generateRegistryDocuments({
          packages,
          onWarning: (message) => warnings.push(message),
        }),
        previousIndex,
        indexUrl: INDEX_URL,
        onWarning: (message) => warnings.push(message),
      })
  for (const warning of warnings) console.warn(`warning: ${warning}`)
  try {
    parseMarketIndex(index, INDEX_URL)
  } catch (error) {
    throw new Error(`Generated market index violates format 1: ${error.message}`)
  }
  return index
}

/**
 * Serialize an index through the repository formatter. With `moveTo`, the formatted temp file
 * replaces that path atomically; otherwise the formatted text is returned.
 */
function formatIndex(index, { moveTo } = {}) {
  const marketDirectory = join(root, 'market')
  mkdirSync(marketDirectory, { recursive: true })
  const temporaryPath = join(marketDirectory, `.market-index-${process.pid}-${randomUUID()}.json`)
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
    const result = spawnSync(`pnpm exec oxfmt --write "${temporaryPath}"`, {
      cwd: root,
      encoding: 'utf8',
      shell: true,
    })
    if (result.status !== 0)
      throw new Error(`oxfmt failed to format the market index: ${(result.stderr || result.stdout).trim()}`)
    if (moveTo !== undefined) {
      renameSync(temporaryPath, moveTo)
      return readFileSync(moveTo, 'utf8')
    }
    return readFileSync(temporaryPath, 'utf8')
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function driftMessage(committed, expected) {
  const committedLines = committed.split('\n')
  const expectedLines = expected.split('\n')
  let position = 0
  while (position < committedLines.length && committedLines[position] === expectedLines[position]) position += 1
  return [
    `${INDEX_FILE} is out of date; run \`pnpm market:index\` and commit the result.`,
    `  first difference at line ${position + 1}:`,
    `  committed: ${committedLines[position] ?? '<end of file>'}`,
    `  expected:  ${expectedLines[position] ?? '<end of file>'}`,
  ].join('\n')
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { check: { type: 'boolean', default: false }, release: { type: 'string' } },
  })
  try {
    const index = await generateIndex(values.release)
    if (values.check) {
      const expected = formatIndex(index)
      let committed
      try {
        committed = readFileSync(indexPath, 'utf8')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        console.error(`${INDEX_FILE} does not exist; run \`pnpm market:index\` to generate it.`)
        process.exitCode = 1
        process.exit()
      }
      if (committed !== expected) {
        console.error(driftMessage(committed, expected))
        process.exitCode = 1
      } else {
        console.log(`${INDEX_FILE} is up to date.`)
      }
    } else {
      formatIndex(index, { moveTo: indexPath })
      console.log(`Wrote ${INDEX_FILE} with ${index.plugins.length} plugins.`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
