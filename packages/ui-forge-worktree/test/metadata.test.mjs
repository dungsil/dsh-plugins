import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

await test('사용자용 메타데이터는 내부 구현 이름 대신 워크트리 기능을 설명한다', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const titles = { en: 'Worktree picker', ko: '워크트리 선택기', zh: '工作树选择器' }
  for (const language of ['en', 'ko', 'zh']) {
    const { meta } = JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    assert.equal(meta.title, titles[language])
    assert.equal(manifest.market.title[language], meta.title)
    assert.equal(manifest.market.description[language], meta.description)
    assert.ok(meta.description.length > 0)
    assert.doesNotMatch(JSON.stringify(meta), /forge|포지/i)
  }
  assert.equal(manifest.description, manifest.market.description.en)
  assert.doesNotMatch(manifest.description, /forge|포지/i)
  assert.doesNotMatch(manifest.market.keywords.join(' '), /forge|포지/i)
  assert.equal(manifest.name, '@dungsil/dsh-plugin-ui-forge-worktree')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-experimental-client-ui-forge'))
})
