import assert from 'node:assert/strict'
import test from 'node:test'
import { readDiscussion } from '../src/discussion-read.ts'
const signal = AbortSignal.timeout(10_000)
const ref = (forge) => ({ repository: { forge, host: 'example.com', owner: 'team', name: 'repo' }, number: 3 })

test('GitHub 본문과 기존 댓글 및 리뷰만 조회하고 상태나 변경 내용을 요청하지 않는다', async () => {
  const paths = []
  const result = await readDiscussion(
    ref('github'),
    async (_host, path) => {
      paths.push(path)
      if (path.includes('/comments?')) return [{ user: { login: 'alice' }, body: 'Comment' }]
      if (path.includes('/reviews?')) return [{ user: { login: 'bob' }, body: 'Review' }]
      return { number: 3, body: '# Body' }
    },
    signal
  )
  assert.equal(result.body, '# Body')
  assert.deepEqual(
    result.entries.map((entry) => entry.kind),
    ['comment', 'review']
  )
  assert.equal(paths.length, 3)
  assert.equal(
    paths.some((path) => /checks|statuses|diff|merge$/.test(path)),
    false
  )
})

test('GitLab 본문과 사용자 노트를 보존하고 시스템 노트는 제외한다', async () => {
  const result = await readDiscussion(
    ref('gitlab'),
    async (_host, path) =>
      path.includes('/notes?')
        ? [
            { system: true, body: 'system' },
            { system: false, author: { username: 'alice' }, body: 'note' },
          ]
        : path.endsWith('/approvals')
          ? { approved_by: [] }
          : { iid: 3, description: 'MR body' },
    signal
  )
  assert.equal(result.body, 'MR body')
  assert.deepEqual(result.entries, [{ author: 'alice', body: 'note', kind: 'comment' }])
})

test('페이지 제한이나 잘못된 요청 식별자를 완전한 대화로 표시하지 않는다', async () => {
  await assert.rejects(
    readDiscussion(ref('forgejo'), async () => ({ number: 4 }), signal),
    /invalid_identity/
  )
  await assert.rejects(
    readDiscussion(
      ref('github'),
      async (_host, path) =>
        path.includes('?')
          ? Array.from({ length: 100 }, () => ({ user: { login: 'alice' }, body: 'comment' }))
          : { number: 3, body: '' },
      signal
    ),
    /incomplete_response/
  )
})
