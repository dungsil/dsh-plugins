import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { currentWorktree } from '../src/protocol.ts'

await test('경로 비교는 Windows 드라이브와 UNC를 지원하며 워크트리 경로를 다시 쓰지 않는다', () => {
  const worktrees = [
    { path: 'C:/repo', branch: 'main' },
    { path: 'C:/repo/feature', branch: 'feature' },
  ]
  for (const cwd of ['C:\\repo\\feature\\src', 'c:/repo/feature/src', 'C:/repo/feature/']) {
    assert.equal(currentWorktree({ cwd, worktrees }), worktrees[1])
  }
  assert.equal(currentWorktree({ cwd: 'C:/repo-other', worktrees }), undefined)
  const network = { path: '//server/share/repo', branch: 'network' }
  assert.equal(currentWorktree({ cwd: '\\\\server\\share\\repo\\src', worktrees: [network] }), network)
  assert.equal(worktrees[0].path, 'C:/repo')
})

await test('POSIX 이름은 리터럴 백슬래시와 대소문자를 유지하며 루트와 중첩 경로도 계속 일치한다', () => {
  const worktrees = [
    { path: '/', branch: 'root' },
    { path: '/repo', branch: 'main' },
    { path: '/repo/with\\slash', branch: 'literal' },
  ]
  assert.equal(currentWorktree({ cwd: '/repo/with\\slash/src', worktrees }), worktrees[2])
  assert.equal(currentWorktree({ cwd: '/repo/with/slash/src', worktrees }), worktrees[1])
  assert.equal(currentWorktree({ cwd: '/Repo', worktrees }), worktrees[0])
  assert.equal(currentWorktree(undefined), undefined)
  assert.equal(currentWorktree({ cwd: '/repo', worktrees: [] }), undefined)
  const driveRoot = { path: 'C:/', branch: 'root' }
  assert.equal(currentWorktree({ cwd: 'c:\\src', worktrees: [driveRoot] }), driveRoot)
})

await test('경로 비교는 끝의 구분자만 제거하고 경로 경계를 보존한다', () => {
  for (const path of ['/repo', 'C:/repo', '//server/share/repo']) {
    const worktree = { path: path + '///', branch: 'main' }
    for (const cwd of [path, path + '////', path + '/src']) {
      assert.equal(currentWorktree({ cwd, worktrees: [worktree] }), worktree)
    }
    assert.equal(currentWorktree({ cwd: path + '-other', worktrees: [worktree] }), undefined)
  }
  const worktree = { path: '/repo//nested', branch: 'nested' }
  assert.equal(currentWorktree({ cwd: '/repo//nested///', worktrees: [worktree] }), worktree)
  assert.equal(currentWorktree({ cwd: '/repo/nested', worktrees: [worktree] }), undefined)
  assert.equal(currentWorktree({ cwd: '////', worktrees: [{ path: '/', branch: 'root' }] })?.branch, 'root')
})

await test('경로 비교는 과도한 백트래킹 없이 긴 슬래시 연속을 처리한다', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict'
        import { currentWorktree } from ${JSON.stringify(new URL('../src/protocol.ts', import.meta.url).href)}
        const slashes = '/'.repeat(100_000)
        for (const prefix of ['/repo', 'C:/repo', '//server/share/repo']) {
          const worktree = { path: prefix + slashes + 'nested', branch: 'main' }
          assert.equal(currentWorktree({ cwd: worktree.path, worktrees: [worktree] }), worktree)
          assert.equal(currentWorktree({ cwd: worktree.path + slashes, worktrees: [worktree] }), worktree)
          assert.equal(currentWorktree({ cwd: worktree.path + '-other', worktrees: [worktree] }), undefined)
        }
      `,
    ],
    { timeout: 5_000, encoding: 'utf8' }
  )
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
})
