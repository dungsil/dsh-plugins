import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { createPwshInstructionsAdapter } from '../dist/pwsh-adapter.js'

const nativePackage = '@deepseek-ai/dsh-tool-pwsh'
const definition = (description = 'Native pwsh instructions') => ({
  name: 'pwsh',
  description,
  parameters: { type: 'object' },
  output: { schema: { type: 'string' }, render: () => [] },
  execute: async () => 'native',
  presentCall: () => undefined,
})
async function fixture(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(Tools, {})
  let saved = null
  let adapter
  let settings
  const mount = async () => {
    settings = await ctx.plugin((ctx) => {
      adapter = createPwshInstructionsAdapter(ctx, () => saved)
    })
    return adapter
  }
  const owner = async (tool, { parent = ctx, name = nativePackage, options } = {}) => {
    let undo
    const fiber = await parent.plugin((consumer) => {
      // Loader provenance metadata, not the callback's display name.
      consumer.fiber.entry = { options: { name } }
      undo = consumer.get('tools').register(tool, options)
    })
    return { fiber, undo }
  }
  return {
    ctx,
    owner,
    mount,
    save: (value) => {
      saved = value
      ctx.emit('tools/change')
    },
    unmount: () => settings.dispose(),
    adapter: () => adapter,
  }
}

await test('네이티브 설명을 덧붙이지 않고 그대로 교체하며 원본 객체와 descriptor를 복원한다', async (t) => {
  const f = await fixture(t)
  const tool = definition()
  const descriptor = Object.getOwnPropertyDescriptor(tool, 'description')
  const identities = [tool.execute, tool.parameters, tool.output, tool.presentCall]
  await f.owner(tool)
  const adapter = await f.mount()
  f.save('literal $HOME\nreplacement')
  assert.equal(f.ctx.get('tools').get('pwsh'), tool)
  assert.equal(tool.description, 'literal $HOME\nreplacement')
  assert.equal(await adapter.defaultInstructions(), descriptor.value)
  assert.deepEqual([tool.execute, tool.parameters, tool.output, tool.presentCall], identities)
  f.save(null)
  assert.equal(tool.description, descriptor.value)
  f.save('second')
  await f.unmount()
  assert.deepEqual(Object.getOwnPropertyDescriptor(tool, 'description'), descriptor)
  await f.mount()
  assert.equal(await f.adapter().defaultInstructions(), descriptor.value)
  assert.equal(tool.description, 'second')
})

await test('기존 숨김 제한과 패치 이후 제한을 우회하지 않고 조건이 거짓이면 실행하지 않는다', async (t) => {
  const f = await fixture(t)
  const tool = definition()
  const native = await f.owner(tool, { options: { when: () => false } })
  const scope = createScope(f.ctx, {})
  scope.ctx.get('tools').restrict({ deny: ['pwsh'] })
  // Registry queries take scope keys, not contexts.
  const { scopeOf } = await import('@deepseek-ai/dsh-scope')
  const key = scopeOf(scope.ctx)
  assert.equal(f.ctx.get('tools').get('pwsh', key), undefined)
  await f.mount()
  f.save('replacement')
  assert.equal(f.ctx.get('tools').get('pwsh', key), undefined)
  assert.equal(f.ctx.get('tools').executable('pwsh'), undefined)
  const agent = {}
  const admitted = await f.ctx.get('tools').resolve({ agent, modelSelection: {}, signal: new AbortController().signal })
  assert.equal(f.ctx.get('tools').get('pwsh', agent, admitted), undefined)
  admitted.dispose()
  const second = createScope(f.ctx, {})
  second.ctx.get('tools').restrict({ deny: ['pwsh'] })
  assert.equal(f.ctx.get('tools').get('pwsh', scopeOf(second.ctx)), undefined)
  native.undo()
  assert.equal(f.ctx.get('tools').get('pwsh'), undefined)
  assert.equal(await f.adapter().defaultInstructions(), null)
  const custom = definition('custom after native unregister')
  await f.owner(custom, { name: '@example/custom' })
  assert.equal(custom.description, 'custom after native unregister')
  assert.equal(await f.adapter().defaultInstructions(), null)
})

await test('미래 네이티브 Jobs 등록과 해제 수명을 유지하며 같은 이름의 사용자 도구를 수정하지 않는다', async (t) => {
  const f = await fixture(t)
  await f.mount()
  f.save('saved')
  for (let index = 0; index < 3; index++) {
    const job = createScope(f.ctx, {})
    const tool = definition(`job ${index}`)
    const native = await f.owner(tool, { parent: job.ctx })
    assert.equal(tool.description, 'saved')
    await native.fiber.dispose()
    assert.equal(tool.description, `job ${index}`)
    assert.ok('value' in Object.getOwnPropertyDescriptor(tool, 'description'))
    assert.equal(job.ctx.get('tools').definitions().length, 0)
    await job.dispose()
  }
  const custom = definition('custom')
  await f.owner(custom, { name: '@example/custom-pwsh' })
  assert.equal(custom.description, 'custom')
  assert.equal(await f.adapter().defaultInstructions(), null)
})

await test('고정된 descriptor와 외부 accessor를 수정하지 않고 다른 플러그인의 getter를 복원하지 않는다', async (t) => {
  for (const kind of ['frozen', 'nonconfigurable', 'accessor']) {
    const f = await fixture(t)
    const tool = definition()
    if (kind === 'frozen') Object.freeze(tool)
    if (kind === 'nonconfigurable') Object.defineProperty(tool, 'description', { configurable: false })
    if (kind === 'accessor') Object.defineProperty(tool, 'description', { configurable: true, get: () => 'foreign' })
    const before = Object.getOwnPropertyDescriptor(tool, 'description')
    await f.owner(tool)
    await f.mount()
    f.save('saved')
    assert.deepEqual(Object.getOwnPropertyDescriptor(tool, 'description'), before)
    assert.equal(await f.adapter().defaultInstructions(), null)
    await f.unmount()
  }
  const f = await fixture(t)
  const tool = definition()
  await f.owner(tool)
  await f.mount()
  const get = () => 'other plugin'
  Object.defineProperty(tool, 'description', { configurable: true, get })
  const foreignDescriptor = Object.getOwnPropertyDescriptor(tool, 'description')
  await f.unmount()
  assert.deepEqual(Object.getOwnPropertyDescriptor(tool, 'description'), foreignDescriptor)
})

await test('콜드 기본값은 기본 프리셋을 선택하고 성공과 실패 모두 lease를 해제한다', async (t) => {
  const f = await fixture(t)
  const { scopeOf } = await import('@deepseek-ai/dsh-scope')
  const first = createScope(f.ctx, {})
  const second = createScope(f.ctx, {})
  await f.owner(definition('first preset'), { parent: first.ctx })
  await f.owner(definition('default preset'), { parent: second.ctx })
  let releases = 0
  let acquisitions = 0
  let fail = false
  f.ctx.provide('agentPresets', {
    acquireScope: async (...args) => {
      assert.deepEqual(args, [])
      acquisitions++
      return {
        key: scopeOf(second.ctx),
        [Symbol.asyncDispose]: async () => {
          releases++
          if (fail) throw new Error('dispose failure')
        },
      }
    },
  })
  const adapter = await f.mount()
  assert.equal(acquisitions, 0)
  f.save('override')
  assert.equal(await adapter.defaultInstructions(), 'default preset')
  assert.equal(releases, 1)
  fail = true
  await assert.rejects(adapter.defaultInstructions(), /dispose failure/)
  assert.equal(releases, 2)
})
