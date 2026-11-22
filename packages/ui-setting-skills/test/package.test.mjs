import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

await test('DSH 호스트 패키지는 dependencies가 아닌 peerDependencies로 선언해 호스트 버전을 가리지 않는다', () => {
  // DSH profiles install plugins hoisted, so a pinned copy here would replace the host's own package.
  const pinned = Object.keys(manifest.dependencies).filter((name) => name.startsWith('@deepseek-ai/dsh'))
  assert.deepEqual(pinned, [])
  for (const name of [
    '@deepseek-ai/dsh-atomic-write',
    '@deepseek-ai/dsh-home-paths',
    '@deepseek-ai/dsh-native-command',
  ]) {
    assert.equal(manifest.peerDependencies[name], '^0.2.2-rc.3 || ^0.2.3-alpha.2')
  }
})
