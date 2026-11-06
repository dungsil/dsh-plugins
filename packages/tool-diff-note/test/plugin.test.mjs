import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../dist/index.js'

await test('도구 런타임을 통해 추가와 삭제를 포함한 정확한 과거 조각과 근거를 기록한다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  const fork = ctx.plugin(plugin)
  await fork
  const run = async (args) => {
    const batch = await ctx.tools.execute({
      calls: [{ type: 'tool-call', id: 'note-test', name: 'diff_note', arguments: JSON.stringify(args) }],
      signal: new AbortController().signal,
    })
    assert.equal(batch.results.length, 1)
    assert.equal(batch.results[0].callId, 'note-test')
    return batch.results[0].result
  }
  const args = {
    path: 'src/client.tsx',
    old_text: '  <section>\r\n    한글\r\n  </section>\r\n',
    new_text: '  <Modal open>\r\n    한글\r\n  </Modal>\r\n',
    note: '기본 모달을 사용해 포커스와 닫기 동작을 맞췄습니다.',
  }
  const recorded = await run(args)
  assert.equal(recorded.isError, false)
  assert.deepEqual(recorded.value, args)
  assert.deepEqual(recorded.meta, args)
  assert.ok(recorded.content[0].text.includes(args.note))
  assert.ok(!recorded.content[0].text.includes(args.old_text), 'the model acknowledgement need not repeat code')
  args.new_text = 'a later edit'
  assert.notEqual(recorded.meta.new_text, args.new_text, 'the recorded snapshot must not follow later changes')
  for (const [old_text, new_text] of [
    ['', 'created\n'],
    ['deleted\n', ''],
  ]) {
    const result = await run({ ...args, old_text, new_text })
    assert.equal(result.isError, false)
    assert.equal(result.meta.old_text, old_text)
    assert.equal(result.meta.new_text, new_text)
  }
  for (const invalid of [
    { note: '  ' },
    { path: '\nfile' },
    { old_text: args.new_text },
    { new_text: 'x'.repeat(20_001) },
    { note: 'x'.repeat(2001) },
    { old_text: null },
  ])
    assert.equal((await run({ ...args, ...invalid })).isError, true)
  await fork.dispose()
  assert.equal(ctx.tools.get('diff_note'), undefined)
  await ctx.plugin(plugin)
  assert.equal((await run(args)).isError, false)
})

await test('최종 답변 직전 사용 지침과 도구 설명을 등록하고 해제와 재로드 후에도 중복하지 않는다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  const baseline = await ctx.systemPrompt.assemble()
  const fork = ctx.plugin(plugin)
  await fork

  const assembled = await ctx.systemPrompt.assemble()
  const sections = assembled.sections.filter((section) => section.name === 'dungsil:diff-note')
  assert.equal(sections.length, 1)
  const text = sections[0].text
  assert.match(text, /only after completing the requested implementation or fixes and all feasible validation/u)
  assert.match(text, /immediately before the final response/u)
  assert.match(text, /Never call it while work is in progress/u)
  assert.match(text, /code you actually changed during this task/u)
  assert.match(text, /skip the tool when no such decision needs explanation/u)
  assert.match(text, /unchanged code, use file-and-line links and code quotations instead of inventing a change/u)
  assert.match(text, /exact before\/after fragments/u)
  assert.match(text, /immediately below the shared DSH diff block/u)
  assert.match(text, /Report validation limits in the final response/u)
  assert.match(text, /does not replace testing or that response/u)
  const schema = ctx.tools.schemas().find((tool) => tool.name === 'diff_note')
  assert.ok(schema)
  assert.match(schema.description, /only immediately before the final response/u)
  assert.match(schema.description, /after requested changes and feasible validation are complete; never during work/u)
  assert.match(schema.description, /Never include secrets/u)
  assert.match(schema.parameters.properties.note.description, /conversation language/u)

  await fork.dispose()
  assert.deepEqual(await ctx.systemPrompt.assemble(), baseline)
  assert.equal(ctx.tools.get('diff_note'), undefined)
  const reloaded = ctx.plugin(plugin)
  await reloaded
  assert.deepEqual(await ctx.systemPrompt.assemble(), assembled)
  assert.equal(ctx.tools.schemas().filter((tool) => tool.name === 'diff_note').length, 1)
  await reloaded.dispose()
  assert.deepEqual(await ctx.systemPrompt.assemble(), baseline)
})

await test('영어, 한국어, 중국어에 모든 차이 카드 레이블이 있다', async () => {
  const locales = await Promise.all(
    ['en', 'ko', 'zh'].map(async (language) =>
      JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    )
  )
  for (const locale of locales) {
    assert.deepEqual(Object.keys(locale.ui).sort(), Object.keys(locales[0].ui).sort())
    assert.ok(Object.values(locale.ui).every((value) => typeof value === 'string' && value.trim()))
    assert.ok(locale.ui.expand.includes('{count}'))
    assert.ok(locale.ui.expandAria.includes('{count}'))
  }
})

await test('도구 뷰는 원본 스냅샷과 번역을 DSH DiffBlock에 전달하고 설명과 파일 열기를 유지한다', async () => {
  const require = createRequire(import.meta.url)
  let client
  let View
  let receivedDiff
  const opened = []
  let openFile
  let active = 'ko'
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          client = factory((name) => {
            // Render the public tool view with real React; only native chrome and
            // the live locale subscription are replaced for this static render.
            if (name === 'react') return { ...React, useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() }
            if (name === '@deepseek-ai/dsh-client-ui-primitives')
              return new Proxy(
                {},
                {
                  get: (_target, key) => {
                    if (key === 'DiffBlock')
                      return (props) => {
                        receivedDiff = props
                        return React.createElement('div', { 'data-native-diff': '' })
                      }
                    if (key === 'Button')
                      return ({ children, size: _size, variant: _variant, ...props }) => {
                        openFile = props.onClick
                        return React.createElement('button', props, children)
                      }
                    return () => null
                  },
                }
              )
            return require(name)
          })
        },
      },
    },
  })
  client.apply({
    locale: { getSnapshot: () => ({ active }) },
    slots: {
      inject: (_name, register) => register(),
      register: (_selector, component) => {
        View = component
      },
    },
    effect() {},
  })
  const render = (old_text, new_text) =>
    renderToStaticMarkup(
      React.createElement(View, {
        phase: 'result',
        openFile: (path) => opened.push(path),
        block: { meta: { path: 'src/example.tsx', old_text, new_text, note: '이유를 설명합니다.' }, isError: false },
      })
    )
  const context = Array.from({ length: 30 }, (_, i) => `context${i}`).join('\n')
  for (const [before, after] of [
    ['<section>\r\n  {children}\r\n</section>', '<Modal open>\r\n  {children}\r\n</Modal>'],
    [`oldFirst\n${context}\noldLast`, `newFirst\n${context}\nnewLast`],
    ['', 'created\n'],
    ['deleted\n', ''],
    ['same', 'same\n'],
  ]) {
    const html = render(before, after)
    assert.equal(receivedDiff.diffs.length, 1)
    assert.equal(receivedDiff.diffs[0].path, 'src/example.tsx')
    assert.equal(receivedDiff.diffs[0].oldText, before)
    assert.equal(receivedDiff.diffs[0].newText, after)
    assert.equal(receivedDiff.maxLines, undefined, 'native folding defaults must not be overridden')
    assert.ok(html.indexOf('data-native-diff') < html.indexOf('이유를 설명합니다.'))
    assert.equal((html.match(/dsh-diff-note-bubble/gu) ?? []).length, 1)
    assert.doesNotMatch(html, /dsh-diff-note-line|dsh-diff-note-fold/u)
  }
  assert.equal(receivedDiff.labels.codeLabel, '코드')
  assert.equal(receivedDiff.labels.expand(12), '12줄 더 보기')
  assert.equal(receivedDiff.labels.expandAria(12), '숨겨진 12줄 표시')
  openFile()
  assert.deepEqual(opened, ['src/example.tsx'])
  for (const language of ['en', 'ko', 'zh']) {
    active = language
    render('before', 'after')
    const { ui } = JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    for (const key of ['codeLabel', 'wrapLabel', 'unwrapLabel', 'copy', 'copied', 'collapse', 'collapseAria'])
      assert.equal(receivedDiff.labels[key], ui[key])
    assert.equal(receivedDiff.labels.expand(12), ui.expand.replace('{count}', '12'))
    assert.equal(receivedDiff.labels.expandAria(12), ui.expandAria.replace('{count}', '12'))
  }
  active = 'ko'
  for (const [phase, isError, expected] of [
    ['call', false, '변경 설명을 기록하고 있습니다…'],
    ['result', true, '변경 설명을 기록하지 못했습니다.'],
  ]) {
    const html = renderToStaticMarkup(React.createElement(View, { phase, block: { isError } }))
    assert.match(html, /role="status"/u)
    assert.ok(html.includes(expected))
    assert.ok(!html.includes('data-native-diff'))
  }
})
