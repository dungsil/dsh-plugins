import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

// Explicit, offline maintenance step. Never fetch or execute remote source in CI.
const directory = process.argv[2]
if (!directory) throw new Error('Usage: node scripts/snapshot-upstream.mjs <upstream-checkout>')
const root = new URL('../packages/locale-ko/', import.meta.url)
const upstream = JSON.parse(await readFile(new URL('upstream.json', root), 'utf8'))
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: directory,
  encoding: 'utf8',
}).trim()
if (revision !== upstream.revision) throw new Error(`Expected upstream ${upstream.revision}, got ${revision}`)
const dictionaries = {}
for (const [namespace, path] of Object.entries(upstream.namespaces)) {
  const { en } = await import(pathToFileURL(resolve(directory, path)).href)
  if (!en) throw new Error(`Missing English dictionary: ${path}`)
  dictionaries[namespace] = en
}
await writeFile(new URL('test/en.json', root), JSON.stringify(dictionaries, null, 2) + '\n')
console.log(`Saved ${Object.keys(dictionaries).length} upstream namespaces`)
