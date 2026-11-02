import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
const flatKey = '__flat_session_order__'

function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set(next) {
      value = next
      for (const fn of listeners) fn()
    },
  }
}

function setup(saved = '{}') {
  const browser = new Window()
  browser.localStorage.setItem('dungsil.sidebar-inbox.v1', saved)
  const rows = [
    { id: 'idle', updatedAt: 20 },
    { id: 'running', updatedAt: 50, running: true },
    { id: 'settled', updatedAt: 100 },
    { id: 'approval', updatedAt: 30, running: true },
    { id: 'pinned', updatedAt: 1 },
    { id: 'child', updatedAt: 99, origin: 'subagent' },
    { id: 'unused-blank', updatedAt: 200, blank: true },
  ].map((row) => ({ title: row.id, displayTitle: row.id, running: false, blank: false, retainedBy: {}, ...row }))
  const sessions = observable({
    phase: 'ready',
    ids: rows.map((row) => row.id),
    byId: Object.fromEntries(rows.map((row) => [row.id, row])),
    projectionsBySession: {},
  })
  const statuses = observable(
    new Map([
      ['approval', { running: true, pendingInteraction: { kind: 'approval' } }],
      ['idle', { running: false, completionUnread: true }],
    ])
  )
  const workspaces = observable({ phase: 'ready', pinnedSessionIds: ['pinned'], archivedSessionIds: [] })
  const original = {
    groupBy: 'workspace',
    orderBy: 'updated',
    sessionOrderByAccount: { old: ['idle'] },
    archivedFilter: 'default',
  }
  const view = observable(original)
  view.store = view
  let menu
  let dispose
  let plugin
  runInNewContext(source, {
    document: browser.document,
    localStorage: browser.localStorage,
    Element: browser.Element,
    MutationObserver: browser.MutationObserver,
    ResizeObserver: browser.ResizeObserver,
    queueMicrotask,
    window: {
      addEventListener: browser.addEventListener.bind(browser),
      removeEventListener: browser.removeEventListener.bind(browser),
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((name) => {
            if (name === 'react')
              return {
                createElement: (_component, props) => props,
                useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
              }
            if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MenuItemButton: () => {} }
            throw new Error(`Unexpected import: ${name}`)
          })
        },
      },
    },
  })
  plugin.apply({
    sessions: { list: sessions },
    workspaces: { list: workspaces },
    uiSession: { sessionStatus: statuses },
    slots: {
      inject(_key, fn) {
        dispose = fn()
      },
      entries: () => [{ options: { priority: 0 }, store: { create: () => view } }],
      register(_options, component) {
        menu = component
        return () => {}
      },
    },
  })
  return {
    browser,
    sessions,
    statuses,
    workspaces,
    view,
    original,
    dispose: () => dispose(),
    order: () => Array.from(view.getSnapshot().sessionOrderByAccount[flatKey]),
    menu: (id) => menu({ sessionId: id, useMenuOpenState: () => [true, () => {}] }),
  }
}

void test('native list follows activity, explicit settlement and resumed work without archiving', async (t) => {
  const app = setup('{"settled":100}')
  t.after(app.dispose)
  assert.deepEqual(app.order(), ['pinned', 'approval', 'idle', 'running', 'settled'])
  assert.equal(app.menu('running').disabled, true)
  assert.equal(app.menu('approval').disabled, true)
  assert.equal(app.menu('pinned').children, 'Unpin to settle')
  assert.equal(app.menu('pinned').disabled, true)

  app.menu('idle').onSelect()
  assert.equal(app.menu('idle').children, 'Unsettle')
  assert.deepEqual(app.order(), ['pinned', 'approval', 'running', 'settled', 'idle'])
  assert.deepEqual(app.workspaces.getSnapshot().archivedSessionIds, [])

  // Running resumes before the durable updatedAt changes. Settlement must clear now.
  app.statuses.set(new Map([['idle', { running: true }]]))
  assert.equal(app.menu('idle').children, 'Settle')
  assert.equal(app.menu('idle').disabled, true)
  app.statuses.set(new Map([['idle', { running: false, completionUnread: true }]]))
  assert.deepEqual(app.order(), ['pinned', 'idle', 'running', 'approval', 'settled'])
  // Reading the completion does not settle it.
  app.statuses.set(new Map([['idle', { running: false, completionUnread: false }]]))
  assert.equal(app.menu('idle').children, 'Settle')
  const staleMenu = app.menu('idle')
  app.statuses.set(new Map([['idle', { running: true }]]))
  staleMenu.onSelect()
  assert.equal(app.menu('idle').children, 'Settle')

  // A request needs attention even if the model is still marked running.
  app.statuses.set(new Map([['settled', { running: true, pendingInteraction: { kind: 'question' } }]]))
  assert.equal(app.order()[1], 'settled')
  assert.equal(app.menu('settled').disabled, true)
})

void test('settlement survives reload, but newer activity and live subagents return sessions', (t) => {
  const app = setup('{"settled":100,"idle":19}')
  t.after(app.dispose)
  assert.equal(app.menu('settled').children, 'Unsettle')
  assert.equal(app.menu('idle').children, 'Settle')
  app.menu('settled').onSelect()
  assert.equal(app.menu('settled').children, 'Settle')
  assert.equal(app.order()[1], 'settled')
  app.menu('settled').onSelect()
  const before = app.sessions.getSnapshot()
  app.sessions.set({
    ...before,
    projectionsBySession: { settled: { values: { subagentCatalog: [{ id: 'child' }] } } },
  })
  app.statuses.set(new Map([['child', { running: true }]]))
  assert.equal(app.menu('settled').disabled, true)
  assert.equal(app.menu('settled').children, 'Settle')
  assert.ok(!app.order().includes('child'))
  app.statuses.set(new Map([['child', { running: false }]]))
  assert.equal(app.order()[1], 'settled')
})

void test('native filter remains live; unload restores ordering and removes labels and subscriptions', async () => {
  const app = setup('{"settled":100,"idle":20}')
  const list = app.sessions.getSnapshot()
  app.sessions.set({
    ...list,
    byId: {
      ...list.byId,
      'unused-blank': { ...list.byId['unused-blank'], retainedBy: { mainView: 1 } },
    },
  })
  assert.equal(app.order()[0], 'unused-blank')
  const document = app.browser.document
  const tree = document.createElement('div')
  tree.setAttribute('role', 'tree')
  for (const id of app.order()) {
    const wrapper = document.createElement('span')
    const row = document.createElement('div')
    row.dataset.rowKey = `session:${id}`
    row.setAttribute('role', 'treeitem')
    wrapper.append(row)
    tree.append(wrapper)
  }
  document.body.append(tree)
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(
    [...tree.querySelectorAll('[role=heading]')].map((node) => node.textContent),
    ['Working', 'Settled']
  )
  const row = tree.querySelector('[data-row-key="session:idle"]')
  const firstSettled = tree.querySelector('[data-row-key="session:settled"]')
  const working = tree.querySelector('[data-row-key="session:running"]')
  const toggle = tree.querySelector('button')
  assert.equal(toggle.textContent, 'Settled')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(app.browser.getComputedStyle(firstSettled).display, 'none')
  assert.equal(app.browser.getComputedStyle(row.parentElement).display, 'none')
  assert.notEqual(app.browser.getComputedStyle(working).display, 'none')
  toggle.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.notEqual(app.browser.getComputedStyle(firstSettled).display, 'none')
  assert.notEqual(app.browser.getComputedStyle(row.parentElement).display, 'none')
  toggle.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  // Resumed work must become visible even when its former Settled group was closed.
  app.statuses.set(new Map([['settled', { running: true }]]))
  await app.browser.happyDOM.waitUntilComplete()
  assert.notEqual(app.browser.getComputedStyle(firstSettled).display, 'none')
  assert.notEqual(app.browser.getComputedStyle(firstSettled.parentElement).display, 'none')
  assert.equal(tree.querySelector('button').getAttribute('aria-expanded'), 'false')
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'show' })
  assert.equal(app.view.getSnapshot().archivedFilter, 'show')
  app.browser.dispatchEvent(new app.browser.Event('pagehide'))
  assert.equal(app.view.getSnapshot().groupBy, 'workspace')
  app.browser.dispatchEvent(new app.browser.Event('pageshow'))
  assert.equal(app.view.getSnapshot().groupBy, 'flat')
  app.dispose()
  assert.equal(tree.querySelector('[data-row-key="session:idle"]'), row)
  assert.equal(document.querySelectorAll('[data-dsh-inbox-heading]').length, 0)
  assert.notEqual(app.browser.getComputedStyle(firstSettled).display, 'none')
  assert.notEqual(app.browser.getComputedStyle(row.parentElement).display, 'none')
  assert.deepEqual({ ...app.view.getSnapshot() }, { ...app.original, archivedFilter: 'show' })
  app.statuses.set(new Map([['idle', { running: true }]]))
  assert.deepEqual({ ...app.view.getSnapshot() }, { ...app.original, archivedFilter: 'show' })
})
