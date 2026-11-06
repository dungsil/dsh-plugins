import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))

void test('세 로케일은 같은 번역 키와 비어 있지 않은 문구를 제공한다', async () => {
  const locales = await Promise.all(['en', 'ko', 'zh'].map((lang) => json(`../locale/${lang}.json`)))
  const flatten = (value, prefix = '') =>
    Object.entries(value).flatMap(([key, text]) =>
      typeof text === 'object' ? flatten(text, `${prefix}${key}.`) : [[`${prefix}${key}`, text]]
    )
  const reference = flatten(locales[0])
    .map(([key]) => key)
    .sort()
  for (const locale of locales) {
    const entries = flatten(locale)
    assert.deepEqual(entries.map(([key]) => key).sort(), reference)
    for (const [key, value] of entries) assert.ok(typeof value === 'string' && value.trim(), key)
  }
})

void test('새 번들은 공식 Forge 번들을 제거하거나 같은 서비스와 탭을 재등록하지 않는다', async () => {
  const manifest = await json('../package.json')
  assert.equal(manifest.name, '@dungsil/dsh-plugin-ui-forge-pulls')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  for (const name of ['@deepseek-ai/dsh-experimental-forge', '@deepseek-ai/dsh-experimental-forge-session']) {
    assert.ok(manifest.peerDependencies[name])
  }
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(patch, /id: dungsil-ui-forge-pulls/)
  assert.doesNotMatch(patch, /disabled:|remove:|id: forge(?:\s|$)/)
})
