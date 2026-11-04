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
  window.__ModuleLoader__ = {
    load: ({ id, factory }) => {
      assert.equal(id, '@dungsil/dsh-plugin-ui-worktree')
      plugin = factory((specifier) => {
        assert.ok(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'].includes(specifier))
        hostDependencies.add(specifier)
        // DSH supplies this module; its unrelated UI dependencies are not part
        // of this plugin's unit-test runtime. Keep the actual built client.
        if (specifier === '@deepseek-ai/dsh-client-ui-primitives')
          return {
            IconBranchOutlineRegular: (props) => createElement('svg', { ...props, 'data-host-icon': 'branch' }),
            IconChevronDownOutlineRegular: (props) => createElement('svg', { ...props, 'data-host-icon': 'chevron' }),
          }
        return require(specifier)
      })
    },
  }
  runInThisContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'))
  assert.ok(hostDependencies.has('@deepseek-ai/dsh-client-ui-primitives'), 'icons must be provided by the host')
  const ctx = new Context()
  let Component
  let language = 'ko'
  const calls = []
  let prompts = 0
  ctx.provide('slots', {
    inject: (_slot, callback) => callback(),
    register: (_options, component) => {
      Component = component
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
  ctx.provide('connection', {
    rpc: {
      call: (channel, endpoint, payload, signal) =>
        new Promise((resolve, reject) => {
          assert.equal(channel, '/api')
          assert.match(endpoint, /^dungsil-worktree\/(describe|create|switch)$/)
          assert.ok(signal instanceof AbortSignal)
          calls.push({ endpoint: endpoint.split('/')[1], payload, signal, resolve, reject })
        }),
    },
  })
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
  const select = () => document.querySelector('select')
  const dialog = () => document.querySelector('dialog')
  const field = () => document.querySelector('input[type=text]')
  const submitButton = () => document.querySelector('button[type=submit]')
  const choose = async (value) =>
    act(async () => {
      select().value = value
      select().dispatchEvent(new window.Event('change', { bubbles: true }))
    })
  const refresh = async () =>
    act(async () => {
      document.querySelector('.dsh-worktree-refresh').click()
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

  await t.test('mount, native options, current no-op, create, switch, duplicate prevention and refresh', async () => {
    await render()
    assert.equal(select().disabled, true)
    assert.equal(select().getAttribute('aria-busy'), 'true')
    assert.equal(select().getAttribute('aria-label'), 'Git worktree')
    assert.equal(document.querySelector('.dsh-worktree-branch').getAttribute('aria-hidden'), 'true')
    assert.match(document.querySelector('[role=status]').textContent, /불러오는 중/)
    assert.deepEqual(calls.at(-1).payload, { sessionId: 'session-a' })
    const initial = calls.at(-1)
    await focus()
    await refresh()
    assert.equal(calls.at(-1), initial, 'loading must serialize refreshes')
    await resolve(initial, original)
    assert.equal(select().disabled, false)
    assert.equal(select().options[0].textContent, 'main')
    assert.equal(select().title, 'main')
    assert.equal(select().getAttribute('aria-label'), 'Git worktree: main')
    assert.deepEqual(
      Array.from(select().options, (option) => option.value),
      ['current', 'create', 'path:/repo/worktrees/path with space', 'path:/repo/detached']
    )
    assert.equal(select().options[2].textContent, 'feature/한글')
    assert.equal(select().options[3].textContent, '분리된 HEAD')
    const count = calls.length
    await choose('current')
    assert.equal(calls.length, count)
    await choose('create')
    assert.equal(dialog().open, true)
    assert.equal(select().value, 'current')
    await input('feature/한글-"quote"')
    for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
      await act(async () => {
        const event = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options })
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
    assert.equal(document.activeElement, select(), 'return focus after success refresh finishes')
    assert.equal(select().options[0].textContent, 'feature/한글-"quote"')
    assert.equal(select().getAttribute('aria-label'), 'Git worktree: feature/한글-"quote"')
    await choose(`path:${switched.cwd}`)
    const change = calls.at(-1)
    assert.equal(change.endpoint, 'switch')
    assert.deepEqual(change.payload, { sessionId: 'session-a', cwd: '/repo/new', path: switched.cwd })
    await resolve(change, switched)
    await resolve(calls.at(-1), switched)
    assert.equal(select().options[0].textContent, 'feature/한글')
    await focus()
    assert.equal(calls.at(-1).endpoint, 'describe')
    await resolve(calls.at(-1), switched)
    assert.equal(document.querySelector('textarea').value, 'Keep my unsent draft @file')
    assert.equal(document.querySelector('[data-attachment]').textContent, 'file.txt')
    assert.equal(prompts, 0)
    const css = document.querySelector('style').textContent
    assert.match(css, /appearance: none/)
    assert.match(css, /pointer-events: none/)
    assert.equal(document.querySelector('.dsh-worktree-chevron').getAttribute('aria-hidden'), 'true')
  })

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
    assert.ok(document.querySelector('.dsh-worktree-error'))
    assert.equal(select().disabled, true, 'failed success-refresh must require explicit recovery')
    await refresh()
    await resolve(calls.at(-1), created)
    await choose('path:/repo')
    const failedSwitch = calls.at(-1)
    await fail(failedSwitch, 'conflict')
    assert.equal(select().value, 'current')
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
    assert.equal(select().options[0].textContent, 'other')
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
    assert.equal(select().options[0].textContent, 'main')
    await choose('create')
    await submit()
    assert.equal(calls.at(-1).payload.sessionId, 'session-c')
    await resolve(calls.at(-1), created)
    await resolve(calls.at(-1), created)
  })

  await t.test('initial errors, empty lists, locale, idle restrictions, and dismissal remain accessible', async () => {
    await render('session-empty')
    await fail(calls.at(-1), 'forbidden')
    assert.equal(select().disabled, true)
    assert.equal(document.querySelector('.dsh-worktree-refresh').disabled, false)
    await refresh()
    await resolve(calls.at(-1), { cwd: '/not-git', worktrees: [] })
    assert.match(document.querySelector('[role=status]').textContent, /Git worktree가 없습니다/)
    assert.equal(select().options[0].textContent, '브랜치 확인 불가')
    assert.equal(select().options.length, 2)
    await act(async () => {
      language = 'en'
      for (const listener of locale.listeners) listener()
    })
    assert.equal(select().options[0].textContent, 'Branch unavailable')
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
      assert.equal(select().disabled, true)
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
    assert.equal(select().options[0].textContent, 'Detached HEAD')
    await refresh()
    await resolve(calls.at(-1), { ...original, cwd: '/repo/worktrees/path with space/src' })
    assert.equal(select().options[0].textContent, 'feature/한글')
    assert.equal(prompts, 0)
    assert.equal(document.querySelector('textarea').value, 'Keep my unsent draft @file')
  })
})
