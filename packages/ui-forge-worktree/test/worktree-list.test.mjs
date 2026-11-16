import assert from 'node:assert/strict'
import test from 'node:test'
import { capWorktrees, parseWorktreeList, worktreePage } from '../src/worktree-list.ts'

const root = process.platform === 'win32' ? 'C:\\repo' : '/repo'

await test('NUL porcelain에서 특수 문자를 포함한 경로와 분리된 HEAD를 읽는다', () => {
  const unusual = `${root}/space\nquote"`
  const entries = parseWorktreeList(
    `worktree ${root}\0HEAD abc\0branch refs/heads/main\0\0worktree ${unusual}\0HEAD def\0detached\0\0`
  )
  assert.deepEqual(entries, [
    { path: root, branch: 'main' },
    { path: unusual, branch: null },
  ])
})

await test('bare와 prunable 및 상대 경로 항목을 목록에서 제외한다', () => {
  const result = parseWorktreeList(
    `worktree ${root}\0bare\0\0worktree ${root}/gone\0prunable missing\0\0worktree relative\0branch refs/heads/a\0\0`
  )
  assert.deepEqual(result, [])
})

await test('상한 밖의 현재 워크트리는 목록에 남긴다', () => {
  const entries = Array.from({ length: 55 }, (_, index) => ({ index }))
  const result = capWorktrees(entries, entries[54])
  assert.equal(result.length, 50)
  assert.equal(result[49], entries[54])
})

await test('각 페이지에서 현재 워크트리를 빠뜨리지 않는다', () => {
  const entries = Array.from({ length: 9 }, (_, index) => ({ index }))
  assert.deepEqual(worktreePage(entries, entries[7], 1), [entries[7], entries[5], entries[6], entries[8]])
})
