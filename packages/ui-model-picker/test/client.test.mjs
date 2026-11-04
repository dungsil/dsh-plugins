import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import test from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
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
  const { createElement, forwardRef, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const require = createRequire(import.meta.url)
  const modules = new Map()
  // Keep host visuals at the module boundary; browser validation loads the real
  // primitives and their CSS, including MenuSurface's forwarded popover ref.
  const icon = (props) => createElement('svg', { ...props, 'aria-hidden': true })
  const primitives = {
    IconChevronDownOutlineRegular: icon,
    IconChevronLeftOutlineRegular: icon,
    IconChevronRightOutlineRegular: icon,
    IconCheckOutlineRegular: icon,
    IconDataOutlineRegular: icon,
    MenuSurface: forwardRef((props, ref) => createElement('div', { ...props, ref })),
  }
  window.__ModuleLoader__ = {
    load: ({ id, factory }) =>
      modules.set(
        id,
        factory((specifier) => {
          if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
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
  const locale = createSnapshotStore({ active: 'ko' })
  ctx.provide('locale', locale)
  ctx.provide('sessions', {})
  ctx.provide('remote', {})
  ctx.provide('remote.session', {})
  ctx.provide('modelDirectories', { directoryFor: () => directory })
  await ctx.plugin(modules.get('@dungsil/dsh-plugin-ui-model-picker'))
  const container = window.document.createElement('main')
  window.document.body.append(container)
  const root = createRoot(container)
  const render = (props = {}) =>
    act(async () =>
      root.render(
        createElement(Component, {
          sessionId: 'session-a',
          locked: false,
          useSession: (selector) => selector({ subagent: props.sessionId === 'child' ? { address: ['child'] } : null }),
          ...props,
        })
      )
    )
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
  await t.test('a fresh session resolves the real directory through caller-bound Remote dependencies', async () => {
    const fresh = new Context()
    let FreshPicker
    fresh.provide('slots', {
      inject: (_name, register) => register(),
      register: (_options, component) => {
        FreshPicker = component
        return () => {}
      },
    })
    fresh.provide('locale', locale)
    await fresh.plugin({
      name: 'model-directory-fixture',
      apply(provider) {
        provider.provide('remote.session', {
          modelCatalog: async () => ({ ok: true, value: catalogValue }),
          selectModel: async () => ({ ok: true, value: undefined }),
        })
        class Remote extends Service {
          constructor(ctx) {
            super(ctx, 'remote')
          }
          get session() {
            return this.ctx['remote.session']
          }
          $on() {
            return () => {}
          }
        }
        new Remote(provider)
        provider.provide('sessions', {
          scope: () => provider,
          binding: () => ({
            session: {
              projections: { faceOf: () => projection },
              getSnapshot: () => ({ blank: false }),
            },
          }),
          subagentAddress: () => undefined,
        })
        const { ModelDirectoryResolver } = modules.get('@deepseek-ai/dsh-client-ui-model-selection')
        new ModelDirectoryResolver(provider)
      },
    })
    try {
      await fresh.plugin(modules.get('@dungsil/dsh-plugin-ui-model-picker'))
      const element = FreshPicker({
        sessionId: 'fresh-session',
        locked: false,
        useSession: (select) => select({ subagent: null }),
      })
      assert.ok(element.props.directory, 'the picker resolves a newly created directory, not a cached native one')
      await element.props.directory.load()
    } finally {
      await fresh.fiber.dispose()
    }
  })
  await render()
  assert.match(container.textContent, /Alpha Shared\s*Deep/)
  assert.equal(container.querySelectorAll('button').length, 1)
  const openModels = async () => {
    await click('.dsh-codex-trigger')
    assert.ok(find('.dsh-codex-header'))
    assert.equal(find('[role=radio]'), null, 'opening the picker shows effort, not the model catalog')
    await click('.dsh-codex-model')
    assert.ok(find('[role=radio]'), 'the model name opens the model catalog')
  }
  await click('.dsh-codex-trigger')
  assert.equal(find('input[type=range]').getAttribute('aria-valuetext'), 'Deep')
  assert.equal(find('[role=radio]'), null)
  assert.match(container.textContent, /Alpha Shared\s*Deep/, 'opening the picker keeps its selected label')
  await click('.dsh-codex-model')
  assert.equal(find('[role=radio][aria-checked=true]').textContent, 'Alpha Shared')
  await click('.dsh-codex-back')
  assert.ok(find('input[type=range]'))
  await click('.dsh-codex-model')
  await click('section[aria-label=Beta] [role=radio]')
  assert.deepEqual(projection.getSnapshot().next, { provider: 'beta', model: 'shared' })
  assert.match(container.textContent, /Beta Shared\s*제공자 기본값/)
  await click('.dsh-codex-trigger')
  const slider = find('input[type=range]')
  assert.equal(slider.max, '2')
  assert.equal(slider.getAttribute('aria-valuetext'), '제공자 기본값')
  await act(async () => {
    slider.value = '2'
    slider.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'End', bubbles: true }))
  })
  assert.deepEqual(projection.getSnapshot().next, { provider: 'beta', model: 'shared', reasoningEffort: 'thorough' })
  await click('.dsh-codex-trigger')
  await click('.dsh-codex-reset')
  assert.deepEqual(projection.getSnapshot().next, { provider: 'beta', model: 'shared' })

  // An external /model selection projects into the same trigger and closes stale drafts.
  await click('.dsh-codex-trigger')
  await act(async () => projection.set({ next: initial }))
  assert.equal(find('[role=dialog]'), null)
  assert.match(container.textContent, /Alpha Shared\s*Deep/)
  await openModels()
  await click('section[aria-label=Alpha] [role=radio]')
  assert.deepEqual(projection.getSnapshot().next, initial)

  reject = true
  await openModels()
  await click('section[aria-label=Beta] [role=radio]')
  assert.ok(find('[role=alert]'))
  assert.equal(find('[role=radio][aria-checked=true]').textContent, 'Alpha Shared')
  assert.deepEqual(projection.getSnapshot().next, initial)
  reject = false
  await click('section[aria-label=Beta] [role=radio]:last-child')
  assert.match(container.textContent, /Plain/)
  await click('.dsh-codex-trigger')
  assert.equal(find('input[type=range]'), null)
  assert.ok(find('.dsh-codex-model'), 'models without effort still expose model selection through the header')

  // Both triggers and menu options obey the composer lock and a pending write.
  await render({ locked: true })
  assert.equal(find('.dsh-codex-trigger').disabled, true)
  await render()
  await openModels()
  settle = {}
  await click('section[aria-label=Alpha] [role=radio]')
  assert.equal(find('.dsh-codex-trigger').disabled, true)
  assert.ok([...window.document.querySelectorAll('[role=radio]')].every((option) => option.disabled))
  await act(async () => settle.resolve())
  assert.match(container.textContent, /Alpha Shared\s*Balanced/)
  assert.equal(find('[role=dialog]'), null)

  await click('.dsh-codex-trigger')
  await act(async () =>
    find('[role=dialog]').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  )
  assert.equal(find('[role=dialog]'), null)
  assert.equal(window.document.activeElement, find('.dsh-codex-trigger'))

  // The same single trigger flow works when the host collapses its text.
  await click('.dsh-codex-trigger')
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
  assert.match(find('.dsh-codex-trigger').getAttribute('aria-label'), /shared/)
  await act(async () => catalog.store.set({ value: null, status: 'loading', error: null }))
  await click('.dsh-codex-trigger')
  assert.match(find('[role=status]').textContent, /모델을 불러오는 중/)
  await act(async () => locale.set({ active: 'zh-CN' }))
  assert.equal(find('[role=status]').textContent, '正在加载模型…')
  assert.equal(find('[role=dialog]').getAttribute('aria-label'), '推理强度')
  assert.match(find('.dsh-codex-trigger').getAttribute('aria-label'), /^选择推理级别:/)
  assert.equal(find('.dsh-codex-reset').getAttribute('aria-label'), '重置为默认值')
  await click('.dsh-codex-model')
  assert.equal(find('[role=radiogroup]').getAttribute('aria-label'), '选择模型')
  assert.match(find('[role=dialog]').textContent, /刷新模型列表/)
  await act(async () => locale.set({ active: 'en' }))
  assert.equal(find('[role=status]').textContent, 'Loading models…')
  await render({ sessionId: 'child' })
  assert.equal(container.textContent, '')
})
