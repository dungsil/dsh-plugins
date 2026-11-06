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

void test('사용자 표시 메타데이터는 내부 연동 이름을 노출하지 않고 PR 미리보기 제목을 사용한다', async () => {
  const manifest = await json('../package.json')
  const titles = { en: 'PR Preview', ko: 'PR 미리보기', zh: 'PR 预览' }
  const visible = [manifest.description, ...manifest.market.keywords]
  for (const [lang, title] of Object.entries(titles)) {
    const locale = await json(`../locale/${lang}.json`)
    assert.equal(manifest.market.title[lang], title)
    assert.equal(locale.meta.title, title)
    visible.push(
      manifest.market.title[lang],
      manifest.market.description[lang],
      locale.meta.title,
      locale.meta.description,
      locale.unsupported
    )
    assert.match(locale.hint, /Forgejo/)
    assert.match(locale.cli_missing, /Forgejo/)
  }
  for (const text of visible) {
    assert.equal(typeof text, 'string')
    assert.doesNotMatch(text, /\bforge\b/i)
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
