import assert from 'node:assert/strict'
import test from 'node:test'
import { readChanges } from '../src/changes.ts'

const patch = 'diff --git a/a b/a\n+x\n'
const source = () => ({
  github: async () => ({ changedFiles: 1, files: [{ path: 'a' }], diff: patch }),
  gitlab: async () => ({ overflow: false, changes: [{ old_path: 'a', new_path: 'a', diff: '@@\n+x' }] }),
  forge: async () => ({ files: [{ filename: 'a' }], changedFiles: 1, diff: patch }),
})

for (const provider of ['github', 'gitlab', 'gitea', 'forgejo']) {
  await test(`${provider}의 파일과 diff를 완전한 변경 스냅샷으로 반환한다`, async () => {
    const result = await readChanges({ ...source(), provider })
    assert.equal(result.complete, true)
    assert.deepEqual(result.files, [{ path: 'a' }])
    assert.match(result.diff, /\+x/)
  })
}

await test('GitHub의 누락된 파일과 크기 제한을 초과한 diff를 불완전하게 표시한다', async () => {
  for (const github of [
    async () => ({ changedFiles: 2, files: [{ path: 'a' }], diff: patch }),
    async () => ({ changedFiles: 1, files: [{ path: 'a' }], diff: 'x'.repeat(1_000_001) }),
    async () => ({ changedFiles: 1, files: [{ path: 'a' }], diff: '' }),
  ])
    assert.equal((await readChanges({ ...source(), provider: 'github', github })).complete, false)
})

await test('GitLab의 overflow와 누락된 diff를 불완전하게 표시한다', async () => {
  for (const gitlab of [
    async () => ({ overflow: true, changes: [] }),
    async () => ({ overflow: false, changes: [{ old_path: 'a', new_path: 'a' }] }),
    async () => ({ changes: [] }),
  ])
    assert.equal((await readChanges({ ...source(), provider: 'gitlab', gitlab })).complete, false)
})

await test('GitLab의 메타데이터로 확인된 빈 변경을 표시하고 제한된 diff는 거부한다', async () => {
  for (const metadata of [
    { renamed_file: true },
    { new_file: true },
    { deleted_file: true },
    { a_mode: '100644', b_mode: '100755' },
  ]) {
    const gitlab = async () => ({ overflow: false, changes: [{ old_path: 'a', new_path: 'b', diff: '', ...metadata }] })
    assert.equal((await readChanges({ ...source(), provider: 'gitlab', gitlab })).complete, true)
    const capped = async () => ({
      overflow: false,
      changes: [{ old_path: 'a', new_path: 'b', diff: '', ...metadata, too_large: true }],
    })
    assert.equal((await readChanges({ ...source(), provider: 'gitlab', gitlab: capped })).complete, false)
  }
  for (const file of [
    { old_path: 'a', new_path: 'b', diff: '' },
    { old_path: 'a', new_path: 'a', diff: '', renamed_file: true },
    { old_path: 'a', new_path: 'a', diff: '', a_mode: 'bad', b_mode: 'invalid' },
  ]) {
    const gitlab = async () => ({ overflow: false, changes: [file] })
    assert.equal((await readChanges({ ...source(), provider: 'gitlab', gitlab })).complete, false)
  }
})

await test('Forge의 파일 상한, 누락된 파일과 실패한 diff를 불완전하게 표시한다', async () => {
  for (const forge of [
    async () => ({ files: Array.from({ length: 101 }, () => ({ filename: 'a' })), changedFiles: 101, diff: patch }),
    async () => ({ files: [{ filename: 'a' }], changedFiles: 2, diff: patch }),
    async () => ({ files: [{ filename: 'a' }], diff: patch }),
    async () => {
      throw new Error('denied')
    },
  ])
    assert.equal((await readChanges({ ...source(), provider: 'forgejo', forge })).complete, false)
})
