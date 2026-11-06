import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const manifest = JSON.parse(await read('../package.json'))
const tools = ['agent-browser', 'tool-diff-note', 'tool-secret-request']

await test('별도 런타임 없이 기존 도구 세 개를 workspace 의존성으로 묶는다', () => {
  assert.equal(manifest.name, '@dungsil/dsh-preset-tools')
  assert.deepEqual(
    manifest.dependencies,
    Object.fromEntries(tools.map((tool) => [`@dungsil/dsh-plugin-${tool}`, 'workspace:*']))
  )
  assert.deepEqual(manifest.files, ['locale', 'cordis.patch.yml'])
  assert.equal(manifest.main, undefined)
  assert.equal(manifest.exports['.'], undefined)
  assert.deepEqual(manifest.dsh, { bundle: { patch: './cordis.patch.yml' } })
  assert.equal(manifest.market.category, 'tools')
})

await test('프리셋 패치는 각 도구의 기존 플러그인 ID와 구성을 그대로 사용한다', async () => {
  const header = '- insert:\n'
  const patches = await Promise.all(
    tools.map(async (tool) => {
      const patch = (await read(`../../${tool}/cordis.patch.yml`)).replaceAll('\r\n', '\n')
      assert.ok(patch.includes(header))
      assert.ok(patch.includes(`name: '@dungsil/dsh-plugin-${tool}'`))
      return patch.split(header)
    })
  )
  const patch = (await read(`../${manifest.dsh.bundle.patch}`)).replaceAll('\r\n', '\n')
  assert.equal(
    patch,
    patches.map(([prefix]) => prefix).join('') + header + patches.map(([, insert]) => insert).join('')
  )
  const ids = [...patch.matchAll(/^    - id: (.+)$/gm)].map((match) => match[1])
  assert.equal(ids.length, tools.length)
  assert.equal(new Set(ids).size, ids.length)
})

await test('영어와 한국어와 중국어 메타데이터가 마켓 정보와 일치한다', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    const locale = JSON.parse(await read(`../locale/${language}.json`))
    assert.deepEqual(locale, {
      meta: {
        title: manifest.market.title[language],
        description: manifest.market.description[language],
      },
    })
    assert.ok(Object.values(locale.meta).every((value) => typeof value === 'string' && value.trim()))
    assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
  }
})
