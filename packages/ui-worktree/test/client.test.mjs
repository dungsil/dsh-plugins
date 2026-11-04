import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInThisContext } from 'node:vm'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Window } from 'happy-dom'

await test('built composer uses direct worktree RPC without touching prompts or drafts', async (t) => {
  const window = new Window()
  const previous = Object.getOwnPropertyDescriptors(globalThis)
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value })
  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  let plugin
  const require = createRequire(import.meta.url)
  const hostDependencies = new Set()
  let menuProps
  let hostMenuRenders = 0
  // Invocation-only boundary: this stub does not implement or verify host Menu
  // layout, portal placement, pointer dismissal, keyboard handling, or focus.
  function HostMenu(props) {
    menuProps = props
    hostMenuRenders++
    return createElement(
      'div',
      { 'data-unit-host-menu': true },
      props.anchor,
      props.open &&
        createElement(
          'div',
          { 'data-unit-menu-items': true },
          props.items.map((item) =>
            createElement(
              'button',
              {
                key: item.id,
                type: 'button',
                'data-menu-id': item.id,
                disabled: item.disabled,
                onClick: () => props.onSelect(item.id),
              },
              item.icon,
              item.label
            )
          )
        )
    )
  }
  const hostPrimitives = {
    Menu: HostMenu,
    Button: ({ variant: _variant, children, ...props }) => createElement('button', props, children),
    Input: ({ className, ...props }) => createElement('span', { className }, createElement('input', props)),
    Switch: ({ checked, onChange, label, disabled }) =>
      createElement('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
      }),
    IconPlusOutlineRegular: (props) => createElement('svg', { ...props, 'data-host-icon': 'plus' }),
    IconCloseOutlineRegular: (props) => createElement('svg', { ...props, 'data-host-icon': 'close' }),
    IconBranchOutlineRegular: (props) => createElement('svg', { ...props, 'data-host-icon': 'branch' }),
    IconChevronDownOutlineRegular: (props) => createElement('svg', { ...props, 'data-host-icon': 'chevron' }),
  }
  window.__ModuleLoader__ = {
    load: ({ id, factory }) => {
      assert.equal(id, '@dungsil/dsh-plugin-ui-worktree')
      plugin = factory((specifier) => {
        assert.ok(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(specifier))
        hostDependencies.add(specifier)
        // DSH supplies this module; keep the actual built client and replace
        // only the dependency boundary for unit invocation tests.
        if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return hostPrimitives
        return require(specifier)
      })
    },
  }
  runInThisContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'))
  assert.ok(
    hostDependencies.has('@deepseek-ai/dsh-client-ui-primitives'),
    'Menu and icons must be provided by the host'
  )
  const ctx = new Context()
  let Component
  let SettingsComponent
  let settingsOptions
  let language = 'ko'
  const calls = []
  let prompts = 0
  ctx.provide('slots', {
    inject: (_slot, callback) => callback(),
    register: (options, component) => {
      if (options.name === 'settings.section') {
        SettingsComponent = component
        settingsOptions = options
      } else {
        assert.equal(options.name, 'conversation.input.left')
        Component = component
      }
      return () => {}
    },
  })
  const locale = {
    listeners: new Set(),
    subscribe(listener) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    },
    getSnapshot: () => ({ active: language }),
  }
  ctx.provide('locale', locale)
  ctx.provide('sessions', {
    binding: () => ({
      session: {
        prompt: () => {
          prompts++
          throw new Error('Must not prompt')
        },
      },
    }),
  })
  const connection = {
    rpc: {
      call: (channel, endpoint, payload, signal) =>
        new Promise((resolve, reject) => {
          assert.equal(channel, '/api')
          assert.match(endpoint, /^dungsil-worktree\/(describe|create|switch|settings|save-settings)$/)
          assert.ok(signal instanceof AbortSignal)
          calls.push({ endpoint: endpoint.split('/')[1], payload, signal, resolve, reject })
        }),
    },
  }
  ctx.provide('connection', connection)
  await ctx.plugin(plugin)
  const document = window.document
  document.body.innerHTML =
    '<main></main><textarea>Keep my unsent draft @file</textarea><span data-attachment="file">file.txt</span>'
  const root = createRoot(document.querySelector('main'))
  t.after(async () => {
    await act(async () => {
      root.unmount()
      await ctx.fiber.dispose()
    })
    await window.happyDOM.close()
    for (const key of Object.keys(globals)) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key])
      else delete globalThis[key]
    }
  })
  const ready = { running: false, removed: false, openState: 'open', pendingSubmissions: [] }
  let snapshot = ready
  const render = async (sessionId = 'session-a') =>
    act(async () => {
      root.render(
        createElement(Component, {
          sessionId,
          useSession: (selector) => selector(snapshot),
          useAccess: () => {
            throw new Error('Do not borrow session/prompt authorization')
          },
        })
      )
    })
  const trigger = () => document.querySelector('.dsh-worktree-trigger')
  const branchName = () => document.querySelector('.dsh-worktree-name').textContent
  const dialog = () => document.querySelector('dialog')
  const field = () => document.querySelector('input[type=text]')
  const submitButton = () => document.querySelector('button[type=submit]')
  const openMenu = async () => {
    if (!menuProps.open) await act(async () => trigger().click())
  }
  const choose = async (id) => {
    if (trigger().disabled) {
      // A stale host callback must remain harmless even when its trigger is
      // disabled; the unit mock deliberately does not enforce this for us.
      await act(async () => menuProps.onSelect(id))
      return
    }
    await openMenu()
    const item = Array.from(document.querySelectorAll('[data-menu-id]')).find((button) => button.dataset.menuId === id)
    assert.ok(item, `host Menu must expose item ${id}`)
    await act(async () => item.click())
  }
  const refresh = async () =>
    act(async () => {
      if (dialog().open) document.querySelector('form footer button[type=button]').click()
      else if (document.querySelector('.dsh-worktree-error-trigger')) {
        document.querySelector('.dsh-worktree-error-trigger').click()
        document.querySelector('[data-worktree-retry]').click()
      } else window.dispatchEvent(new window.Event('focus'))
    })
  const focus = async () =>
    act(async () => {
      window.dispatchEvent(new window.Event('focus'))
    })
  const submit = async () =>
    act(async () => {
      document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    })
  const input = async (value) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field(), value)
      field().dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  const resolve = async (call, view) =>
    act(async () => {
      call.resolve({ ok: true, value: view })
    })
  const fail = async (call, code) =>
    act(async () => {
      call.resolve({ ok: false, error: { code, message: 'Server detail', details: {} } })
    })
  const original = {
    cwd: '/repo',
    worktrees: [
      { path: '/repo', branch: 'main' },
      { path: '/repo/worktrees/path with space', branch: 'feature/한글' },
      { path: '/repo/detached', branch: null },
    ],
  }
  const switched = { ...original, cwd: original.worktrees[1].path }
  const created = {
    cwd: '/repo/new',
    worktrees: [...original.worktrees, { path: '/repo/new', branch: 'feature/한글-"quote"' }],
  }

  await t.test(
    'mount, host Menu contract, current no-op, create, switch, duplicate prevention and refresh',
    async () => {
      await render()
      assert.ok(!document.querySelector('select'), 'worktree chooser must use the host Menu, not a native select')
      assert.ok(hostMenuRenders > 0, 'built client must render the Menu exported by the host dependency')
      assert.equal(hostPrimitives.Menu, HostMenu)
      assert.equal(menuProps.anchor.type, 'button')
      assert.ok(menuProps.anchor.ref, 'the host Menu anchor must retain the trigger ref')
      assert.equal(menuProps.side, 'top')
      assert.equal(menuProps.portal, true)
      assert.equal(menuProps.open, false)
      assert.equal(typeof menuProps.onSelect, 'function')
      assert.equal(typeof menuProps.onClose, 'function')
      assert.equal(trigger().disabled, true)
      assert.equal(trigger().getAttribute('aria-haspopup'), 'menu')
      assert.equal(trigger().getAttribute('aria-expanded'), 'false')
      assert.equal(trigger().getAttribute('aria-busy'), 'true')
      assert.equal(trigger().getAttribute('aria-label'), 'Git worktree')
      assert.equal(document.querySelector('.dsh-worktree-icon').tagName, 'SPAN')
      assert.equal(document.querySelector('.dsh-worktree-icon').getAttribute('aria-hidden'), 'true')
      assert.ok(document.querySelector('.dsh-worktree-icon svg[data-host-icon=branch]'))
      assert.ok(document.querySelector('.dsh-worktree-chevron svg[data-host-icon=chevron]'))
      assert.equal(document.querySelector('.dsh-worktree-chevron').tagName, 'SPAN')
      assert.equal(document.querySelector('.dsh-worktree-refresh'), null, 'composer must not show a refresh button')
      assert.equal(document.querySelector('[data-host-icon=refresh]'), null)
      assert.equal(document.querySelectorAll('.dsh-worktree-controls button').length, 1)
      assert.match(document.querySelector('[role=status]').textContent, /불러오는 중/)
      assert.deepEqual(calls.at(-1).payload, { sessionId: 'session-a' })
      const initial = calls.at(-1)
      await focus()
      await refresh()
      assert.equal(calls.at(-1), initial, 'loading must serialize refreshes')
      await resolve(initial, original)
      assert.equal(trigger().disabled, false)
      assert.equal(branchName(), 'main')
      assert.equal(trigger().title, 'main')
      assert.equal(trigger().getAttribute('aria-label'), 'Git worktree: main')
      assert.equal(menuProps.selectedId, 'path:/repo')
      assert.deepEqual(
        menuProps.items.map((item) => item.id),
        ['create', 'path:/repo', 'path:/repo/worktrees/path with space', 'path:/repo/detached']
      )
      assert.deepEqual(
        menuProps.items.map((item) => item.label),
        ['신규 워크트리…', 'main', 'feature/한글', '분리된 HEAD']
      )
      assert.equal(menuProps.items[0].icon.type, hostPrimitives.IconPlusOutlineRegular)
      for (const item of menuProps.items.slice(1)) assert.equal(item.icon.type, hostPrimitives.IconBranchOutlineRegular)
      await openMenu()
      assert.equal(menuProps.open, true)
      assert.equal(trigger().getAttribute('aria-expanded'), 'true')
      await act(async () => menuProps.onClose())
      assert.equal(menuProps.open, false, 'owner must honor host Menu dismissal')
      const count = calls.length
      await choose('path:/repo')
      assert.equal(calls.length, count)
      assert.equal(menuProps.open, false, 'current path selection must close without RPC')
      await choose('create')
      assert.equal(dialog().open, true)
      assert.equal(menuProps.open, false, 'create must close Menu before opening the existing dialog')
      assert.equal(menuProps.selectedId, 'path:/repo')
      await input('feature/한글-"quote"')
      for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
        await act(async () => {
          const event = new window.KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
            ...options,
          })
          field().dispatchEvent(event)
          assert.equal(event.defaultPrevented, true, 'IME Enter must not submit')
        })
      }
      const beforeCreate = calls.length
      await act(async () => {
        for (let index = 0; index < 2; index++)
          document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
      })
      assert.equal(calls.length, beforeCreate + 1, 'same-tick double submission must be serialized')
      const create = calls.at(-1)
      assert.equal(create.endpoint, 'create')
      assert.deepEqual(create.payload, { sessionId: 'session-a', cwd: '/repo', name: 'feature/한글-"quote"' })
      await submit()
      await choose('path:/repo/detached')
      await focus()
      await refresh()
      assert.equal(calls.at(-1), create, 'one mutation only while busy')
      assert.equal(submitButton().disabled, true)
      await act(async () => {
        const cancel = new window.Event('cancel', { cancelable: true })
        dialog().dispatchEvent(cancel)
        assert.equal(cancel.defaultPrevented, true, 'Escape must not hide an in-flight mutation')
      })
      await resolve(create, created)
      assert.equal(dialog().open, false)
      assert.equal(calls.at(-1).endpoint, 'describe', 'success must refresh the list')
      await resolve(calls.at(-1), created)
      assert.equal(field().value, '')
      assert.equal(document.activeElement, trigger(), 'return focus after success refresh finishes')
      assert.equal(branchName(), 'feature/한글-"quote"')
      assert.equal(trigger().getAttribute('aria-label'), 'Git worktree: feature/한글-"quote"')
      await choose(`path:${switched.cwd}`)
      const change = calls.at(-1)
      assert.equal(change.endpoint, 'switch')
      assert.deepEqual(change.payload, { sessionId: 'session-a', cwd: '/repo/new', path: switched.cwd })
      await resolve(change, switched)
      await resolve(calls.at(-1), switched)
      assert.equal(branchName(), 'feature/한글')
      await focus()
      assert.equal(calls.at(-1).endpoint, 'describe')
      await resolve(calls.at(-1), switched)
      assert.equal(document.querySelector('textarea').value, 'Keep my unsent draft @file')
      assert.equal(document.querySelector('[data-attachment]').textContent, 'file.txt')
      assert.equal(prompts, 0)
      const css = document.querySelector('style').textContent
      assert.match(css, /\.dsh-worktree-trigger/)
      assert.doesNotMatch(css, /\.dsh-worktree-select/)
      assert.equal(document.querySelector('.dsh-worktree-chevron').getAttribute('aria-hidden'), 'true')
      await openMenu()
      assert.equal(menuProps.open, true)
      await act(async () => window.dispatchEvent(new window.Event('resize')))
      assert.equal(menuProps.open, false, 'resize must close the owner-controlled Menu')
      await openMenu()
      await refresh()
      assert.equal(menuProps.open, false, 'loading must close Menu')
      assert.equal(trigger().disabled, true)
      await resolve(calls.at(-1), switched)
    }
  )

  await t.test('failures require explicit refresh, preserve branch drafts, and never retry automatically', async () => {
    await choose('create')
    await input('keep-this-branch')
    for (const code of ['busy', 'conflict', 'invalid', 'operation_failed', 'session_not_found', 'forbidden']) {
      await submit()
      const mutation = calls.at(-1)
      assert.equal(mutation.endpoint, 'create')
      await fail(mutation, code)
      assert.match(document.querySelector('dialog [role=alert]').textContent, /새로고침으로 상태를 확인/)
      assert.equal(field().value, 'keep-this-branch')
      assert.equal(dialog().open, true)
      assert.equal(submitButton().disabled, true)
      await submit()
      await focus()
      assert.equal(calls.at(-1), mutation, 'failure must not retry or silently requery')
      await act(async () => {
        document.querySelector('footer button[type=button]').click()
      })
      assert.equal(calls.at(-1).endpoint, 'describe')
      await resolve(calls.at(-1), switched)
      assert.equal(submitButton().disabled, false)
      assert.equal(field().value, 'keep-this-branch')
    }
    await submit()
    const uncertain = calls.at(-1)
    await act(async () => {
      uncertain.reject(new Error('Connection lost'))
    })
    assert.equal(submitButton().disabled, true)
    await focus()
    assert.equal(calls.at(-1), uncertain)
    await refresh()
    await resolve(calls.at(-1), switched)
    await input('')
    await submit()
    assert.deepEqual(calls.at(-1).payload, { sessionId: 'session-a', cwd: switched.cwd }, 'branch name is optional')
    await resolve(calls.at(-1), created)
    await fail(calls.at(-1), 'operation_failed')
    assert.equal(dialog().open, false)
    assert.ok(document.querySelector('.dsh-worktree-error-trigger'))
    assert.equal(trigger().disabled, true, 'failed success-refresh must require explicit recovery')
    await refresh()
    await resolve(calls.at(-1), created)
    await choose('path:/repo')
    const failedSwitch = calls.at(-1)
    await fail(failedSwitch, 'conflict')
    assert.equal(menuProps.selectedId, 'path:/repo/new')
    await focus()
    assert.equal(calls.at(-1), failedSwitch)
    await refresh()
    await resolve(calls.at(-1), created)
  })

  await t.test('session navigation discards delayed reads and writes even if transport ignores abort', async () => {
    await refresh()
    const oldRead = calls.at(-1)
    await render('session-b')
    assert.equal(oldRead.signal.aborted, true)
    const newRead = calls.at(-1)
    assert.deepEqual(newRead.payload, { sessionId: 'session-b' })
    const other = { cwd: '/other', worktrees: [{ path: '/other', branch: 'other' }] }
    await resolve(newRead, other)
    await resolve(oldRead, original)
    assert.equal(branchName(), 'other')
    await choose('create')
    await input('old-session-branch')
    await submit()
    const oldWrite = calls.at(-1)
    await render('session-c')
    assert.equal(oldWrite.signal.aborted, true)
    const thirdRead = calls.at(-1)
    await resolve(thirdRead, original)
    const count = calls.length
    await resolve(oldWrite, created)
    assert.equal(calls.length, count, 'stale mutation must not refresh the new session')
    assert.equal(dialog().open, false)
    assert.equal(field().value, '')
    assert.equal(branchName(), 'main')
    await choose('create')
    await submit()
    assert.equal(calls.at(-1).payload.sessionId, 'session-c')
    await resolve(calls.at(-1), created)
    await resolve(calls.at(-1), created)
  })

  await t.test('initial errors, empty lists, locale, idle restrictions, and dismissal remain accessible', async () => {
    await render('session-empty')
    await fail(calls.at(-1), 'forbidden')
    assert.equal(trigger().disabled, true)
    assert.equal(document.querySelector('.dsh-worktree-refresh'), null)
    assert.equal(document.querySelector('[data-worktree-retry]').disabled, false)
    await refresh()
    await resolve(calls.at(-1), { cwd: '/not-git', worktrees: [] })
    assert.match(document.querySelector('[role=status]').textContent, /Git worktree가 없습니다/)
    assert.equal(branchName(), '브랜치 확인 불가')
    assert.equal(menuProps.selectedId, undefined)
    assert.deepEqual(
      menuProps.items.map((item) => item.id),
      ['create'],
      'unavailable branch is a label, never a selectable synthetic item'
    )
    await act(async () => {
      language = 'en'
      for (const listener of locale.listeners) listener()
    })
    assert.equal(branchName(), 'Branch unavailable')
    await choose('create')
    assert.equal(document.querySelector('h2').textContent, 'Create worktree')
    await input('retained-on-dismiss')
    await act(async () => {
      const cancel = new window.Event('cancel', { cancelable: true })
      dialog().dispatchEvent(cancel)
      assert.equal(cancel.defaultPrevented, false, 'idle Escape may close the dialog')
      // happy-dom does not implement the native Escape default action.
      dialog().close()
    })
    await choose('create')
    assert.equal(field().value, 'retained-on-dismiss')
    for (const state of [
      { ...ready, running: true },
      { ...ready, removed: true },
      { ...ready, openState: 'loading' },
      { ...ready, pendingSubmissions: [{}] },
    ]) {
      snapshot = state
      await render('session-empty')
      assert.equal(trigger().disabled, true)
      assert.equal(submitButton().disabled, true)
      const count = calls.length
      await submit()
      assert.equal(calls.length, count)
    }
    snapshot = ready
    await render('session-empty')
    await act(async () => {
      document.querySelector('header button').click()
    })
    assert.equal(dialog().open, false)
    await refresh()
    await resolve(calls.at(-1), { ...original, cwd: '/repo/detached' })
    assert.equal(branchName(), 'Detached HEAD')
    await refresh()
    await resolve(calls.at(-1), { ...original, cwd: '/repo/worktrees/path with space/src' })
    assert.equal(branchName(), 'feature/한글')
    assert.equal(menuProps.selectedId, 'path:/repo/worktrees/path with space')
    assert.deepEqual(
      menuProps.items.map((item) => item.id),
      ['create', ...original.worktrees.map((item) => `path:${item.path}`)]
    )
    const count = calls.length
    await choose(menuProps.selectedId)
    assert.equal(calls.length, count, 'a nested cwd must still identify the selected worktree as a no-op')
    assert.equal(prompts, 0)
    assert.equal(document.querySelector('textarea').value, 'Keep my unsent draft @file')
  })

  await t.test('Windows cwd separators identify the current worktree without a redundant switch', async () => {
    const windows = {
      cwd: 'C:\\repo\\feature\\src',
      worktrees: [
        { path: 'C:/repo', branch: 'main' },
        { path: 'C:/repo/feature', branch: 'windows-feature' },
      ],
    }
    await render('session-windows')
    await resolve(calls.at(-1), windows)
    assert.equal(branchName(), 'windows-feature')
    assert.equal(menuProps.selectedId, 'path:C:/repo/feature')
    const count = calls.length
    await choose(menuProps.selectedId)
    assert.equal(calls.length, count)
    await refresh()
    await resolve(calls.at(-1), { ...windows, cwd: 'c:\\repo\\' })
    assert.equal(branchName(), 'main')
    await refresh()
    await resolve(calls.at(-1), {
      cwd: '\\\\server\\share\\repo\\src',
      worktrees: [{ path: '//server/share/repo', branch: 'network-share' }],
    })
    assert.equal(branchName(), 'network-share')
  })

  await t.test('sidebar hints follow the current linked worktree without replacing native controls', async () => {
    const sidebar = document.createElement('aside')
    sidebar.innerHTML = `
      <div data-row-key="session:session-sidebar"><span>Current session</span><span data-actions><button>More</button></span></div>
      <div data-row-key="session:session-other"><span>Other session</span><span data-actions><button>More</button></span></div>`
    document.body.append(sidebar)
    const row = sidebar.firstElementChild
    const actions = row.lastElementChild
    const hint = () => row.querySelector('.dsh-worktree-sidebar-name')
    await render('session-sidebar')
    assert.equal(hint(), null, 'do not invent a name while loading')
    await resolve(calls.at(-1), { ...switched, cwd: `${switched.cwd}/src` })
    assert.equal(hint().textContent, 'feature/한글')
    assert.equal(hint().title, switched.cwd)
    assert.equal(hint().nextElementSibling, actions, 'hint belongs immediately before the original action strip')
    assert.equal(actions.firstElementChild.textContent, 'More')
    assert.equal(sidebar.lastElementChild.querySelector('.dsh-worktree-sidebar-name'), null)
    row.remove()
    sidebar.prepend(row.cloneNode(true))
    // Simulate a newly mounted native row rather than copying the plugin's metadata.
    sidebar.firstElementChild.querySelector('.dsh-worktree-sidebar-name').remove()
    await window.happyDOM.waitUntilComplete()
    assert.equal(sidebar.querySelectorAll('.dsh-worktree-sidebar-name').length, 1)
    await refresh()
    await resolve(calls.at(-1), { ...original, cwd: '/repo/detached' })
    assert.equal(sidebar.querySelector('.dsh-worktree-sidebar-name').textContent, 'detached')
    await refresh()
    await resolve(calls.at(-1), original)
    assert.equal(sidebar.querySelector('.dsh-worktree-sidebar-name'), null, 'main checkout needs no hint')
    await refresh()
    await resolve(calls.at(-1), switched)
    assert.equal(sidebar.querySelectorAll('.dsh-worktree-sidebar-name').length, 1)
    await render('session-other')
    assert.equal(sidebar.querySelector('.dsh-worktree-sidebar-name'), null, 'navigation cleans up the previous session')
    await resolve(calls.at(-1), { cwd: '/not-git', worktrees: [] })
    assert.equal(sidebar.querySelector('.dsh-worktree-sidebar-name'), null)
    sidebar.remove()
  })

  await t.test('lookup errors use a compact details control without exposing raw server text', async () => {
    await act(async () => {
      language = 'ko'
      for (const listener of locale.listeners) listener()
    })
    await render('session-error-details')
    await fail(calls.at(-1), 'busy')
    assert.ok(!document.querySelector('.dsh-worktree-error'), 'long errors must not appear in the composer toolbar')
    const details = document.querySelector('.dsh-worktree-error-trigger')
    assert.ok(details)
    assert.equal(details.textContent, '조회 실패')
    assert.equal(details.getAttribute('aria-haspopup'), 'dialog')
    await act(async () => details.click())
    const errorDialog = document.querySelector('.dsh-worktree-error-dialog')
    assert.equal(errorDialog.open, true)
    assert.match(errorDialog.textContent, /busy/)
    assert.match(errorDialog.textContent, /작업/)
    assert.doesNotMatch(errorDialog.textContent, /Server detail/)
    await act(async () => errorDialog.querySelector('button[data-worktree-retry]').click())
    assert.equal(calls.at(-1).endpoint, 'describe')
    await resolve(calls.at(-1), original)
    assert.equal(errorDialog.open, false)
    assert.equal(document.querySelector('.dsh-worktree-error-trigger'), null)
    assert.equal(branchName(), 'main')
    assert.equal(document.activeElement, trigger())
  })

  await t.test(
    'client and transport failures expose safe codes without raw details and remain recoverable',
    async () => {
      const warn = console.warn
      const logs = []
      console.warn = (...args) => logs.push(args)
      const originalCall = connection.rpc.call
      try {
        connection.rpc.call = undefined
        await render('session-no-rpc')
        assert.equal(logs.at(-1)[1].code, 'client_unavailable')
        assert.match(document.querySelector('.dsh-worktree-error-dialog').textContent, /client_unavailable/)
        connection.rpc.call = originalCall
        await refresh()
        await resolve(calls.at(-1), original)
        for (const [failure, expectedCode] of [
          [new Error('private credential detail: HTTP 401'), 'auth_required'],
          [{ code: 'private credential detail' }, 'operation_failed'],
        ]) {
          await refresh()
          await act(async () => calls.at(-1).reject(failure))
          assert.equal(logs.at(-1)[1].code, expectedCode)
          const details = document.querySelector('.dsh-worktree-error-trigger')
          await act(async () => details.click())
          const errorDialog = document.querySelector('.dsh-worktree-error-dialog')
          assert.equal(errorDialog.open, true)
          assert.match(errorDialog.textContent, new RegExp(expectedCode))
          assert.doesNotMatch(errorDialog.textContent, /private credential detail/)
          await act(async () => errorDialog.querySelector('header button').click())
          assert.equal(errorDialog.open, false)
          assert.equal(document.activeElement, details)
          await focus()
          const failed = calls.at(-1)
          await focus()
          assert.equal(calls.at(-1), failed)
          await refresh()
          await resolve(calls.at(-1), original)
        }
        await refresh()
        await resolve(calls.at(-1), { cwd: '/repo', worktrees: [null] })
        assert.equal(logs.at(-1)[1].code, 'invalid_response')
        assert.doesNotMatch(JSON.stringify(logs), /private credential detail/)
        assert.ok(
          logs.every(
            ([prefix, detail]) =>
              prefix === '[dungsil-ui-worktree]' && Object.keys(detail).join(',') === 'operation,code'
          )
        )
        await refresh()
        await resolve(calls.at(-1), original)
      } finally {
        connection.rpc.call = originalCall
        console.warn = warn
      }
    }
  )

  await t.test('owner closes Menu on every session lock and rejects stale selections', async () => {
    await render('session-empty')
    await resolve(calls.at(-1), original)
    for (const state of [
      { ...ready, running: true },
      { ...ready, removed: true },
      { ...ready, openState: 'loading' },
      { ...ready, pendingSubmissions: [{}] },
    ]) {
      snapshot = ready
      await render('session-empty')
      await openMenu()
      assert.equal(menuProps.open, true)
      snapshot = state
      await render('session-empty')
      assert.equal(trigger().disabled, true)
      assert.equal(menuProps.open, false, 'a locked session must close the owner-controlled Menu')
      assert.equal(trigger().getAttribute('aria-expanded'), 'false')
      const count = calls.length
      await choose('create')
      await choose('path:/repo')
      assert.equal(dialog().open, false, 'disabled create selection must not open a dialog')
      assert.equal(calls.length, count, 'disabled switch selection must not call RPC')
    }
    snapshot = ready
    await render('session-empty')
  })

  const defaults = {
    revision: 'initial',
    settings: { directory: '.agents/worktrees', remote: false, naming: 'semantic', prefix: '' },
  }
  const renderSettings = async (key = 'settings') =>
    act(async () => {
      root.render(createElement(SettingsComponent, { key, ...settingsOptions.inject() }))
    })
  const directory = () => document.querySelector('input[id$="-directory"]')
  const prefix = () => document.querySelector('input[id$="-prefix"]')
  const remoteSwitch = () => document.querySelector('[role=switch]')
  const chooseNaming = async (id) => {
    await act(async () => document.querySelector('.dsh-worktree-settings-selector').click())
    await act(async () => document.querySelector(`[data-menu-id="${id}"]`).click())
  }
  const editSettings = async (element, value) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(element, value)
      element.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  const saveResult = (call, revision) => ({ revision, settings: { ...call.payload.settings } })
  const assertNoSettingsButtons = () => {
    assert.equal(document.querySelector('footer'), null)
    assert.equal(document.querySelector('button[type=submit]'), null)
    assert.doesNotMatch(document.querySelector('section').textContent, /설정 새로고침|Reload settings/)
  }

  await t.test('settings auto-loads and saves every valid change without action buttons', async () => {
    assert.equal(settingsOptions.id, 'dungsil-ui-worktree')
    assert.equal(settingsOptions.order, 16)
    await renderSettings()
    const initial = calls.at(-1)
    assert.equal(initial.endpoint, 'settings')
    assert.deepEqual(initial.payload, {})
    assert.equal(document.querySelector('section').getAttribute('aria-busy'), 'true')
    assert.match(document.querySelector('[role=status]').textContent, /불러오는 중/)
    assertNoSettingsButtons()
    await focus()
    await submit()
    assert.equal(calls.at(-1), initial)
    await resolve(initial, defaults)
    assert.equal(directory().value, '.agents/worktrees')
    assert.equal(remoteSwitch().getAttribute('aria-label'), '추적 중인 원격 브랜치 사용')
    assert.equal(document.querySelector('h2'), null)
    assert.equal(prefix(), null)
    assert.equal(menuProps.selectedId, 'semantic')
    assertNoSettingsButtons()

    await act(async () => remoteSwitch().click())
    let saving = calls.at(-1)
    assert.equal(saving.endpoint, 'save-settings')
    assert.deepEqual(saving.payload, { revision: 'initial', settings: { ...defaults.settings, remote: true } })
    assert.match(document.querySelector('[role=status]').textContent, /저장 중/)
    await resolve(saving, saveResult(saving, 'remote-1'))
    assert.match(document.querySelector('[role=status]').textContent, /저장했습니다/)

    await chooseNaming('dsh')
    saving = calls.at(-1)
    assert.equal(saving.payload.settings.naming, 'dsh')
    assert.equal(saving.payload.revision, 'remote-1')
    await resolve(saving, saveResult(saving, 'naming-1'))
    const before = calls.length
    await chooseNaming('custom')
    assert.ok(prefix())
    assert.equal(prefix().getAttribute('aria-invalid'), 'true')
    assert.match(document.querySelector('[role=alert]').textContent, /접두사/)
    assert.equal(calls.length, before, 'an empty custom prefix must not reach the server')
    await editSettings(prefix(), 'team/')
    saving = calls.at(-1)
    assert.equal(saving.payload.settings.naming, 'custom')
    assert.equal(saving.payload.settings.prefix, 'team/')
    const saved = saveResult(saving, 'prefix-1')
    await resolve(saving, saved)
    await renderSettings('settings-reopened')
    await resolve(calls.at(-1), saved)
    assert.equal(prefix().value, 'team/')
    assert.equal(remoteSwitch().getAttribute('aria-checked'), 'true')
    await chooseNaming('semantic')
    saving = calls.at(-1)
    assert.equal(prefix(), null)
    assert.equal(saving.payload.settings.prefix, 'team/')
    await resolve(saving, saveResult(saving, 'naming-2'))
  })

  await t.test(
    'settings serializes rapid edits with the newest revision without losing focus or queued changes',
    async () => {
      directory().focus()
      await editSettings(directory(), '../w')
      const first = calls.at(-1)
      const before = calls.length
      assert.equal(first.endpoint, 'save-settings')
      assert.equal(document.querySelector('fieldset').disabled, false)
      assert.equal(document.activeElement, directory())
      await editSettings(directory(), '../worktrees with space')
      await act(async () => remoteSwitch().click())
      await chooseNaming('custom')
      await editSettings(prefix(), 'task-')
      await focus()
      await submit()
      assert.equal(calls.length, before, 'pending edits must coalesce behind one active write')
      await resolve(first, saveResult(first, 'rapid-1'))
      const queued = calls.at(-1)
      assert.equal(queued.endpoint, 'save-settings')
      assert.deepEqual(queued.payload, {
        revision: 'rapid-1',
        settings: { directory: '../worktrees with space', remote: false, naming: 'custom', prefix: 'task-' },
      })
      assert.equal(directory().value, '../worktrees with space')
      assert.equal(prefix().value, 'task-')
      await resolve(queued, saveResult(queued, 'rapid-2'))
      assert.equal(document.querySelector('section').getAttribute('aria-busy'), 'false')
      assert.match(document.querySelector('[role=status]').textContent, /저장했습니다/)
      const count = calls.length
      await editSettings(directory(), directory().value)
      await submit()
      assert.equal(calls.length, count, 'unchanged values and form submit must not write')
    }
  )

  await t.test('invalid text stays editable and never auto-saves or gets overwritten by focus refresh', async () => {
    for (const value of ['', '   ', 'x'.repeat(4097)]) {
      const before = calls.length
      await editSettings(directory(), value)
      await focus()
      assert.equal(calls.length, before)
      assert.equal(directory().value, value)
      assert.equal(directory().getAttribute('aria-invalid'), 'true')
      assert.match(document.querySelector('[role=alert]').textContent, /4096/)
    }
    await editSettings(directory(), '/absolute/worktrees')
    let saving = calls.at(-1)
    assert.equal(saving.payload.settings.directory, '/absolute/worktrees')
    await resolve(saving, saveResult(saving, 'valid-directory'))
    for (const value of ['', 'bad//prefix', '-leading', 'a'.repeat(101)]) {
      const count = calls.length
      await editSettings(prefix(), value)
      assert.equal(calls.length, count)
      assert.equal(prefix().getAttribute('aria-invalid'), 'true')
    }
    await chooseNaming('dsh')
    saving = calls.at(-1)
    assert.equal(saving.payload.settings.prefix, '', 'hidden invalid prefixes must not prevent a valid naming choice')
    await resolve(saving, saveResult(saving, 'valid-naming'))
    await editSettings(directory(), '/in-flight')
    saving = calls.at(-1)
    await editSettings(directory(), '')
    const count = calls.length
    await resolve(saving, saveResult(saving, 'valid-in-flight'))
    assert.equal(calls.length, count, 'a queued invalid value must not reach the server')
    assert.equal(directory().value, '')
    assert.equal(document.querySelector('[role=status]').textContent, '')
    await editSettings(directory(), '/valid-again')
    saving = calls.at(-1)
    assert.equal(saving.payload.revision, 'valid-in-flight')
    await resolve(saving, saveResult(saving, 'valid-again'))
  })

  await t.test('failed writes automatically reload authoritative settings without retrying mutations', async () => {
    for (const code of ['conflict', 'invalid', 'forbidden', 'operation_failed']) {
      await editSettings(directory(), '/unsaved/draft')
      const failed = calls.at(-1)
      await editSettings(directory(), '/queued-draft')
      await fail(failed, code)
      assert.match(
        document.querySelector('[role=alert]').textContent,
        code === 'conflict' ? /다른 곳에서/ : /변경 결과/
      )
      assert.doesNotMatch(document.querySelector('[role=alert]').textContent, /Server detail/)
      assert.equal(calls.at(-1).endpoint, 'settings')
      assert.equal(document.querySelector('fieldset').disabled, true)
      const reload = calls.at(-1)
      await focus()
      await submit()
      assert.equal(calls.at(-1), reload)
      await resolve(reload, defaults)
      assert.equal(directory().value, '.agents/worktrees')
      assert.equal(remoteSwitch().disabled, false)
      assert.ok(document.querySelector('[role=alert]'), 'reconciliation must not hide the failed save')
      assert.match(document.querySelector('[role=status]').textContent, /다시 불러왔습니다/)
      assert.equal(calls.at(-1), reload, 'queued edits from a failed write must not retry automatically')
    }
    await editSettings(directory(), '/uncertain')
    const uncertain = calls.at(-1)
    await act(async () => uncertain.reject(new Error('Connection lost')))
    assert.equal(calls.at(-1).endpoint, 'settings')
    await fail(calls.at(-1), 'operation_failed')
    assert.equal(document.querySelector('fieldset').disabled, true)
    assert.match(document.querySelector('[role=alert]').textContent, /다시 여세요/)
    const count = calls.length
    await editSettings(directory(), '/blocked')
    assert.equal(calls.length, count)
    await act(async () => window.dispatchEvent(new window.Event('online')))
    assert.equal(calls.at(-1).endpoint, 'settings')
    await resolve(calls.at(-1), defaults)
    assert.equal(document.querySelector('fieldset').disabled, false)
    assert.equal(directory().value, '.agents/worktrees')
    assert.equal(document.querySelector('[role=alert]'), null)
    await act(async () => {
      language = 'en'
      for (const listener of locale.listeners) listener()
    })
    assert.equal(settingsOptions.label(), 'Worktrees')
    assert.match(document.querySelector('section').textContent, /locally fetched remote reference/)
    assertNoSettingsButtons()
  })

  await t.test('settings ignores stale reads, writes and recovery reads after unmount', async () => {
    await focus()
    const staleRead = calls.at(-1)
    await renderSettings('new-settings')
    assert.equal(staleRead.signal.aborted, true)
    await resolve(calls.at(-1), defaults)
    await resolve(staleRead, { ...defaults, settings: { ...defaults.settings, directory: '/stale' } })
    assert.equal(directory().value, '.agents/worktrees')
    await editSettings(directory(), '/stale-write')
    const staleWrite = calls.at(-1)
    await editSettings(directory(), '/stale-queued')
    await renderSettings('newer-settings')
    assert.equal(staleWrite.signal.aborted, true)
    await resolve(calls.at(-1), defaults)
    const count = calls.length
    await fail(staleWrite, 'conflict')
    assert.equal(directory().value, '.agents/worktrees')
    assert.equal(calls.length, count)
    await editSettings(directory(), '/recover')
    await fail(calls.at(-1), 'conflict')
    const staleRecovery = calls.at(-1)
    await renderSettings('newest-settings')
    assert.equal(staleRecovery.signal.aborted, true)
    await resolve(calls.at(-1), defaults)
    await resolve(staleRecovery, { ...defaults, settings: { ...defaults.settings, directory: '/stale' } })
    assert.equal(directory().value, '.agents/worktrees')
    assert.equal(document.querySelector('[role=status]').textContent, '')
    await renderSettings('initial-failure')
    await fail(calls.at(-1), 'forbidden')
    assert.ok(document.querySelector('[role=alert]'))
    assert.equal(directory(), null)
    assertNoSettingsButtons()
    await focus()
    await resolve(calls.at(-1), defaults)
    assert.equal(directory().value, '.agents/worktrees')
    assert.equal(prompts, 0)
    assert.equal(document.querySelector('textarea').value, 'Keep my unsent draft @file')
  })

  await t.test('settings creates a fresh lifetime when React StrictMode replays effects', async () => {
    const { StrictMode } = await import('react')
    const before = calls.length
    await act(async () =>
      root.render(createElement(StrictMode, null, createElement(SettingsComponent, settingsOptions.inject())))
    )
    const reads = calls.slice(before)
    assert.equal(reads.length, 2)
    assert.equal(reads[0].signal.aborted, true)
    assert.equal(reads[1].signal.aborted, false)
    await resolve(reads[1], defaults)
    await resolve(reads[0], { ...defaults, settings: { ...defaults.settings, directory: '/stale-strict' } })
    assert.equal(directory().value, '.agents/worktrees')
    await act(async () => remoteSwitch().click())
    const saving = calls.at(-1)
    assert.equal(saving.signal.aborted, false)
    await resolve(saving, saveResult(saving, 'strict-save'))
    assert.equal(remoteSwitch().getAttribute('aria-checked'), 'true')
  })
})
