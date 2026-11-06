import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { copy } from '../src/copy.ts'

await test('영어와 한국어와 중국어는 같은 UI 키와 비어 있지 않은 문구를 제공한다', () => {
  const keys = Object.keys(copy.en).sort()
  for (const locale of ['en', 'ko', 'zh']) {
    assert.deepEqual(Object.keys(copy[locale]).sort(), keys)
    for (const value of Object.values(copy[locale])) assert.ok(value.trim().length > 0)
  }
})

await test('배포 목록은 사용자 지정 아이콘 없이 다국어 메타데이터와 런타임을 포함한다', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.icon, undefined)
  assert.equal(manifest.exports['./icon'], undefined)
  assert.ok(!manifest.files.includes('icon.svg'))
  for (const path of ['dist', 'locale', 'cordis.patch.yml']) assert.ok(manifest.files.includes(path))
  for (const locale of ['en', 'ko', 'zh']) {
    const data = JSON.parse(await readFile(new URL(`../locale/${locale}.json`, import.meta.url), 'utf8'))
    assert.ok(data.meta.title.trim())
    assert.ok(data.meta.description.trim())
  }
})
