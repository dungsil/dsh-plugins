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

/** Minimal stand-in for the DSH locale service: dictionaries, lookup chain and live switches. */
function localeService() {
  const dicts = new Map()
  const listeners = new Set()
  let active = 'en'
  const dictOf = (namespace) => dicts.get(`${namespace}:${active}`) ?? {}
  return {
    dicts,
    get active() {
      return active
    },
    getSnapshot: () => ({ active, locales: [], revision: 0 }),
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    register(namespace, locale, dict) {
      dicts.set(`${namespace}:${locale}`, dict)
      return () => dicts.delete(`${namespace}:${locale}`)
    },
    bind: (namespace) => (key) => dictOf(namespace)[key] ?? key,
    setActive(locale) {
      active = locale
      for (const fn of listeners) fn()
    },
  }
}

function setup(archivedFilter = 'default') {
  const browser = new Window()
  const rows = [
    { id: 'idle', updatedAt: 20 },
    { id: 'running', updatedAt: 50, running: true },
    { id: 'archived', updatedAt: 100 },
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
  const workspaces = observable({
    phase: 'ready',
    pinnedSessionIds: ['pinned'],
    archivedSessionIds: ['archived'],
  })
  const original = {
    groupBy: 'workspace',
    orderBy: 'updated',
    sessionOrderByAccount: { old: ['idle'] },
    archivedFilter,
  }
  const view = observable(original)
  view.store = view
  const locale = localeService()
  let dispose
  let plugin
  runInNewContext(source, {
    document: browser.document,
    Element: browser.Element,
    MutationObserver: browser.MutationObserver,
    ResizeObserver: browser.ResizeObserver,
    queueMicrotask,
    window: {
      addEventListener: browser.addEventListener.bind(browser),
      removeEventListener: browser.removeEventListener.bind(browser),
      __ModuleLoader__: {
        load({ factory }) {
          // No runtime imports: the plugin contributes DOM labels, not components.
          plugin = factory((name) => {
            throw new Error(`Unexpected import: ${name}`)
          })
        },
      },
    },
  })
  const tree = browser.document.createElement('div')
  tree.setAttribute('role', 'tree')
  browser.document.body.append(tree)
  plugin.apply({
    effect(fn) {
      const disposer = fn()
      return () => disposer?.()
    },
    locale,
    sessions: { list: sessions },
    workspaces: { list: workspaces },
    uiSession: { sessionStatus: statuses },
    slots: {
      inject(_key, fn) {
        dispose = fn()
      },
      entries: () => [{ options: { priority: 0 }, store: { create: () => view } }],
      register() {
        // DSH's own row menu archives sessions; a second menu item would duplicate it.
        throw new Error('Sidebar Inbox must not contribute a session menu item')
      },
    },
  })
  const order = () => Array.from(view.getSnapshot().sessionOrderByAccount[flatKey] ?? [])
  const row = (id) => tree.querySelector(`[data-row-key="session:${id}"]`)
  const paint = async () => {
    const filter = view.getSnapshot().archivedFilter ?? 'default'
    const archived = new Set(workspaces.getSnapshot().archivedSessionIds)
    const ids = order().filter((id) =>
      filter === 'show' ? true : filter === 'only' ? archived.has(id) : !archived.has(id)
    )
    while (tree.firstChild) tree.firstChild.remove()
    for (const id of ids) {
      const wrapper = browser.document.createElement('span')
      const session = browser.document.createElement('div')
      session.dataset.rowKey = `session:${id}`
      session.setAttribute('role', 'treeitem')
      wrapper.append(session)
      tree.append(wrapper)
    }
    await browser.happyDOM.waitUntilComplete()
  }
  return {
    browser,
    sessions,
    statuses,
    workspaces,
    view,
    original,
    locale,
    tree,
    dispose: () => dispose(),
    order,
    paint,
    row,
    headingTexts: () => [...tree.querySelectorAll('[role=heading]')].map((node) => node.textContent),
    toggles: () => [...tree.querySelectorAll('[data-dsh-inbox-heading] button')],
  }
}

void test('archived sessions trail the list even when pinned or running', (t) => {
  const app = setup()
  t.after(app.dispose)
  assert.deepEqual(app.order(), ['pinned', 'approval', 'idle', 'running', 'archived'])
  assert.ok(!app.order().includes('child'))

  // Archive membership is DSH's own state. A pinned or running session joins the
  // bottom group as soon as the workspace reports it archived.
  app.workspaces.set({
    ...app.workspaces.getSnapshot(),
    pinnedSessionIds: ['pinned', 'archived'],
    archivedSessionIds: ['archived', 'running'],
  })
  assert.deepEqual(app.order(), ['pinned', 'approval', 'idle', 'archived', 'running'])

  // Newer activity does not restore an archived session; only unarchiving does.
  const list = app.sessions.getSnapshot()
  app.sessions.set({
    ...list,
    byId: { ...list.byId, archived: { ...list.byId.archived, updatedAt: 999 } },
  })
  assert.deepEqual(app.order(), ['pinned', 'approval', 'idle', 'archived', 'running'])

  // A running subagent or an unread completion never pulls the row out of Archived.
  app.sessions.set({
    ...app.sessions.getSnapshot(),
    projectionsBySession: { archived: { values: { subagentCatalog: [{ id: 'child' }] } } },
  })
  app.statuses.set(
    new Map([
      ['approval', { running: true, pendingInteraction: { kind: 'approval' } }],
      ['idle', { running: false, completionUnread: false }],
      ['child', { running: true }],
    ])
  )
  assert.deepEqual(app.order(), ['pinned', 'approval', 'idle', 'archived', 'running'])
})

void test('both section titles fold their rows and archived starts folded', async (t) => {
  const app = setup('show')
  t.after(app.dispose)
  await app.paint()
  assert.deepEqual(app.headingTexts(), ['Working', 'Archived'])
  const [workingToggle, archivedToggle] = app.toggles()
  assert.equal(workingToggle.textContent, 'Working')
  assert.equal(workingToggle.getAttribute('aria-expanded'), 'true')
  assert.equal(archivedToggle.textContent, 'Archived')
  assert.equal(archivedToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(app.browser.getComputedStyle(app.row('archived')).visibility, 'hidden')
  assert.notEqual(app.browser.getComputedStyle(app.row('running')).visibility, 'hidden')

  // Working folds on its own title and leaves Archived folded as well.
  workingToggle.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(workingToggle.getAttribute('aria-expanded'), 'false')
  assert.equal(app.browser.getComputedStyle(app.row('running')).visibility, 'hidden')
  assert.equal(archivedToggle.getAttribute('aria-expanded'), 'false')
  workingToggle.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(workingToggle.getAttribute('aria-expanded'), 'true')
  assert.notEqual(app.browser.getComputedStyle(app.row('running')).visibility, 'hidden')

  archivedToggle.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(archivedToggle.getAttribute('aria-expanded'), 'true')
  assert.notEqual(app.browser.getComputedStyle(app.row('archived')).visibility, 'hidden')

  // The dictionaries ship with the plugin; a live language switch relabels mounted headings.
  const keys = ['heading.archived', 'heading.working']
  assert.deepEqual(Object.keys(app.locale.dicts.get('dungsil-sidebar-inbox:en')).sort(), keys)
  assert.deepEqual(Object.keys(app.locale.dicts.get('dungsil-sidebar-inbox:ko')).sort(), keys)
  app.locale.setActive('ko')
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.headingTexts(), ['작업 중', '보관됨'])
  assert.deepEqual(
    app.toggles().map((node) => node.textContent),
    ['작업 중', '보관됨']
  )
  app.locale.setActive('en')
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.headingTexts(), ['Working', 'Archived'])

  // The default filter hides archived rows in the host, so no label is added.
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'default' })
  await app.paint()
  assert.equal(app.row('archived'), null)
  assert.deepEqual(app.headingTexts(), ['Working'])

  // The archived-only view is the whole list; folding it would hide everything.
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'only' })
  await app.paint()
  assert.deepEqual(app.headingTexts(), [])
  assert.notEqual(app.browser.getComputedStyle(app.row('archived')).visibility, 'hidden')

  // Unarchiving in the native menu returns the row to the ordinary list at once.
  app.workspaces.set({ ...app.workspaces.getSnapshot(), archivedSessionIds: [] })
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'show' })
  await app.paint()
  assert.equal(app.row('archived').parentElement.dataset.dshInboxFooter, undefined)
  assert.deepEqual(app.headingTexts(), ['Working'])
})

void test('retained blanks lead, native filter changes stay live and unload restores the view', async () => {
  const app = setup('show')
  const list = app.sessions.getSnapshot()
  app.sessions.set({
    ...list,
    byId: { ...list.byId, 'unused-blank': { ...list.byId['unused-blank'], retainedBy: { mainView: 1 } } },
  })
  assert.equal(app.order()[0], 'unused-blank')
  await app.paint()
  assert.deepEqual(app.headingTexts(), ['Working', 'Archived'])
  const archivedRow = app.row('archived')
  assert.equal(app.browser.getComputedStyle(archivedRow).visibility, 'hidden')

  // The archived filter is native view state; this plugin reads it and never writes it.
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'only' })
  await app.browser.happyDOM.waitUntilComplete()
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'show' })
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().archivedFilter, 'show')

  app.browser.dispatchEvent(new app.browser.Event('pagehide'))
  assert.equal(app.view.getSnapshot().groupBy, 'workspace')
  app.browser.dispatchEvent(new app.browser.Event('pageshow'))
  assert.equal(app.view.getSnapshot().groupBy, 'flat')
  app.dispose()
  assert.equal(app.tree.querySelector('[data-row-key="session:archived"]'), archivedRow)
  assert.equal(app.browser.document.querySelectorAll('[data-dsh-inbox-heading]').length, 0)
  assert.notEqual(app.browser.getComputedStyle(archivedRow).visibility, 'hidden')
  assert.equal(archivedRow.parentElement.dataset.dshInboxClosed, undefined)
  assert.deepEqual({ ...app.view.getSnapshot() }, { ...app.original, archivedFilter: 'show' })
  app.statuses.set(new Map([['idle', { running: true }]]))
  assert.deepEqual({ ...app.view.getSnapshot() }, { ...app.original, archivedFilter: 'show' })
})
