import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { currentWorktree, isWorktreeView } from '../src/protocol.ts'
import { failureCode } from '../src/errors.ts'

await test('path comparison supports Windows drives and UNC without rewriting worktree paths', () => {
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

await test('POSIX names keep literal backslashes and case while roots and nested paths still match', () => {
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

await test('path comparison trims only trailing separators and preserves path boundaries', () => {
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

await test('path comparison handles long slash runs without excessive backtracking', () => {
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

await test('worktree response validation rejects malformed values before render', () => {
  assert.equal(isWorktreeView({ cwd: '/repo', worktrees: [{ path: '/repo', branch: null }] }), true)
  assert.equal(isWorktreeView({ cwd: '/repo', worktrees: [] }), true)
  assert.equal(isWorktreeView({ cwd: '/repo', worktrees: [], needsInitialization: true }), true)
  assert.equal(isWorktreeView({ cwd: '/repo', worktrees: [], needsInitialization: false }), true)
  assert.equal(isWorktreeView({ cwd: '/repo', worktrees: [], pendingCreation: { name: '', failed: false } }), true)
  for (const value of [
    null,
    {},
    { cwd: 3, worktrees: [] },
    { cwd: '/repo', worktrees: [null] },
    { cwd: '/repo', worktrees: [{ path: '/repo', branch: 3 }] },
    ...[null, 'true', 1, {}].map((needsInitialization) => ({ cwd: '/repo', worktrees: [], needsInitialization })),
    ...[null, {}, { name: 42, failed: false }, { name: '', failed: 'no' }].map((pendingCreation) => ({
      cwd: '/repo',
      worktrees: [],
      pendingCreation,
    })),
  ]) {
    assert.equal(isWorktreeView(value), false)
  }
})

await test('failure codes retain only known diagnostics and discard raw messages and arbitrary codes', () => {
  assert.equal(failureCode({ code: 'busy', message: 'private server detail' }), 'busy')
  assert.equal(failureCode({ code: 'session/not-found' }), 'session_not_found')
  assert.equal(failureCode({ code: 'private-token-value', message: 'private detail' }), 'operation_failed')
  assert.equal(failureCode(new Error('transport failure: HTTP 401')), 'auth_required')
  assert.equal(failureCode(new Error('transport failure: HTTP 403')), 'forbidden')
  assert.equal(failureCode(new Error('transport failure: HTTP 404')), 'endpoint_missing')
  assert.equal(failureCode(new DOMException('private detail', 'TimeoutError')), 'timeout')
  assert.equal(failureCode(new TypeError('private detail')), 'connection_error')
})
