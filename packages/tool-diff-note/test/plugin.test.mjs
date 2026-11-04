import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../dist/index.js'

await test('records exact historical fragments and rationale through the tool runtime, including additions and deletions', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fork = ctx.plugin(plugin)
  await fork
  const run = (args) =>
    ctx.tools.execute({
      name: 'diff_note',
      callId: 'note-test',
      arguments: args,
      signal: new AbortController().signal,
    })
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
