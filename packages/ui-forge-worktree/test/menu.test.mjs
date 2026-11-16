import assert from 'node:assert/strict'
import test from 'node:test'
import { rowsOf } from '../src/menu.ts'

const en = {
  create: 'New worktree',
  current: 'Current branch',
  origin: 'Original checkout',
  detached: 'Detached HEAD',
  loading: 'Loading worktree…',
  more: 'Load more',
  worktreesLoading: 'Loading existing worktrees…',
  worktreesUnavailable: 'Could not load existing worktrees.',
}
const t = (key) => en[key]
const list = (worktrees, current = '/repo') => ({
  origin: { directory: '/repo', root: '/repo', branch: 'main' },
  current,
  worktrees,
})
const input = (overrides = {}) => ({
  blocked: false,
  list: list([]),
  listError: false,
  requested: false,
  t,
  visibleCount: 5,
  ...overrides,
})

await test('위로 열리는 메뉴는 더 불러오기, 기존 워크트리, 원래 체크아웃, 새 워크트리 순으로 표시한다', () => {
  const rows = rowsOf(
    input({
      list: list(
        [
          { path: '/repo/recent', branch: 'recent' },
          { path: '/repo/old', branch: 'old' },
        ],
        '/repo'
      ),
    })
  )
  assert.deepEqual(
    rows.map((row) => [row.kind, row.text]),
    [
      ['existing', 'old'],
      ['existing', 'recent'],
      ['origin', 'main'],
      ['new', 'New worktree'],
    ]
  )
  assert.equal(rows.at(-1).id, 'new')
})

await test('더 불러오기 행은 오래된 워크트리보다 위에 놓인다', () => {
  const rows = rowsOf(
    input({
      list: list(
        Array.from({ length: 7 }, (_, index) => ({ path: `/repo/w${index}`, branch: `w${index}` })),
        '/repo'
      ),
    })
  )
  assert.deepEqual(
    rows.map((row) => row.kind),
    ['more', 'existing', 'existing', 'existing', 'existing', 'existing', 'origin', 'new']
  )
  assert.deepEqual(
    rows.filter((row) => row.kind === 'existing').map((row) => row.text),
    ['w4', 'w3', 'w2', 'w1', 'w0']
  )
})

await test('페이지를 벗어난 현재 워크트리도 선택 표시를 유지한다', () => {
  const rows = rowsOf(
    input({
      list: list(
        [
          { path: '/repo/hidden', branch: 'hidden' },
          ...Array.from({ length: 6 }, (_, index) => ({ path: `/repo/w${index}`, branch: `w${index}` })),
        ],
        '/repo/hidden'
      ),
    })
  )
  const checked = rows.filter((row) => row.current)
  assert.deepEqual(
    checked.map((row) => row.id),
    ['worktree:/repo/hidden']
  )
})

await test('원래 체크아웃이 아닌 워크트리에서는 원래 체크아웃 배지를 표시한다', () => {
  const rows = rowsOf(
    input({
      list: list([{ path: '/repo/feature', branch: 'feature' }], '/repo/feature'),
    })
  )
  const origin = rows.find((row) => row.kind === 'origin')
  assert.equal(origin.badge, 'Original checkout')
  assert.equal(origin.current, false)
})

await test('목록 조회 중이거나 실패하면 선택할 수 없는 안내 행을 표시한다', () => {
  const loading = rowsOf(input({ list: undefined }))
  assert.deepEqual(
    loading.map((row) => [row.kind, row.text, row.disabled]),
    [
      ['info', 'Loading existing worktrees…', true],
      ['origin', 'Loading worktree…', undefined],
      ['new', 'New worktree', false],
    ]
  )
  const failed = rowsOf(input({ listError: true }))
  assert.equal(failed[0].text, 'Could not load existing worktrees.')
  assert.equal(failed[0].disabled, true)
})

await test('새 워크트리 요청 중에는 생성 행을 선택 상태로 표시하고 차단 상태에서는 비활성화한다', () => {
  const requested = rowsOf(input({ requested: true }))
  assert.equal(requested.at(-1).current, true)
  assert.equal(requested.find((row) => row.kind === 'origin').current, false)
  const blocked = rowsOf(input({ blocked: true }))
  assert.equal(blocked.at(-1).disabled, true)
})
