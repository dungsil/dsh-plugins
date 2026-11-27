import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

await test('신규 패키지의 초기 버전은 첫 자동 릴리즈가 0.1.0을 발행하도록 0.0.0이다', () => {
  assert.equal(manifest.version, '0.0.0')
})

await test('DSH 호스트 패키지는 dependencies가 아닌 peerDependencies로 선언한다', () => {
  for (const name of [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-experimental-forge',
    '@deepseek-ai/dsh-experimental-forge-session',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-workspace',
  ]) {
    assert.equal(manifest.dependencies[name], undefined, name)
    assert.ok(manifest.devDependencies[name], name)
  }
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-session'], '^0.2.2-rc.3 || ^0.2.3-alpha.2')
  assert.ok(manifest.dependencies['@deepseek-ai/schemastery'])
  assert.ok(manifest.dependencies.zod)
})

await test('빌드 산출물은 DSH 호스트 패키지를 번들에 포함하지 않고 외부 임포트로 유지한다', async () => {
  let bundle
  try {
    bundle = await readFile(new URL('dist/index.js', root), 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      assert.fail('빌드 산출물(dist/index.js)이 존재하지 않습니다. 테스트 전에 pnpm build를 실행해 주세요.')
    }
    throw error
  }
  for (const specifier of ['@deepseek-ai/dsh-session', '@deepseek-ai/schemastery', 'zod']) {
    assert.match(bundle, new RegExp(`from\\s+["']${specifier}["']`))
  }
  assert.doesNotMatch(bundle, /class SessionStore/)
  assert.doesNotMatch(bundle, /#appendRecord/)
})
