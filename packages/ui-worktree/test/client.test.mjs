import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Window } from 'happy-dom'

test('composer creates directly, preserves input, and keeps session delivery isolated', async (t) => {
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
  window.__ModuleLoader__ = {
    load: ({ factory }) => {
      plugin = factory(createRequire(import.meta.url))
    },
  }
  new Function('window', await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'))(window)
  const ctx = new Context()
  let Component
  let language = 'ko'
  const messages = []
  const creations = []
  let settle
  let fail = false
  ctx.provide('connection', {
    rpc: {
      call: async (_channel, _method, payload) => {
        if (fail) return { ok: false, error: { code: 'worktrees_unavailable' } }
        creations.push(payload)
        await new Promise((resolve) => {
          settle = resolve
        })
        return { ok: true, value: { branch: payload.name || 'generated-name', path: '/repo/.worktrees/new' } }
      },
    },
  })
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
    binding: (sessionId) => ({
      session: {
        prompt: async (content) => {
          if (fail) return { ok: false, error: { code: 'offline' } }
          messages.push({ sessionId, text: content[0].text })
          await new Promise((resolve) => {
            settle = resolve
          })
          return { ok: true, value: { accepted: true } }
        },
      },
    }),
  })
  await ctx.plugin(plugin)
  const document = window.document
  document.body.innerHTML = '<main></main><textarea>Keep my unsent draft @file</textarea>'
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
  let snapshot = { running: false, removed: false, openState: 'open', pendingSubmissions: [] }
  let allowed = true
  const render = async (sessionId = 'session-a') =>
    act(async () => {
      root.render(
        createElement(Component, { sessionId, useSession: (selector) => selector(snapshot), useAccess: () => allowed })
      )
    })
  const click = async (selector) =>
    act(async () => {
      document.querySelector(selector).click()
    })
  const submit = async () =>
    act(async () => {
      document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    })
  const input = async (value) =>
    act(async () => {
      const field = document.querySelector('input[type=text]')
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(field, value)
      field.dispatchEvent(new window.Event('input', { bubbles: true }))
    })
  const finish = async () =>
    act(async () => {
      settle()
    })
  await render()
  await click('.dsh-worktree-trigger')
  assert.equal(document.querySelector('dialog').open, true)
  await input('feature/한글-"quote"')
  await submit()
  await submit()
  assert.equal(creations.length, 1, 'double submission must create only once')
  assert.deepEqual(creations[0], { sessionId: 'session-a', name: 'feature/한글-"quote"' })
  assert.equal(messages.length, 0, 'creation must not start an agent turn')
  assert.equal(document.querySelector('textarea').value, 'Keep my unsent draft @file')
  assert.equal(document.querySelector('button[type=submit]').disabled, true)
  await finish()
  assert.equal(document.querySelector('dialog').open, false)
  assert.match(document.querySelector('[role=status]').textContent, /생성 및 전환 완료:.*feature\/한글/)
  assert.match(document.querySelector('[role=status]').textContent, /\/repo\/\.worktrees\/new/)

  fail = true
  await click('.dsh-worktree-trigger')
  await input('retry-name')
  await submit()
  assert.match(document.querySelector('[role=alert]').textContent, /Git worktrees를 켠 뒤/)
  assert.equal(document.querySelector('input[type=text]').value, 'retry-name')
  fail = false
  await submit()
  await render('session-b')
  await finish()
  assert.equal(creations.at(-1).sessionId, 'session-a')
  assert.equal(document.querySelector('[role=status]').textContent, '')
  await render()

  await click('.dsh-worktree-trigger')
  await click('input[type=radio]:not(:checked)')
  assert.equal(document.querySelector('button[type=submit]').disabled, true)
  await click('footer button[type=button]')
  assert.match(messages.at(-1).text, /읽기 전용/)
  assert.match(messages.at(-1).text, /작업 경로를 바꾸지 말고/)
  await finish()
  await click('.dsh-worktree-trigger')
  await input('/repo/worktrees/path with space')
  await submit()
  assert.match(messages.at(-1).text, /working_directory\(\{cd: path\}\)/)
  assert.ok(messages.at(-1).text.includes('{"path":"/repo/worktrees/path with space"}'))
  assert.match(messages.at(-1).text, /일치하는 worktree가 없으면 중단/)
  await finish()

  fail = true
  await click('.dsh-worktree-trigger')
  await input('/repo/retry')
  await submit()
  assert.match(document.querySelector('[role=alert]').textContent, /재시도 전에 대화를 확인/)
  assert.equal(document.querySelector('input[type=text]').value, '/repo/retry')
  assert.equal(document.querySelector('dialog').open, true)
  fail = false
  await submit()
  await render('session-b')
  await finish()
  assert.equal(messages.at(-1).sessionId, 'session-a', 'navigation must not retarget an in-flight request')
  assert.equal(document.querySelector('input[type=text]').value, '')
  assert.equal(document.querySelector('[role=status]').textContent, '')

  await act(async () => {
    language = 'en'
    for (const listener of locale.listeners) listener()
  })
  await click('.dsh-worktree-trigger')
  assert.equal(document.querySelector('h2').textContent, 'Git worktree')
  assert.equal(document.querySelector('button[type=submit]').textContent, 'Create new')
  await submit()
  assert.deepEqual(creations.at(-1), { sessionId: 'session-b', name: '' })
  await finish()
  for (const state of [
    { ...snapshot, running: true },
    { ...snapshot, removed: true },
    { ...snapshot, openState: 'loading' },
    { ...snapshot, pendingSubmissions: [{}] },
  ]) {
    snapshot = state
    await render('session-b')
    assert.equal(document.querySelector('.dsh-worktree-trigger').disabled, true)
  }
  snapshot = { running: false, removed: false, openState: 'open', pendingSubmissions: [] }
  allowed = false
  await render('session-b')
  assert.equal(document.querySelector('.dsh-worktree-trigger').disabled, true)
})
