import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { profileFixture, titleConfig } from './profile.mjs'

for (const strategy of ['first-prompt', 'all-prompts']) {
  await test(`${strategy}: editable default prompts replace task instructions, persist and stay out of conversation calls`, async (t) => {
    const h = await profileFixture(strategy, {}, { naming: 'semantic' }, {})
    t.after(h.close)
    const initial = (await h.rpc('describe')).value
    assert.equal(initial.auxiliary.instructions, '')
    assert.equal(initial.target.instructions, initial.target.defaultInstructions)
    assert.ok(initial.target.instructions.includes('about 7 words in non-CJK languages or 13 CJK characters.'))
    assert.ok(initial.worktree.instructions.startsWith('Return only a short lowercase ASCII semantic Git branch name'))
    assert.ok(initial.yoonmoon.instructions.includes('{{skill}}'))
    assert.ok(initial.yoonmoon.instructions.endsWith('{{resources}}'))
    const session = await h.generate('default-title')
    assert.equal(
      h.adapter.requests.at(-1).system,
      initial.target.instructions.split('\nAn existing title is supplied')[0]
    )
    if (strategy === 'all-prompts') {
      await h.ctx.sessionTitle.refresh(session)
      assert.equal(h.adapter.requests.at(-1).system, initial.target.instructions)
    }
    await h.write('default-writing')
    const defaultWriting = h.adapter.requests.at(-1).system
    const requestCount = h.adapter.requests.length
    for (const task of ['auxiliary', 'target', 'worktree', 'yoonmoon']) {
      const target = (await h.rpc('describe')).value[task]
      const saved = await h.rpc('instructions', { ...target, instructions: `  Only ${task}.\nKeep it short.  ` })
      assert.equal(saved.ok, true)
      assert.equal(saved.value.instructions, `Only ${task}.\nKeep it short.`)
      assert.deepEqual(saved.value.route, initial[task].route)
      assert.equal((await h.rpc('instructions', { ...target, instructions: 'stale' })).error.code, 'conflict')
    }
    assert.equal(h.adapter.requests.length, requestCount)
    await h.restart()
    const restored = (await h.rpc('describe')).value
    for (const task of ['auxiliary', 'target', 'worktree', 'yoonmoon']) {
      assert.equal(restored[task].instructions, `Only ${task}.\nKeep it short.`)
    }
    await h.generate('instructions-title')
    const titleSystem = h.adapter.requests.at(-1).system
    assert.equal(titleSystem, 'Only target.\nKeep it short.\n\nOnly auxiliary.\nKeep it short.')
    await h.write('instructions-yoonmoon')
    const writingSystem = h.adapter.requests.at(-1).system
    assert.equal(writingSystem, 'Only yoonmoon.\nKeep it short.\n\nOnly auxiliary.\nKeep it short.')
    assert.ok(!writingSystem.includes('Only target.'))
    const conversation = await h.ctx.llm.prepareCall({ provider: 'conversation', model: 'chat-large' })
    for await (const _ of conversation.stream({ ...conversation.config, messages: [], system: 'Conversation only.' })) {
    }
    assert.equal(h.adapter.requests.at(-1).system, 'Conversation only.')
    const own = await h.rpc('save', {
      ...restored.target,
      route: { provider: 'auxiliary', model: 'title-small' },
      reasoningEffort: 'thorough',
    })
    assert.equal(own.ok, true)
    assert.equal(own.value.instructions, restored.target.instructions)
    await h.generate('instructions-own-route')
    assert.ok(h.adapter.requests.at(-1).system.endsWith('Only target.\nKeep it short.'))
    assert.ok(!h.adapter.requests.at(-1).system.includes('Only auxiliary.'))
    const cleared = await h.rpc('instructions', { ...own.value, instructions: ' \n ' })
    assert.equal(cleared.ok, true)
    assert.equal(cleared.value.instructions, initial.target.defaultInstructions)
    assert.deepEqual(cleared.value.route, own.value.route)
    assert.equal(cleared.value.reasoningEffort, 'thorough')
    await h.generate('instructions-cleared')
    assert.ok(!h.adapter.requests.at(-1).system.includes('Only target.'))
    assert.equal(
      h.adapter.requests.at(-1).system,
      initial.target.instructions.split('\nAn existing title is supplied')[0]
    )
    assert.equal(h.adapter.requests.at(-1).reasoningEffort, 'thorough')
    assert.equal((await h.rpc('describe')).value.worktree.instructions, restored.worktree.instructions)
    const writing = (await h.rpc('describe')).value.yoonmoon
    const customWriting = initial.yoonmoon.defaultInstructions.replace(
      'Preserve the input meaning.',
      'Use a formal tone.'
    )
    assert.equal((await h.rpc('instructions', { ...writing, instructions: customWriting })).ok, true)
    await h.write('template-writing')
    assert.equal(
      h.adapter.requests.at(-1).system,
      `${defaultWriting.replace('Preserve the input meaning.', 'Use a formal tone.')}\n\nOnly auxiliary.\nKeep it short.`
    )
    const currentWriting = (await h.rpc('describe')).value.yoonmoon
    assert.equal(
      (await h.rpc('instructions', { ...currentWriting, instructions: currentWriting.defaultInstructions })).ok,
      true
    )
    const titleEntry = h.ctx.configEditor.entries().find((entry) => entry.options.id === initial.target.id)
    await h.ctx.configEditor.edit(titleEntry, (config) => ({ ...config, targetWords: 11, targetCjkCharacters: 19 }))
    const updated = (await h.rpc('describe')).value.target
    assert.ok(updated.instructions.includes('about 11 words in non-CJK languages or 19 CJK characters.'))
    await h.generate('changed-title-defaults')
    assert.equal(h.adapter.requests.at(-1).system, updated.instructions.split('\nAn existing title is supplied')[0])
    await h.restart()
    await h.write('restored-writing-default')
    assert.equal(h.adapter.requests.at(-1).system, `${defaultWriting}\n\nOnly auxiliary.\nKeep it short.`)
  })

  await test(`${strategy}: shared auxiliary defaults preserve provenance, explicit overrides and conversation opt-out across reloads`, async (t) => {
    const h = await profileFixture(strategy)
    t.after(h.close)
    const initial = (await h.rpc('describe')).value
    assert.equal(initial.target.useAuxiliary, true)
    const fallback = await h.generate('auxiliary-unset')
    assert.deepEqual(h.ctx.sessionTitle.get(fallback).source.model, { provider: 'conversation', model: 'chat-large' })
    const route = { provider: 'auxiliary', model: 'title-small' }
    const saved = await h.rpc('save', { ...initial.auxiliary, route, reasoningEffort: 'thorough' })
    assert.equal(saved.ok, true)
    assert.equal((await h.rpc('save', { ...initial.auxiliary, route })).error.code, 'conflict')
    const check = async (id, expectedRoute, effort) => {
      const session = await h.generate(id)
      const logged = session.snapshotEvents().findLast((event) => event.type === 'session/title-llm-request')
      assert.deepEqual(logged.data.route, expectedRoute)
      assert.deepEqual(h.ctx.sessionTitle.get(session).source.model, expectedRoute)
      assert.equal(h.adapter.requests.at(-1).provider, expectedRoute.provider)
      assert.equal(h.adapter.requests.at(-1).model, expectedRoute.model)
      assert.equal(h.adapter.requests.at(-1).reasoningEffort, effort)
      assert.deepEqual(session.requestHeader().config, { provider: 'conversation', model: 'chat-large' })
    }
    await check('shared', route, 'thorough')
    await h.restart()
    assert.deepEqual((await h.rpc('describe')).value.auxiliary.route, route)
    await check('shared-restored', route, 'thorough')
    const target = (await h.rpc('describe')).value.target
    const ownRoute = { provider: 'conversation', model: 'title-small' }
    const explicit = await h.rpc('save', { ...target, route: ownRoute, reasoningEffort: 'quick' })
    assert.equal(explicit.ok, true)
    await check('explicit', ownRoute, 'quick')
    const optedOut = await h.rpc('save', { ...explicit.value, route: null, reasoningEffort: null, useAuxiliary: false })
    assert.equal(optedOut.ok, true)
    assert.equal(optedOut.value.useAuxiliary, false)
    await h.restart()
    await check('conversation-restored', { provider: 'conversation', model: 'chat-large' }, undefined)
    const restored = (await h.rpc('describe')).value
    assert.equal((await h.rpc('save', { ...restored.target, useAuxiliary: true })).ok, true)
    await check('shared-again', route, 'thorough')
    const auxiliary = (await h.rpc('describe')).value.auxiliary
    assert.equal((await h.rpc('save', { ...auxiliary, route: null, reasoningEffort: null })).ok, true)
    await check('auxiliary-reset', { provider: 'conversation', model: 'chat-large' }, undefined)
  })

  await test(`${strategy}: persists reasoning effort and applies it before request logging without affecting conversation calls`, async (t) => {
    const h = await profileFixture(strategy)
    t.after(h.close)
    const view = (await h.rpc('describe')).value
    assert.deepEqual(view.providers[1].models.find((model) => model.id === 'title-small').efforts, [
      { id: 'quick', name: 'Quick' },
      { id: 'thorough', name: 'Thorough' },
    ])
    const route = { provider: 'auxiliary', model: 'title-small' }
    const saved = await h.rpc('save', { ...view.target, route, reasoningEffort: 'thorough' })
    assert.equal(saved.ok, true)
    assert.equal(saved.value.reasoningEffort, 'thorough')
    assert.equal(h.adapter.requests.length, 0)
    assert.match(await readFile(h.profile.patchPath, 'utf8'), /reasoningEffort: thorough/u)
    const checkTitle = async (id, expected) => {
      const session = await h.generate(id)
      assert.equal(h.ctx.sessionTitle.get(session).source.kind, 'provider')
      assert.equal(h.adapter.requests.at(-1).reasoningEffort, expected)
      assert.equal(
        session.snapshotEvents().findLast((event) => event.type === 'session/title-llm-request').data.reasoningEffort,
        expected
      )
    }
    await checkTitle('explicit', 'thorough')
    const conversation = await h.ctx.llm.prepareCall({ ...route, reasoningEffort: 'quick' })
    assert.equal(conversation.config.reasoningEffort, 'quick')
    await h.restart()
    const restored = (await h.rpc('describe')).value.target
    assert.equal(restored.reasoningEffort, 'thorough')
    await checkTitle('restored', 'thorough')
    const entry = h.ctx.configEditor.entries().find((entry) => entry.options.id === restored.id)
    await h.ctx.configEditor.edit(entry, (config) => ({ ...config, model: 'chat-large' }))
    assert.equal((await h.rpc('describe')).value.target.reasoningEffort, null)
    await checkTitle('different-model', undefined)
    await h.ctx.configEditor.edit(entry, (config) => ({ ...config, ...route }))
    const current = (await h.rpc('describe')).value.target
    const automatic = await h.rpc('save', { ...current, reasoningEffort: null })
    assert.equal(automatic.ok, true)
    assert.equal(automatic.value.reasoningEffort, null)
    await checkTitle('automatic', 'quick')
    const explicit = await h.rpc('save', { ...automatic.value, reasoningEffort: 'thorough' })
    const reset = await h.rpc('save', { ...explicit.value, route: null, reasoningEffort: null })
    assert.equal(reset.ok, true)
    assert.equal(reset.value.reasoningEffort, null)
    assert.deepEqual(
      h.ctx.configEditor.entries().find((entry) => entry.options.id === reset.value.id).options.config,
      titleConfig
    )
    const beforeUnload = await h.rpc('save', { ...reset.value, route, reasoningEffort: 'thorough' })
    assert.equal(beforeUnload.ok, true)
    await h.ctx.configEditor
      .entries()
      .find((entry) => entry.options.name === '@dungsil/dsh-plugin-model-settings')
      .fiber.dispose()
    await checkTitle('plugin-unloaded', 'quick')
  })

  await test(`${strategy}: saves, reloads and resets the title route without changing conversation config`, async (t) => {
    const h = await profileFixture(strategy, { provider: 'conversation', model: 'title-small' })
    t.after(h.close)
    const initial = (await h.rpc('describe')).value
    assert.equal(initial.target.id, 'custom-title-entry')
    assert.deepEqual(initial.target.route, { provider: 'conversation', model: 'title-small' })
    assert.equal(initial.worktree, null, 'worktree configuration is not offered without the active plugin')
    const route = { provider: 'auxiliary', model: 'title-small' }
    const saved = await h.rpc('save', { ...initial.target, route })
    assert.equal(saved.ok, true)
    assert.deepEqual(saved.value.route, route)
    assert.equal(h.adapter.requests.length, 0, 'saving must not send a paid generation request')
    assert.match(await readFile(h.profile.patchPath, 'utf8'), /provider: auxiliary/u)
    const config = () =>
      h.ctx.configEditor.entries().find((entry) => entry.options.id === 'custom-title-entry').options.config
    assert.deepEqual(config(), { ...titleConfig, ...route })
    const session = await h.generate('overridden')
    assert.deepEqual(h.ctx.sessionTitle.get(session).source.model, route)
    const events = session.snapshotEvents()
    const logged = events.findLast((event) => event.type === 'session/title-llm-request')
    assert.deepEqual(logged.data.route, route)
    assert.equal(h.adapter.requests.at(-1).provider, 'auxiliary')
    assert.equal(h.adapter.requests.at(-1).model, 'title-small')
    assert.equal(h.adapter.requests.at(-1).maxTokens, 256)
    assert.deepEqual(events.find((event) => event.type === 'request/header').data.header.config, {
      provider: 'conversation',
      model: 'chat-large',
    })

    // An old browser cannot overwrite a later selection, even after the provider remounts.
    assert.equal((await h.rpc('save', { ...initial.target, route: null })).error.code, 'conflict')
    await h.restart()
    const restored = (await h.rpc('describe')).value.target
    assert.deepEqual(restored.route, route)
    assert.equal((await h.rpc('save', { ...restored, route: null })).ok, true)
    assert.deepEqual(config(), titleConfig, 'reset must also remove a route inherited from the bundle')
    const inherited = await h.generate('inherited')
    assert.deepEqual(h.ctx.sessionTitle.get(inherited).source.model, { provider: 'conversation', model: 'chat-large' })
    assert.equal(h.ctx.sessionTitle.get(inherited).title, '모델 설정 구현')
    await h.restart()
    assert.equal((await h.rpc('describe')).value.target.route, null)
  })
}

await test('refuses unauthorized, invalid, unavailable and stale writes without losing existing config', async (t) => {
  const h = await profileFixture()
  t.after(h.close)
  const target = (await h.rpc('describe')).value.target
  for (const endpoint of ['describe', 'save', 'instructions']) {
    assert.equal(
      (await h.rpc(endpoint, target, { principal: { kind: 'anonymous' }, interactions: 'deny' })).status,
      403
    )
  }
  for (const route of [undefined, {}, { provider: 'auxiliary' }, { provider: '', model: 'title-small' }]) {
    assert.equal((await h.rpc('save', { ...target, route })).error.code, 'invalid')
  }
  for (const instructions of [undefined, null, 2, {}, []]) {
    assert.equal((await h.rpc('instructions', { ...target, instructions })).error.code, 'invalid')
  }
  for (const reasoningEffort of ['', ' ', 2, {}, []]) {
    assert.equal(
      (await h.rpc('save', { ...target, route: { provider: 'auxiliary', model: 'title-small' }, reasoningEffort }))
        .error.code,
      'invalid'
    )
  }
  assert.equal((await h.rpc('save', { ...target, route: null, reasoningEffort: 'quick' })).error.code, 'invalid')
  for (const [model, reasoningEffort] of [
    ['title-small', 'high'],
    ['chat-large', 'quick'],
  ]) {
    assert.equal(
      (await h.rpc('save', { ...target, route: { provider: 'auxiliary', model }, reasoningEffort })).error.code,
      'reasoning_unavailable'
    )
  }
  assert.equal(
    (await h.rpc('save', { ...target, route: { provider: 'missing', model: 'title-small' } })).error.code,
    'model_unavailable'
  )
  assert.equal(
    (await h.rpc('save', { ...target, route: { provider: 'auxiliary', model: 'missing' } })).error.code,
    'model_unavailable'
  )
  assert.equal((await h.rpc('describe')).value.target.revision, target.revision)

  const results = await Promise.all([
    h.rpc('save', { ...target, route: { provider: 'auxiliary', model: 'title-small' } }),
    h.rpc('save', { ...target, route: { provider: 'conversation', model: 'title-small' } }),
  ])
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.find((result) => !result.ok).error.code, 'conflict')

  const latest = (await h.rpc('describe')).value.target
  const effortResults = await Promise.all([
    h.rpc('save', { ...latest, reasoningEffort: 'quick' }),
    h.rpc('save', { ...latest, reasoningEffort: 'thorough' }),
  ])
  assert.equal(effortResults.filter((result) => result.ok).length, 1)
  assert.equal(effortResults.find((result) => !result.ok).error.code, 'conflict')

  t.mock.method(h.adapter, 'listModels', async () => {
    throw new Error('catalog offline')
  })
  const unavailableCatalog = (await h.rpc('describe')).value
  assert.equal(unavailableCatalog.catalogError, true)
  assert.ok(unavailableCatalog.providers.every((provider) => provider.models.length === 0))
  assert.equal((await h.rpc('save', { ...unavailableCatalog.target, route: null, reasoningEffort: null })).ok, true)
  const entry = h.ctx.configEditor.entries().find((item) => item.options.id === target.id)
  await entry.fiber.dispose()
  assert.equal((await h.rpc('describe')).value.target, null)
  assert.equal((await h.rpc('save', { ...target, route: null })).error.code, 'unavailable')
})

await test('worktree routes persist independently of titles, preserve other settings and reject stale writes', async (t) => {
  const h = await profileFixture('first-prompt', {}, { namingStyle: 'semantic' })
  t.after(h.close)
  const initial = (await h.rpc('describe')).value
  assert.equal(initial.worktree.id, 'custom-worktree-entry')
  assert.equal(initial.worktree.route, null)
  const title = await h.rpc('save', {
    ...initial.target,
    route: { provider: 'conversation', model: 'title-small' },
    reasoningEffort: 'thorough',
  })
  assert.equal(title.ok, true)
  assert.deepEqual((await h.rpc('describe')).value.worktree, initial.worktree)
  const route = { provider: 'auxiliary', model: 'title-small' }
  assert.equal(
    (await h.rpc('save', { ...initial.worktree, route, reasoningEffort: 'unsupported' })).error.code,
    'reasoning_unavailable'
  )
  const saved = await h.rpc('save', { ...initial.worktree, route, reasoningEffort: 'quick' })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.value.route, route)
  assert.equal(saved.value.reasoningEffort, 'quick')
  assert.equal(h.adapter.requests.length, 0)
  assert.deepEqual((await h.rpc('describe')).value.target, title.value)
  assert.equal((await h.rpc('save', { ...initial.worktree, route: null })).error.code, 'conflict')
  assert.equal(
    (await h.rpc('save', { ...saved.value, route: { provider: 'missing', model: 'title-small' } })).error.code,
    'model_unavailable'
  )
  await h.restart()
  const restored = (await h.rpc('describe')).value.worktree
  assert.deepEqual(restored.route, route)
  assert.equal(restored.reasoningEffort, 'quick')
  const automatic = await h.rpc('save', { ...restored, reasoningEffort: null })
  assert.equal(automatic.ok, true)
  assert.equal(automatic.value.reasoningEffort, null)
  assert.deepEqual(automatic.value.route, route)
  const explicit = await h.rpc('save', { ...automatic.value, reasoningEffort: 'quick' })
  assert.equal(explicit.ok, true)
  assert.equal((await h.rpc('save', { ...explicit.value, route: null, reasoningEffort: null })).ok, true)
  assert.equal((await h.rpc('describe')).value.target.reasoningEffort, 'thorough')
  await h.generate('after-worktree-reset')
  assert.equal(h.adapter.requests.at(-1).reasoningEffort, 'thorough')
  const entry = h.ctx.configEditor.entries().find((item) => item.options.id === restored.id)
  assert.deepEqual(entry.options.config, { namingStyle: 'semantic' })
  await h.restart()
  assert.equal((await h.rpc('describe')).value.worktree.route, null)
  const titleEntry = h.ctx.configEditor.entries().find((item) => item.options.id === initial.target.id)
  await titleEntry.fiber.dispose()
  const onlyWorktree = (await h.rpc('describe')).value
  assert.equal(onlyWorktree.target, null)
  assert.equal((await h.rpc('save', { ...onlyWorktree.worktree, route })).ok, true)
  const worktreeEntry = h.ctx.configEditor.entries().find((item) => item.options.id === restored.id)
  await worktreeEntry.fiber.dispose()
  assert.equal((await h.rpc('describe')).value.worktree, null)
})

await test('Yoonmoon model and effort persist independently, inherit auxiliary settings and leave the conversation unchanged', async (t) => {
  const h = await profileFixture('first-prompt', {}, undefined, {})
  t.after(h.close)
  const initial = (await h.rpc('describe')).value
  assert.equal(initial.yoonmoon.id, 'custom-yoonmoon-entry')
  const route = { provider: 'auxiliary', model: 'title-small' }
  const check = async (id, expectedRoute, effort) => {
    const { result, config } = await h.write(id)
    assert.equal(result.isError, false)
    assert.equal(result.value, '모델 설정 구현')
    const request = h.adapter.requests.at(-1)
    assert.equal(request.provider, expectedRoute.provider)
    assert.equal(request.model, expectedRoute.model)
    assert.equal(request.reasoningEffort, effort)
    assert.deepEqual(config, { provider: 'conversation', model: 'chat-large', reasoningEffort: 'quick' })
  }
  assert.equal((await h.rpc('save', { ...initial.auxiliary, route, reasoningEffort: 'thorough' })).ok, true)
  await check('writing-auxiliary', route, 'thorough')
  const target = (await h.rpc('describe')).value.yoonmoon
  const saved = await h.rpc('save', { ...target, route, reasoningEffort: 'quick' })
  assert.equal(saved.ok, true)
  assert.equal((await h.rpc('save', { ...target, route: null })).error.code, 'conflict')
  await check('writing-own', route, 'quick')
  assert.deepEqual((await h.rpc('describe')).value.target, initial.target)
  await h.restart()
  const restored = (await h.rpc('describe')).value.yoonmoon
  assert.deepEqual(restored.route, route)
  assert.equal(restored.reasoningEffort, 'quick')
  await check('writing-restored', route, 'quick')
  const automatic = await h.rpc('save', { ...restored, reasoningEffort: null })
  assert.equal(automatic.ok, true)
  await check('writing-automatic', route, 'thorough')
  const reset = await h.rpc('save', { ...automatic.value, route: null, reasoningEffort: null, useAuxiliary: false })
  assert.equal(reset.ok, true)
  await h.restart()
  await check('writing-conversation', { provider: 'conversation', model: 'chat-large' }, undefined)
  const current = (await h.rpc('describe')).value
  assert.equal((await h.rpc('save', { ...current.yoonmoon, useAuxiliary: true })).ok, true)
  await check('writing-inherit-again', route, 'thorough')
  const entry = h.ctx.configEditor.entries().find((entry) => entry.options.id === current.yoonmoon.id)
  await entry.fiber.dispose()
  assert.equal((await h.rpc('describe')).value.yoonmoon, null)
})
