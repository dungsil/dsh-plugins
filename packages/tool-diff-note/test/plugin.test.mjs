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

await test('records exact historical fragments and rationale through the tool runtime, including additions and deletions', async (t) => {
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

await test('English, Korean and Chinese provide all diff card labels', async () => {
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

await test('the tool view keeps the explanation after the first changed block, including folded diffs', async () => {
  const require = createRequire(import.meta.url)
  let client
  let View
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
                  get: (_target, key) =>
                    key === 'Button'
                      ? ({ children, size: _size, variant: _variant, ...props }) =>
                          React.createElement('button', props, children)
                      : () => null,
                }
              )
            return require(name)
          })
        },
      },
    },
  })
  client.apply({
    locale: { getSnapshot: () => ({ active: 'ko' }) },
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
        block: { meta: { path: 'src/example.tsx', old_text, new_text, note: '이유를 설명합니다.' }, isError: false },
      })
    )
  const html = render('<section>\n  {children}\n</section>', '<Modal open>\n  {children}\n</Modal>')
  assert.ok(html.includes('&lt;Modal open&gt;') && html.includes('{children}'))
  assert.ok(html.indexOf('&lt;Modal open&gt;') < html.indexOf('이유를 설명합니다.'))
  assert.ok(html.indexOf('이유를 설명합니다.') < html.indexOf('{children}'))
  assert.doesNotMatch(html, /작성 시점 스냅샷|<h3/u)
  const folded = render(
    Array.from({ length: 30 }, (_, i) => `old${i}`).join('\n') + '\nunchangedTail',
    Array.from({ length: 30 }, (_, i) => `new${i}`).join('\n') + '\nunchangedTail'
  )
  assert.ok(folded.includes('더 보기'))
  assert.ok(!folded.includes('old15'))
  assert.ok(folded.includes('new29') && folded.includes('unchangedTail'))
  assert.ok(folded.indexOf('new29') < folded.indexOf('이유를 설명합니다.'))
  assert.ok(folded.indexOf('이유를 설명합니다.') < folded.indexOf('unchangedTail'))
  for (const [before, after] of [
    ['', 'created\n'],
    ['deleted\n', ''],
    ['same', 'same\n'],
  ])
    assert.match(render(before, after), /이유를 설명합니다./u)
})
