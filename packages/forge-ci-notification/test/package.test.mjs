import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import semver from 'semver'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))

await test('매니페스트는 DSH 호스트 패키지를 dependencies가 아닌 peerDependencies로 선언한다', () => {
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-experimental-forge'], undefined)
  assert.equal(manifest.dependencies['@deepseek-ai/dsh-llm'], undefined)
  assert.equal(manifest.dependencies['@deepseek-ai/cordis'], undefined)
  assert.ok(manifest.dependencies['@deepseek-ai/schemastery'])
  assert.ok(manifest.dependencies.zod)

  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '^4.1.0')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-experimental-forge'], '^0.2.2-rc.3')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-llm'], '^0.2.2-rc.3')

  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-experimental-forge'], '0.2.2-rc.3')
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-llm'], '0.2.2-rc.3')
})

await test('peerDependencies 범위는 DSH 0.2.2-rc.3부터 rc.5와 정식 버전을 허용하고 하위·다음 마이너 버전은 거부한다', () => {
  for (const name of ['@deepseek-ai/dsh-experimental-forge', '@deepseek-ai/dsh-llm']) {
    const range = manifest.peerDependencies[name]
    for (const version of ['0.2.2-rc.3', '0.2.2-rc.4', '0.2.2-rc.5', '0.2.2']) {
      assert.equal(semver.satisfies(version, range), true, `${name} ${version}`)
    }
    for (const version of ['0.2.1', '0.2.2-rc.2', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
      assert.equal(semver.satisfies(version, range), false, `${name} ${version}`)
    }
  }

  const cordisRange = manifest.peerDependencies['@deepseek-ai/cordis']
  assert.equal(semver.satisfies('4.1.0', cordisRange), true)
  assert.equal(semver.satisfies('4.2.0', cordisRange), true)
  assert.equal(semver.satisfies('4.0.5', cordisRange), false)
  assert.equal(semver.satisfies('5.0.0', cordisRange), false)
})

await test('빌드 산출물은 DSH 호스트 패키지와 런타임 의존성을 번들에 포함하지 않고 외부 임포트로 유지한다', async () => {
  let bundle
  try {
    bundle = await readFile(new URL('dist/index.js', root), 'utf8')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      assert.fail('빌드 산출물(dist/index.js)이 존재하지 않습니다. 테스트 전에 pnpm build를 실행해 주세요.')
    }
    throw error
  }
  for (const specifier of [
    '@deepseek-ai/dsh-experimental-forge',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/schemastery',
    'zod',
  ]) {
    assert.match(bundle, new RegExp(`from\\s+["']${specifier}["']`))
  }
})
