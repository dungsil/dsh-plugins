import assert from 'node:assert/strict'
import test from 'node:test'
import { footerLimit, observeFooterAncestors } from '../src/footer-sizing.ts'

function fixture(treeHeight) {
  const root = { parentElement: null, maxHeight: '471px', scrollTop: 0, getBoundingClientRect: () => ({ top: 100 }) }
  const listArea = { parentElement: root, maxHeight: 'none', scrollTop: 0, getBoundingClientRect: () => ({ top: 136 }) }
  const tree = {
    parentElement: listArea,
    maxHeight: 'none',
    clientHeight: treeHeight,
    getBoundingClientRect: () => ({ top: 136 - listArea.scrollTop - root.scrollTop }),
  }
  return { root, listArea, tree }
}

await test('기본 작업 행 한 개가 있는 경우 자체 높이 대신 기본 상위 영역의 용량을 사용한다', () => {
  const original = globalThis.getComputedStyle
  globalThis.getComputedStyle = (element) => ({ maxHeight: element.maxHeight })
  try {
    const { tree } = fixture(64.5)
    assert.equal(footerLimit(tree, 800), 217.5)
    tree.clientHeight = 32
    assert.equal(footerLimit(tree, 800), 217.5)
  } finally {
    globalThis.getComputedStyle = original
  }
})

await test('목록과 제한 상위 영역을 스크롤해도 하단 용량은 바뀌지 않는다', () => {
  const original = globalThis.getComputedStyle
  globalThis.getComputedStyle = (element) => ({ maxHeight: element.maxHeight })
  try {
    const { root, listArea, tree } = fixture(64.5)
    listArea.scrollTop = 18
    root.scrollTop = 7
    assert.equal(footerLimit(tree, 800), 217.5)
  } finally {
    globalThis.getComputedStyle = original
  }
})

await test('하단 행만 있어도 영역 용량이 0으로 줄지 않는다', () => {
  const original = globalThis.getComputedStyle
  globalThis.getComputedStyle = (element) => ({ maxHeight: element.maxHeight })
  try {
    const { tree } = fixture(0)
    assert.equal(footerLimit(tree, 800), 217.5)
    assert.equal(tree.clientHeight, 0)
  } finally {
    globalThis.getComputedStyle = original
  }
})

await test('기본 상위 제한이 없으면 뷰포트를 사용하고 상위 크기 변경을 관찰한다', () => {
  const original = globalThis.getComputedStyle
  globalThis.getComputedStyle = (element) => ({ maxHeight: element.maxHeight })
  try {
    const { root, listArea, tree } = fixture(32)
    root.maxHeight = 'none'
    assert.equal(footerLimit(tree, 800), 332)
    const observed = []
    observeFooterAncestors({ observe: (element) => observed.push(element) }, tree)
    assert.deepEqual(observed, [tree, listArea, root])
  } finally {
    globalThis.getComputedStyle = original
  }
})
