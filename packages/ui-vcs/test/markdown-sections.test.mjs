import assert from 'node:assert/strict'
import test from 'node:test'
import { splitMarkdownSections } from '../src/markdown-sections.ts'

test('description sections preserve Markdown and nest headings without splitting code, quotes, tables or math', () => {
  const code = '```md\n# Not a section\n```'
  const quote = '> ## Quoted heading\n> Quoted text'
  const math = '$$\n# Not a section either\n$$'
  const text = `Introduction\r\n\r\n## Summary\r\nBody\r\n\r\n${code}\n\n${quote}\n\n${math}\n\n### Child\n| A | B |\n| - | - |\n| 1 | 2 |\n\n#### Grandchild\nNested text\n\n## Changes\nLast body\n`
  const result = splitMarkdownSections(text)
  assert.equal(result.introduction, 'Introduction\r\n\r\n')
  assert.deepEqual(
    result.sections.map((section) => section.heading),
    ['## Summary', '## Changes']
  )
  assert.equal(result.sections[0].content, `\r\nBody\r\n\r\n${code}\n\n${quote}\n\n${math}\n\n`)
  assert.equal(result.sections[0].children[0].heading, '### Child')
  assert.equal(result.sections[0].children[0].content, '\n| A | B |\n| - | - |\n| 1 | 2 |\n\n')
  assert.deepEqual(result.sections[0].children[0].children, [
    { heading: '#### Grandchild', content: '\nNested text\n\n', children: [] },
  ])
  assert.equal(result.sections[1].content, '\nLast body\n')
  assert.deepEqual(result.sections[1].children, [])
})

test('setext headings, shared references and heading-free descriptions remain available', () => {
  const text =
    'Summary\n=======\n[Link][shared] and note[^note].\n\nReview\n------\nDone.\n\n[shared]: https://example.com/path\n[^note]: Shared footnote\n'
  const result = splitMarkdownSections(text)
  assert.equal(result.introduction, '')
  assert.equal(result.sections[0].heading, 'Summary\n=======')
  assert.equal(result.sections[0].children[0].heading, 'Review\n------')
  assert.equal(result.definitions, '[shared]: https://example.com/path\n\n[^note]: Shared footnote')
  for (const plain of ['', 'Plain **description** without headings.\n\nAnother paragraph.']) {
    assert.deepEqual(splitMarkdownSections(plain), { introduction: plain, sections: [], definitions: '' })
  }
})
