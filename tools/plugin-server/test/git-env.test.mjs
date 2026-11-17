import assert from 'node:assert/strict'
import test from 'node:test'
import { gitProcessEnvironment } from '../src/git-env.ts'

const repositoryKeys = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_INDEX_FILE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CEILING_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
  'GIT_REPLACE_REF_BASE',
  'GIT_ATTR_SOURCE',
]

await test('저장소 재지정 환경 키를 전부 해제한다', () => {
  const env = gitProcessEnvironment()
  for (const key of repositoryKeys) assert.equal(env[key], undefined, key)
})

await test('설정 주입과 프롬프트와 지연 fetch를 고정값으로 막는다', () => {
  const env = gitProcessEnvironment()
  assert.equal(env.GIT_CONFIG_COUNT, '0')
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
  assert.equal(env.GIT_OPTIONAL_LOCKS, '0')
  assert.equal(env.GIT_NO_LAZY_FETCH, '1')
  assert.equal(env.LC_ALL, 'C')
})

await test('추가 항목으로 도구별 스크럽과 고정값을 덮어쓴다', () => {
  const env = gitProcessEnvironment({ GH_REPO: undefined, GH_TOKEN: undefined, LC_ALL: undefined })
  assert.equal(env.GH_REPO, undefined)
  assert.equal(env.GH_TOKEN, undefined)
  assert.equal(env.LC_ALL, undefined)
  assert.equal(env.GIT_TERMINAL_PROMPT, '0')
})
