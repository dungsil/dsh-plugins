import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { Window } from 'happy-dom'

await test('composer shares host model selection, preserves exact routes and uses model-owned effort steps', async (t) => {
  const window = new Window()
  const previous = Object.getOwnPropertyDescriptors(globalThis)
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    ResizeObserver: window.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  // happy-dom has no top-layer layout. Browser validation covers positioning
  // and native light dismissal; the DOM test exercises the actual host directory.
  window.HTMLElement.prototype.showPopover = function () {}
  window.HTMLElement.prototype.hidePopover = function () {}
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const require = createRequire(import.meta.url)
  const modules = new Map()
  window.__ModuleLoader__ = {
    load: ({ id, factory }) =>
      modules.set(
        id,
        factory((specifier) => {
          if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {}
          return require(specifier)
        })
      ),
  }
  runInThisContext(await readFile(require.resolve('@deepseek-ai/dsh-client-ui-model-selection/client'), 'utf8'))
  runInThisContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'))
  const { ModelDirectory } = modules.get('@deepseek-ai/dsh-client-ui-model-selection')
  const groups = [
    {
      id: 'alpha',
      name: 'Alpha',
      models: [
        {
          id: 'shared',
          name: 'Alpha Shared',
          reasoning: {
            defaultEffort: 'balanced',
            efforts: [
              { id: 'quick', name: 'Quick' },
              { id: 'balanced', name: 'Balanced' },
              { id: 'deep', name: 'Deep' },
            ],
          },
        },
      ],
    },
    {
      id: 'beta',
      name: 'Beta',
      models: [
        {
          id: 'shared',
          name: 'Beta Shared',
          reasoning: {
            efforts: [
              { id: 'careful', name: 'Careful' },
              { id: 'thorough', name: 'Thorough' },
            ],
          },
        },
        { id: 'plain', name: 'Plain' },
      ],
    },
  ]
  const initial = { provider: 'alpha', model: 'shared', reasoningEffort: 'deep' }
  const projection = createSnapshotStore({ next: initial })
  const catalogValue = { default: initial, groups, failures: [], routableProviders: ['alpha', 'beta'] }
  const catalog = {
    store: createSnapshotStore({ value: catalogValue, status: 'ready', error: null }),
    load: async () => catalog.store.getSnapshot().value,
    reasoningFor: (selection) =>
      groups.find((group) => group.id === selection.provider)?.models.find((model) => model.id === selection.model)
        ?.reasoning,
  }
  let reject = false
  let settle
  const directory = new ModelDirectory(
    {
      selectModel: async ({ sessionId: _sessionId, ...selection }) => {
        if (settle)
          await new Promise((resolve) => {
            settle.resolve = resolve
          })
        if (reject) return { ok: false, error: { code: 'session/writer-held', message: 'busy' } }
        projection.set({ next: selection })
        return { ok: true, value: undefined }
      },
    },
    'session-a',
    () => true,
    catalog,
    projection,
    () => false
  )
  const ctx = new Context()
  let Component
  ctx.provide('slots', {
    inject: (_name, register) => register(),
    register: (_options, component) => {
      Component = component
      return () => {}
    },
  })
  ctx.provide('locale', { subscribe: () => () => {}, getSnapshot: () => ({ active: 'ko' }) })
  ctx.provide('sessions', { subagentAddress: (id) => (id === 'child' ? ['child'] : undefined) })
  ctx.provide('modelDirectories', { directoryFor: () => directory })
  await ctx.plugin(modules.get('@dungsil/dsh-plugin-ui-model-picker'))
  const container = window.document.createElement('main')
  window.document.body.append(container)
  const root = createRoot(container)
  const render = (props = {}) =>
    act(async () => root.render(createElement(Component, { sessionId: 'session-a', locked: false, ...props })))
  const find = (selector) => window.document.querySelector(selector)
  const click = async (selector) => {
    assert.ok(find(selector), selector)
    await act(async () => find(selector).click())
  }
  t.after(async () => {
    await act(async () => root.unmount())
    directory.dispose()
    await ctx.fiber.dispose()
    await window.happyDOM.close()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
      else delete globalThis[key]
    }
  })
  await render()
  assert.match(container.textContent, /Alpha SharedDeep/)
  await click('.dsh-codex-model')
  assert.equal(find('[role=radio][aria-checked=true]').textContent, 'Alpha Shared✓')
  await click('section[aria-label=Beta] [role=radio]')
  assert.deepEqual(projection.getSnapshot().next, { provider: 'beta', model: 'shared' })
  assert.match(container.textContent, /Beta Shared제공자 기본값/)
  await click('.dsh-codex-effort')
  const slider = find('input[type=range]')
  assert.equal(slider.max, '2')
  assert.equal(slider.getAttribute('aria-valuetext'), '제공자 기본값')
  await act(async () => {
    slider.value = '2'
    slider.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'End', bubbles: true }))
  })
  assert.deepEqual(projection.getSnapshot().next, { provider: 'beta', model: 'shared', reasoningEffort: 'thorough' })
  await click('.dsh-codex-effort')
  await click('.dsh-codex-slider button')
  assert.deepEqual(projection.getSnapshot().next, { provider: 'beta', model: 'shared' })

  // An external /model selection projects into the same trigger and closes stale drafts.
  await click('.dsh-codex-effort')
  await act(async () => projection.set({ next: initial }))
  assert.equal(find('[role=dialog]'), null)
  assert.match(container.textContent, /Alpha SharedDeep/)
  await click('.dsh-codex-model')
  await click('section[aria-label=Alpha] [role=radio]')
  assert.deepEqual(projection.getSnapshot().next, initial)

  reject = true
  await click('.dsh-codex-model')
  await click('section[aria-label=Beta] [role=radio]')
  assert.ok(find('[role=alert]'))
  assert.match(container.textContent, /Alpha SharedDeep/)
  assert.deepEqual(projection.getSnapshot().next, initial)
  reject = false
  await click('section[aria-label=Beta] [role=radio]:last-child')
  assert.match(container.textContent, /Plain/)
  assert.equal(find('.dsh-codex-effort'), null)

  // Both triggers and menu options obey the composer lock and a pending write.
  await render({ locked: true })
  assert.equal(find('.dsh-codex-model').disabled, true)
  await render()
  await click('.dsh-codex-model')
  settle = {}
  await click('section[aria-label=Alpha] [role=radio]')
  assert.equal(find('.dsh-codex-model').disabled, true)
  assert.ok([...window.document.querySelectorAll('[role=radio]')].every((option) => option.disabled))
  await act(async () => settle.resolve())
  assert.match(container.textContent, /Alpha SharedBalanced/)
  assert.equal(find('[role=dialog]'), null)

  await click('.dsh-codex-model')
  await act(async () =>
    find('[role=dialog]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  )
  assert.equal(find('[role=dialog]'), null)
  assert.equal(window.document.activeElement, find('.dsh-codex-model'))

  // The model menu retains access to effort when the host collapses trigger text.
  await click('.dsh-codex-model')
  await act(async () =>
    [...window.document.querySelectorAll('.dsh-codex-option')]
      .find((button) => button.textContent.startsWith('추론 강도'))
      .click()
  )
  assert.equal(find('input[type=range]').getAttribute('aria-valuetext'), 'Balanced')
  await act(async () =>
    catalog.store.set({
      value: { ...catalogValue, groups: [], failures: [{ id: 'alpha', name: 'Alpha', message: 'offline' }] },
      status: 'ready',
      error: null,
    })
  )
  await click('.dsh-codex-model')
  assert.match(find('[role=dialog]').textContent, /일부 제공자/)
  assert.match(find('[role=dialog]').textContent, /사용할 수 있는 모델이 없습니다/)
  assert.match(container.textContent, /shared/)
  await act(async () => catalog.store.set({ value: null, status: 'loading', error: null }))
  await click('.dsh-codex-model')
  assert.match(find('[role=status]').textContent, /모델을 불러오는 중/)
  await render({ sessionId: 'child' })
  assert.equal(container.textContent, '')
})
