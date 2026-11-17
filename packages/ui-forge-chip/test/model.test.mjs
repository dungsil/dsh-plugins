import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { normalizeMessage } from '../src/message.ts'
import { canCreatePr, requestForCheckout } from '../src/model.ts'

function panel(overrides = {}) {
  return {
    checkout: { state: 'ready', checkout: { branch: 'topic' } },
    repository: { id: 'repository' },
    changeRequests: [],
    ...overrides,
  }
}

function request(branch, state = 'open') {
  return { url: `https://github.com/team/repo/pull/${branch}`, snapshot: { headBranch: branch, state } }
}

await test('체크아웃이나 브랜치 또는 원격 저장소가 없으면 PR 생성을 제공하지 않는다', () => {
  for (const value of [
    panel({ checkout: { state: 'loading' }, local: { base: 'origin/main' } }),
    panel({ checkout: { state: 'ready', checkout: { branch: null } }, local: { base: 'origin/main' } }),
    panel({ repository: undefined, local: { base: 'origin/main' } }),
  ])
    assert.equal(canCreatePr(value), false)
})

await test('기준 브랜치 정보가 없으면 main과 master를 추측하지 않고 PR 생성을 제공하지 않는다', () => {
  for (const branch of ['topic', 'main', 'master'])
    assert.equal(canCreatePr(panel({ checkout: { state: 'ready', checkout: { branch } } })), false)
})

await test('기준 브랜치와 다른 브랜치에만 PR 생성을 제공한다', () => {
  for (const base of ['origin/main', 'refs/remotes/origin/main']) {
    assert.equal(canCreatePr(panel({ local: { base } })), true)
    assert.equal(
      canCreatePr(panel({ local: { base }, checkout: { state: 'ready', checkout: { branch: 'main' } } })),
      false
    )
  }
})

await test('현재 브랜치와 일치하는 열린 PR만 선택하고 관련 없는 PR과 닫힌 PR은 선택하지 않는다', () => {
  const matching = request('topic')
  const unrelated = request('unrelated')
  const closed = request('topic', 'closed')
  const merged = request('topic', 'merged')
  const value = panel({ changeRequests: [unrelated, closed, merged, { url: 'missing-snapshot' }, matching] })
  assert.equal(requestForCheckout(value), matching)
  assert.equal(canCreatePr({ ...value, local: { base: 'origin/main' } }), false)
  const unmatched = panel({ changeRequests: [unrelated, closed, merged] })
  assert.equal(requestForCheckout(unmatched), undefined)
  assert.equal(canCreatePr({ ...unmatched, local: { base: 'origin/main' } }), true)
  assert.equal(requestForCheckout(panel({ checkout: { state: 'loading' }, changeRequests: [matching] })), undefined)
})

await test('모든 지원 로케일은 같은 키와 비어 있지 않은 번역 및 시장 메타데이터를 제공한다', async () => {
  const languages = ['en', 'ko', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt']
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const locales = await Promise.all(
    languages.map(async (language) =>
      JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    )
  )
  const keys = Object.keys(locales[0]).sort()
  for (const [index, locale] of locales.entries()) {
    const { meta, ...text } = locale
    assert.equal(meta.title, manifest.market.title[languages[index]])
    assert.equal(meta.description, manifest.market.description[languages[index]])
    assert.deepEqual(Object.keys(locale).sort(), keys)
    assert.ok(Object.values(text).every((value) => !/forge|포지/iu.test(value)))
    for (const [key, value] of Object.entries(text)) {
      assert.equal(typeof value, 'string', key)
      assert.ok(value.trim().length > 0, key)
    }
    for (const key of ['commit', 'commitPush', 'defaultAction', 'pr', 'viewPr', 'lookupError', 'errorPushFailed']) {
      assert.ok(keys.includes(key), key)
    }
    assert.notEqual(locale.commit, locale.commitPush)
  }
})

await test('커밋 메시지 정규화는 코드 펜스와 따옴표와 레이블을 제거하고 본문을 빈 줄로 구분한다', () => {
  assert.equal(normalizeMessage('```text\nfix: 버그를 고친다\n```'), 'fix: 버그를 고친다')
  assert.equal(normalizeMessage('Commit message: "feat: add search"'), 'feat: add search')
  assert.equal(normalizeMessage('feat: a\r\n\r\n\r\n\r\nWhy  \nmore'), 'feat: a\n\nWhy\nmore')
  assert.equal(normalizeMessage('feat: a\nbody'), 'feat: a\n\nbody')
})

await test('커밋 메시지 정규화는 빈 출력과 지나치게 긴 제목을 거부한다', () => {
  for (const output of ['', '   ', '```\n```', 'x'.repeat(101)]) assert.equal(normalizeMessage(output), undefined)
  assert.equal(normalizeMessage('x'.repeat(100)), 'x'.repeat(100))
})
