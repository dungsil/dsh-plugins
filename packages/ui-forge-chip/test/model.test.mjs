import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { primaryOperation, requestForCheckout } from '../src/model.ts'

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

void test('체크아웃이나 브랜치 또는 원격 저장소가 없으면 기본 작업은 커밋이다', () => {
  for (const value of [
    panel({ checkout: { state: 'loading' } }),
    panel({ checkout: { state: 'ready', checkout: {} } }),
    panel({ checkout: { state: 'ready', checkout: { branch: null } } }),
    panel({ repository: undefined }),
  ])
    assert.equal(primaryOperation(value), 'commit')
})

void test('기준 브랜치 정보가 없으면 main과 master를 추측하지 않고 푸시를 선택한다', () => {
  for (const branch of ['topic', 'main', 'master', 'release']) {
    assert.equal(primaryOperation(panel({ checkout: { state: 'ready', checkout: { branch } } })), 'push')
  }
})

void test('기준 브랜치와 현재 브랜치가 같으면 푸시하고 다르면 PR을 선택한다', () => {
  for (const base of ['origin/main', 'refs/remotes/origin/main']) {
    assert.equal(primaryOperation(panel({ local: { base } })), 'pr')
    assert.equal(
      primaryOperation(panel({ local: { base }, checkout: { state: 'ready', checkout: { branch: 'main' } } })),
      'push'
    )
  }
})

void test('현재 브랜치와 일치하는 열린 PR만 선택하고 관련 없는 PR과 닫힌 PR은 선택하지 않는다', () => {
  const matching = request('topic')
  const unrelated = request('unrelated')
  const closed = request('topic', 'closed')
  const merged = request('topic', 'merged')
  const value = panel({ changeRequests: [unrelated, closed, merged, { url: 'missing-snapshot' }, matching] })
  assert.equal(requestForCheckout(value), matching)
  assert.equal(primaryOperation(value), 'pr')
  const unmatched = panel({ changeRequests: [unrelated, closed, merged] })
  assert.equal(requestForCheckout(unmatched), undefined)
  assert.equal(primaryOperation(unmatched), 'push')
  assert.equal(requestForCheckout(panel({ checkout: { state: 'loading' }, changeRequests: [matching] })), undefined)
})

void test('영어와 한국어와 중국어 로케일은 같은 키와 비어 있지 않은 번역을 제공한다', async () => {
  const locales = await Promise.all(
    ['en', 'ko', 'zh'].map(async (language) =>
      JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    )
  )
  const keys = Object.keys(locales[0]).sort()
  for (const locale of locales) {
    assert.deepEqual(Object.keys(locale).sort(), keys)
    assert.equal(locale.panel, locale.viewPr)
    assert.ok(Object.values(locale).every((value) => !/forge|포지/iu.test(value)))
    for (const [key, value] of Object.entries(locale)) {
      assert.equal(typeof value, 'string', key)
      assert.ok(value.trim().length > 0, key)
    }
    for (const key of [
      'commit',
      'push',
      'pr',
      'viewPr',
      'updatePr',
      'lookupError',
      'promptCommit',
      'promptPush',
      'promptPr',
    ]) {
      assert.ok(keys.includes(key), key)
    }
    assert.equal(new Set(['promptCommit', 'promptPush', 'promptPr'].map((key) => locale[key])).size, 3)
  }
})
