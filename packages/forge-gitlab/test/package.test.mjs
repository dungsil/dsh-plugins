import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
await test('패키지는 공식 forge를 peer로 선언하고 별도 클라이언트와 ui-vcs 의존성을 포함하지 않는다', () => {
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-experimental-forge'], '0.2.2-rc.1')
  assert.equal(manifest.dsh.client, undefined)
  assert.equal(manifest.exports['./client'], undefined)
  assert.equal(manifest.devDependencies['@dungsil/dsh-plugin-ui-vcs'], undefined)
})
await test('영어와 한국어와 중국어 메타데이터에 GitLab provider 설명을 제공한다', async () => {
  for (const lang of ['en', 'ko', 'zh']) {
    const locale = JSON.parse(await readFile(new URL(`locale/${lang}.json`, root), 'utf8'))
    assert.equal(locale.meta.title, 'GitLab')
    assert.equal(locale.meta.description, manifest.market.description[lang])
  }
})
