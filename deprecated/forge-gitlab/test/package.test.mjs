import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import semver from 'semver'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
await test('패키지는 공식 forge를 peer로 선언하고 별도 클라이언트와 ui-vcs 의존성을 포함하지 않는다', () => {
  assert.equal(
    manifest.peerDependencies['@deepseek-ai/dsh-experimental-forge'],
    '0.2.2-rc.3 || 0.2.2-rc.4 || 0.2.2-rc.5'
  )
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-subprocess'], '0.2.2-rc.3 || 0.2.2-rc.4 || 0.2.2-rc.5')
  assert.equal(manifest.dsh.client, undefined)
  assert.equal(manifest.exports['./client'], undefined)
  assert.equal(manifest.devDependencies['@dungsil/dsh-plugin-ui-vcs'], undefined)
})
await test('DSH 0.2.3부터는 공식 GitLab provider와 충돌하지 않도록 0.2.2 계열에서만 활성화된다', () => {
  // DSH app-boot evaluates engines.dsh with prereleases included.
  const satisfies = (version) => semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true })
  for (const version of ['0.2.2-rc.1', '0.2.2-rc.5', '0.2.2']) assert.equal(satisfies(version), true, version)
  for (const version of ['0.2.2-rc.0', '0.2.3-alpha.1', '0.2.3-alpha.2', '0.2.3'])
    assert.equal(satisfies(version), false, version)
})
await test('영어와 한국어와 중국어 메타데이터에 GitLab provider 설명을 제공한다', async () => {
  for (const lang of ['en', 'ko', 'zh']) {
    const locale = JSON.parse(await readFile(new URL(`locale/${lang}.json`, root), 'utf8'))
    assert.equal(locale.meta.title, 'GitLab')
    assert.equal(locale.meta.description, manifest.market.description[lang])
  }
})
