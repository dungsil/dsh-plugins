import assert from 'node:assert/strict'
import test from 'node:test'
import { Window } from 'happy-dom'

const window = new Window()
Object.assign(globalThis, { document: window.document, NodeFilter: window.NodeFilter })
const { createExactCountMarker } = await import('../src/count-dom.ts')

function label(text) {
  const element = document.createElement('span')
  element.textContent = text
  document.body.replaceChildren(element)
  return element
}

const exactSpans = (element) => [...element.querySelectorAll('[data-dsh-count-exact]')].map((span) => span.textContent)

await test('한 텍스트에 있는 모든 정확한 수를 분리하고 전체 문구는 바꾸지 않는다', () => {
  const element = label('~83.9만 (839,013) / 104.9만 (1,048,576) 사용')
  const marker = createExactCountMarker()
  marker.mark([element])
  assert.deepEqual(exactSpans(element), ['(839,013)', '(1,048,576)'])
  assert.equal(element.textContent, '~83.9만 (839,013) / 104.9만 (1,048,576) 사용')
  marker.mark([element])
  assert.equal(element.querySelectorAll('[data-dsh-count-exact]').length, 2)
})

await test('괄호 안 문구나 천 단위 구분이 없는 숫자는 분리하지 않는다', () => {
  const element = label('출력 150 (추론 1,234) · 9,999 (42)')
  const marker = createExactCountMarker()
  marker.mark([element])
  assert.deepEqual(exactSpans(element), [])
})

await test('소유자가 텍스트를 바꾸면 이전 분리를 버리고 새 텍스트를 다시 분리한다', () => {
  const element = label('사용량 83.9만 (839,150)')
  const owned = element.firstChild
  const marker = createExactCountMarker()
  marker.mark([element])
  owned.nodeValue = '사용량 84만 (840,000)'
  marker.mark([element])
  assert.deepEqual(exactSpans(element), ['(840,000)'])
  assert.equal(element.textContent, '사용량 84만 (840,000)')
})

await test('restore는 소유자의 텍스트 노드를 원래 문구로 되돌린다', () => {
  const element = label('~83.9만 (839,013) / 104.9만 (1,048,576)')
  const owned = element.firstChild
  const marker = createExactCountMarker()
  marker.mark([element])
  marker.restore()
  assert.equal(element.childNodes.length, 1)
  assert.equal(element.firstChild, owned)
  assert.equal(owned.nodeValue, '~83.9만 (839,013) / 104.9만 (1,048,576)')
})
