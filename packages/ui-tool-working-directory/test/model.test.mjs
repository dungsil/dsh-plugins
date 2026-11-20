import assert from 'node:assert/strict'
import test from 'node:test'
import { directoryInput, directoryModel, directoryPath } from '../src/model.ts'
import { abbreviateHomePath } from '../src/path.ts'

const args = (cd) => ({ text: (key) => (key === 'cd' ? cd : undefined) })
const initial = (phase, cd = '') => ({
  phase,
  block: { args: args(cd), argsRaw: JSON.stringify({ cd }), content: [], isError: false },
})

await test('빈 경로는 조회로 판단하고 지정한 경로의 공백은 유지한다', () => {
  for (const value of [undefined, null, '', ' \\t', 42]) assert.equal(directoryPath(value), null)
  assert.equal(directoryPath(' /with spaces/ '), ' /with spaces/ ')
})

await test('정상 인수에서 cd 값만 표시하고 잘못된 인수는 숨기지 않는다', () => {
  assert.equal(directoryInput('{"cd":"../next"}'), '../next')
  assert.equal(directoryInput('{"cd":""}'), null)
  assert.equal(directoryInput('{}'), null)
  assert.equal(directoryInput('{"cd":12}'), '{"cd":12}')
  assert.equal(directoryInput('{invalid'), '{invalid')
})

await test('실행 전과 실행 중인 상태를 정확히 구분한다', () => {
  assert.equal(directoryModel(initial('preparing', '../next')).state, 'preparing')
  const started = directoryModel(initial('start', '../next'))
  assert.equal(started.state, 'running')
  assert.equal(started.path, '../next')
  assert.equal(started.input, '{"cd":"../next"}')
})

await test('원본 결과와 구조화된 오류를 유지한다', () => {
  const props = {
    phase: 'result',
    block: {
      args: args(''), call: { argsRaw: '{"cd":""}' },
      content: [{ type: 'text', text: 'ok' }, { type: 'other', message: 'extra' }],
      isError: true, error: { code: 'ENOENT', reason: 'missing' }, meta: {},
    },
  }
  const actual = directoryModel(props)
  assert.equal(actual.state, 'error')
  assert.equal(actual.input, '{"cd":""}')
  assert.match(actual.output, /extra/u)
  assert.match(actual.output, /ENOENT/u)
})

await test('중단 상태는 일반 실패와 구분한다', () => {
  const stopped = { ...initial('result'), block: { ...initial('result').block, content: [], meta: { stopped: true } } }
  assert.equal(directoryModel(stopped).state, 'stopped')
})

await test('홈 경로 경계에서만 물결표로 축약한다', () => {
  assert.equal(abbreviateHomePath('/home/user/project', '/home/user'), '~/project')
  assert.equal(abbreviateHomePath('/home/username/project', '/home/user'), '/home/username/project')
  assert.equal(abbreviateHomePath('C:\\\\Users\\\\me\\\\project', 'C:\\\\Users\\\\me'), '~\\\\project')
})
