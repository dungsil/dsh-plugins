import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { boot, initProfile, readProfilePatches, reconcileProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }
const conversation = { provider: 'chat', model: 'large' }
const text = { en: 'Summary', ko: '요약', zh: '摘要' }

async function fixture(t, { enabled = true, duplicate = false, withSystemPrompt = true } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'model-registry-'))
  const dir = join(home, 'profiles', 'web')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}')
  await writeFile(
    join(bundle, 'package.json'),
    JSON.stringify({
      name: 'test-bundle',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
  )
  await writeFile(
    join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'editor', name: 'cordis:editor' },
          { id: 'service', name: '@dungsil/dsh-plugin-model-settings', disabled: !enabled },
          ...['summary-a', 'summary-b'].map((id) => ({ id, name: '@example/summary', config: { untouched: id } })),
        ],
      },
    ])
  )
  await writeFile(join(dir, 'cordis.yml'), '[]')
  const profile = {
    name: 'web',
    startedBundles: ['test-bundle'],
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  const registrations = new Map()
  const requests = []
  class Adapter extends LlmAdapter {
    async listModels(provider) {
      return [{ provider, id: 'small', name: 'Small' }]
    }
    async resolveModel(provider, model) {
      if (model === 'missing') throw new Error('missing')
      return {
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [
            { id: 'low', name: 'Low' },
            { id: 'high', name: 'High' },
          ],
        },
      }
    }
    async *stream(options) {
      requests.push(options)
      yield { type: 'text-delta', index: 0, text: 'summary' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const definition = {
    key: 'summarize',
    label: text,
    description: text,
    automaticReasoningLabel: text,
    read: (config) => config.summarySettings ?? { selection: { mode: 'auxiliary' }, instructions: null },
    write: (config, settings) => ({ ...config, summarySettings: settings }),
    defaultInstructions: (config) => `Summarize ${config.untouched}.`,
  }
  const consumer = {
    apply(ctx) {
      ctx.inject(['dungsilModelSettings'], (bridge) => {
        const registration = bridge.dungsilModelSettings.register(ctx, definition)
        const id = ctx.fiber.entry.options.id
        registrations.set(id, registration)
        bridge.effect(() => () => {
          if (registrations.get(id) === registration) registrations.delete(id)
          registration.dispose()
        })
        if (duplicate) assert.throws(() => bridge.dungsilModelSettings.register(ctx, definition), /already registered/u)
      })
    },
  }
  let ctx
  t.after(async () => {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
    root.provide('profileContext', profile)
    root.loader.builtins.editor = ConfigEditor
    root.loader.internal = {
      version: 'v2',
      import: async (name) => {
        if (name === '@dungsil/dsh-plugin-model-settings') return plugin
        if (name === '@example/summary') return consumer
        throw new Error(name)
      },
    }
    await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
    await root.plugin(Connection)
    await root.plugin(Llm)
    if (withSystemPrompt) await root.plugin(SystemPrompt)
    root.llm.registerAdapter(['chat', 'aux'], new Adapter())
  })
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (endpoint, payload = {}, peer = owner) => {
    const method = `dungsil-model-settings/v2/${endpoint}`
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
      }),
      peer
    )
    if (response.status !== 200) return { status: response.status }
    return (await response.json()).result
  }
  return {
    ctx,
    rpc,
    requests,
    registrations,
    profile,
    async generate(id) {
      const settings = registrations.get(id).resolve(conversation)
      const call = await ctx.llm.prepareCall({
        ...settings.route,
        reasoningEffort: settings.reasoningEffort ?? undefined,
      })
      for await (const _ of call.stream({
        ...call.config,
        messages: [],
        system: [settings.instructions, settings.additionalInstructions].filter(Boolean).join('\n\n'),
      })) {
        /* consume the real adapter request */
      }
      return settings
    },
  }
}

await test('systemPrompt가 없는 프로필에서도 기존 모델 설정과 지침 저장을 제공한다', async (t) => {
  const h = await fixture(t, { withSystemPrompt: false })
  const pwsh = (await h.rpc('describe')).value.tasks.find((task) => task.key === 'tool:pwsh')
  assert.equal((await h.rpc('instructions', { ...pwsh, instructions: '한국어로 설명한다' })).ok, true)
  await h.generate('summary-a')
  assert.equal(h.requests.at(-1).system, 'Summarize summary-a.')
})

await test('pwsh 추가 지침을 저장하고 기본 규칙을 보존하며 보조 모델 지침을 상속하지 않는다', async (t) => {
  const h = await fixture(t)
  const sections = async () => (await h.ctx.systemPrompt.assemble()).sections
  h.ctx.systemPrompt.section({ name: 'test:built-in', order: 1, text: 'Built-in safety rules.' })
  const getPwsh = async () => (await h.rpc('describe')).value.tasks.find((task) => task.key === 'tool:pwsh')
  let pwsh = await getPwsh()
  assert.equal(pwsh.kind, 'instructions')
  assert.equal(pwsh.instructions, '')
  assert.deepEqual(pwsh.selection, { mode: 'conversation' })
  for (const selection of [{ mode: 'conversation' }, { mode: 'auxiliary' }, { mode: 'model', route: conversation }]) {
    assert.equal((await h.rpc('save', { ...pwsh, selection })).error.code, 'invalid')
  }
  const saved = await h.rpc('instructions', {
    ...pwsh,
    instructions: '  description은 한국어로 작성한다 {{literal}}  ',
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  let prompt = await sections()
  assert.equal(prompt.find((section) => section.name === 'test:built-in').text, 'Built-in safety rules.')
  assert.equal(
    prompt.find((section) => section.name === 'dungsil:pwsh-additional-instructions').text,
    'Additional instructions when calling pwsh:\ndescription은 한국어로 작성한다 {{literal}}'
  )
  assert.equal((await h.rpc('instructions', { ...pwsh, instructions: 'stale' })).error.code, 'conflict')
  const auxiliary = (await h.rpc('describe')).value.auxiliary
  assert.equal((await h.rpc('instructions', { ...auxiliary, instructions: 'Shared guidance.' })).ok, true)
  prompt = await sections()
  assert.ok(
    !prompt.find((section) => section.name === 'dungsil:pwsh-additional-instructions').text.includes('Shared guidance.')
  )
  assert.equal(h.requests.length, 0)
  pwsh = await getPwsh()
  assert.equal((await h.rpc('instructions', { ...pwsh, instructions: '   ' })).ok, true)
  assert.equal((await getPwsh()).instructions, '')
  assert.ok(
    !(await sections()).some((section) => section.name === 'dungsil:pwsh-additional-instructions' && section.text)
  )
  const entry = h.ctx.configEditor.entries().find((entry) => entry.options.id === 'service')
  assert.equal(entry.options.config.pwshInstructions, undefined)
})

await test('알려지지 않은 작업과 복수 entry를 등록하고 독립적으로 저장하며 실제 요청에 적용한다', async (t) => {
  const h = await fixture(t, { duplicate: true })
  const described = await h.rpc('describe')
  assert.equal(described.ok, true)
  assert.deepEqual(
    described.value.tasks.filter((task) => !task.kind).map((task) => task.owner.entryId),
    ['summary-a', 'summary-b']
  )
  const [first, second] = described.value.tasks.filter((task) => !task.kind)
  const saved = await h.rpc('save', {
    ...first,
    selection: {
      mode: 'model',
      route: { provider: 'aux', model: 'small' },
      reasoningEffort: 'high',
    },
  })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal((await h.rpc('save', { ...first, selection: { mode: 'conversation' } })).error.code, 'conflict')
  assert.equal(
    (await h.rpc('describe')).value.tasks.find((task) => task.owner.entryId === 'summary-b').revision,
    second.revision
  )
  const instructions = await h.rpc('instructions', { ...saved.value, instructions: '  Only the summary.  ' })
  assert.equal(instructions.ok, true)
  await h.generate('summary-a')
  assert.equal(h.requests.at(-1).provider, 'aux')
  assert.equal(h.requests.at(-1).reasoningEffort, 'high')
  assert.equal(h.requests.at(-1).system, 'Only the summary.')
  await h.generate('summary-b')
  assert.equal(h.requests.at(-1).provider, 'chat')
  assert.equal(h.requests.at(-1).system, 'Summarize summary-b.')
  const entry = h.ctx.configEditor.entries().find((entry) => entry.options.id === 'summary-a')
  assert.equal(entry.options.config.untouched, 'summary-a')
  assert.equal(entry.options.config.summarySettings.instructions, 'Only the summary.')
  assert.equal(
    (
      await h.rpc('save', {
        ...instructions.value,
        selection: {
          mode: 'model',
          route: { provider: 'aux', model: 'missing' },
          reasoningEffort: null,
        },
      })
    ).error.code,
    'model_unavailable'
  )
  assert.equal(
    (
      await h.rpc('save', {
        ...instructions.value,
        selection: {
          mode: 'model',
          route: { provider: 'aux', model: 'small' },
          reasoningEffort: 'invalid',
        },
      })
    ).error.code,
    'reasoning_unavailable'
  )
  assert.equal(
    (
      await h.rpc('save', {
        ...instructions.value,
        selection: {
          mode: 'conversation',
          reasoningEffort: 'high',
        },
      })
    ).error.code,
    'invalid'
  )
  assert.equal((await h.rpc('describe', {}, { principal: { kind: 'anonymous' } })).status, 403)
})

await test('보조 모델과 공통 지침을 상속하되 대화 모델 선택에는 적용하지 않는다', async (t) => {
  const h = await fixture(t)
  let view = (await h.rpc('describe')).value
  assert.equal((await h.rpc('instructions', { ...view.auxiliary, instructions: 'Shared guidance.' })).ok, true)
  await h.generate('summary-a')
  assert.equal(h.requests.at(-1).provider, 'chat')
  assert.equal(h.requests.at(-1).system, 'Summarize summary-a.\n\nShared guidance.')
  view = (await h.rpc('describe')).value
  assert.equal(
    (
      await h.rpc('save', {
        ...view.auxiliary,
        selection: {
          mode: 'model',
          route: { provider: 'aux', model: 'small' },
          reasoningEffort: 'low',
        },
      })
    ).ok,
    true
  )
  await h.generate('summary-a')
  assert.equal(h.requests.at(-1).provider, 'aux')
  assert.equal(h.requests.at(-1).reasoningEffort, 'low')
  view = (await h.rpc('describe')).value
  assert.equal(
    (
      await h.rpc('save', {
        ...view.tasks.find((task) => task.owner.entryId === 'summary-a'),
        selection: { mode: 'conversation' },
      })
    ).ok,
    true
  )
  await h.generate('summary-a')
  assert.equal(h.requests.at(-1).provider, 'chat')
  assert.equal(h.requests.at(-1).system, 'Summarize summary-a.')
})

await test('서비스를 나중에 활성화하거나 교체하면 작업을 재등록하고 오래된 등록과 revision을 거부한다', async (t) => {
  const h = await fixture(t, { enabled: false })
  assert.equal(h.registrations.size, 0)
  const service = h.ctx.configEditor.entries().find((entry) => entry.options.id === 'service')
  await writeFile(h.profile.patchPath, JSON.stringify([{ id: 'service', disabled: false }]))
  await reconcileProfilePatches(h.ctx, readProfilePatches('dsh', h.profile), 'dsh')
  await h.ctx.loader.await()
  let view = (await h.rpc('describe')).value
  assert.equal(view.tasks.length, 3)
  const old = h.registrations.get('summary-a')
  const stale = view.tasks.find((task) => task.owner.entryId === 'summary-a')
  await service.fiber.restart()
  await h.ctx.loader.await()
  assert.throws(() => old.resolve(conversation), /no longer active/u)
  old.dispose()
  view = (await h.rpc('describe')).value
  assert.equal(view.tasks.length, 3)
  assert.notEqual(view.tasks.find((task) => task.id === stale.id).revision, stale.revision)
  assert.equal((await h.rpc('instructions', { ...stale, instructions: 'Stale.' })).error.code, 'conflict')
  await h.generate('summary-a')
  assert.equal(h.requests.at(-1).system, 'Summarize summary-a.')
})
