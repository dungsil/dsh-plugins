import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
const flatKey = '__flat_session_order__'
const agentActivity = 'agent-activity'
const previousSortKey = 'dungsil.sidebar-inbox.sort.v1'

function observable(initial) {
  let value = initial
  const listeners = new Set()
  return {
    writes: 0,
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    set(next) {
      this.writes += 1
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

function glyph(document, className) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', className)
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M2 8h12')
  svg.append(path)
  return svg
}

/**
 * Native View Options menu as ui-workspace renders it (portaled card, second
 * heading group is Sort by). Tests inject and read this DOM the way the
 * plugin must.
 */
function nativeMenu(browser, { orderBy = 'updated' } = {}) {
  const document = browser.document
  const menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  menu.className = 'test_viewOptionsMenu'
  const viewport = document.createElement('div')
  viewport.setAttribute('role', 'presentation')
  const heading = (text) => {
    const node = document.createElement('div')
    node.setAttribute('role', 'presentation')
    node.className = 'label'
    node.textContent = text
    return node
  }
  const separator = () => {
    const node = document.createElement('div')
    node.setAttribute('role', 'separator')
    node.className = 'separator'
    return node
  }
  const row = (id, text, selected) => {
    const wrapper = document.createElement('div')
    wrapper.className = 'itemWrap'
    wrapper.dataset.menuId = id
    const button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('role', 'menuitem')
    button.className = 'item'
    const icon = document.createElement('span')
    icon.className = 'itemIcon'
    icon.append(glyph(document, 'menu-icon'))
    const label = document.createElement('span')
    label.className = 'itemLabel'
    label.textContent = text
    button.append(icon, label)
    if (selected) button.append(glyph(document, 'check'))
    wrapper.append(button)
    return wrapper
  }
  const rows = [
    row('workspace', 'Workspace'),
    row('workspace-tree', 'Workspace tree'),
    row('flat', 'One list'),
    separator(),
    heading('Order by'),
    row('manual', 'Manual', orderBy === 'manual'),
    row('updated', 'Last updated', orderBy === 'updated'),
    separator(),
    heading('Session filter'),
    row('hide-archived', 'Hide archived', true),
    row('show-archived', 'All conversations'),
    row('only-archived', 'Archived only'),
  ]
  viewport.append(heading('Group by'), ...rows)
  menu.append(viewport)
  document.body.append(menu)
  return {
    menu,
    viewport,
    row: (id) => viewport.querySelector(`[data-menu-id="${id}"]`),
    injected: () => viewport.querySelector('[data-dsh-inbox-sort-item]'),
  }
}

function setup(options = {}) {
  const browser = new Window()
  if (options.previousSort !== null) browser.localStorage.setItem(previousSortKey, options.previousSort ?? 'updated')
  globalThis.window = browser
  globalThis.document = browser.document
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
    state: 'idle',
    items: [
      {
        workspaceId: 'alpha',
        path: '/alpha',
        title: 'alpha',
        sessionIds: ['idle', 'archived', 'approval'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        workspaceId: 'beta',
        path: '/beta',
        title: 'beta',
        sessionIds: ['running', 'pinned'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    pinnedSessionIds: ['pinned'],
    archivedSessionIds: ['archived'],
  })
  const original = {
    groupBy: 'flat',
    orderBy: 'updated',
    sessionOrderByAccount: { old: ['idle'] },
    archivedFilter: 'default',
    ...options.view,
  }
  const view = observable(original)
  view.store = view
  const locale = localeService()
  let dispose
  let plugin
  let resize
  runInNewContext(source, {
    document: browser.document,
    localStorage: browser.localStorage,
    Element: browser.Element,
    MutationObserver: browser.MutationObserver,
    ResizeObserver: class extends browser.ResizeObserver {
      constructor(callback) {
        super(callback)
        resize = callback
      }
    },
    queueMicrotask,
    window: {
      addEventListener: browser.addEventListener.bind(browser),
      removeEventListener: browser.removeEventListener.bind(browser),
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((name) => {
            if (name === 'react') return React
            if (name === 'react-dom/client')
              return {
                createRoot(container) {
                  const root = createRoot(container)
                  return { render: (node) => flushSync(() => root.render(node)), unmount: () => root.unmount() }
                },
              }
            if (name === '@deepseek-ai/dsh-client-ui-primitives') {
              const icon =
                (className) =>
                ({ size }) =>
                  React.createElement('svg', { width: size, height: size, className, 'aria-hidden': true })
              return {
                IconChevronDownOutlineRegular: icon('inbox-chevron-open'),
                IconChevronRightOutlineRegular: icon('inbox-chevron-closed'),
              }
            }
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
  const accounts = () => JSON.parse(JSON.stringify(view.getSnapshot().sessionOrderByAccount))
  const order = () => accounts()[flatKey] ?? []
  const fallbackOrder = () => {
    const filter = view.getSnapshot().archivedFilter ?? 'default'
    const archived = new Set(workspaces.getSnapshot().archivedSessionIds)
    return sessions.getSnapshot().ids.filter((id) => {
      const row = sessions.getSnapshot().byId[id]
      if (row.origin === 'subagent' || (row.blank && (row.retainedBy.mainView ?? 0) === 0)) return false
      return filter === 'show' ? true : filter === 'only' ? archived.has(id) : !archived.has(id)
    })
  }
  const paint = async (ids = order().length > 0 ? order() : fallbackOrder()) => {
    const filter = view.getSnapshot().archivedFilter ?? 'default'
    const archived = new Set(workspaces.getSnapshot().archivedSessionIds)
    const visible = ids.filter((id) =>
      filter === 'show' ? true : filter === 'only' ? archived.has(id) : !archived.has(id)
    )
    while (tree.firstChild) tree.firstChild.remove()
    for (const id of visible) {
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
    resize: () => resize(),
    dispose: () => dispose(),
    accounts,
    order,
    paint,
    row: (id) => tree.querySelector(`[data-row-key="session:${id}"]`),
    headingTexts: () => [...tree.querySelectorAll('[role=heading]')].map((node) => node.textContent),
    toggles: () => [...tree.querySelectorAll('[data-dsh-inbox-heading] button')],
    writes: () => view.writes,
  }
}

async function openMenu(app, options) {
  const menu = nativeMenu(app.browser, options)
  await app.browser.happyDOM.waitUntilComplete()
  return menu
}

void test('new installations default to agent activity once and preserve later choices', async (t) => {
  for (const groupBy of ['flat', 'workspace', 'workspace-tree']) {
    for (const orderBy of ['manual', 'updated']) {
      await t.test(`${groupBy} / ${orderBy}`, async () => {
        const app = setup({ previousSort: null, view: { groupBy, orderBy, archivedFilter: 'show' } })
        assert.equal(app.view.getSnapshot().groupBy, 'flat')
        assert.equal(app.view.getSnapshot().orderBy, agentActivity)
        assert.equal(app.view.getSnapshot().archivedFilter, 'show')
        assert.equal(app.browser.localStorage.getItem(previousSortKey), orderBy)
        assert.deepEqual(app.accounts(), {
          old: ['idle'],
          [flatKey]: ['pinned', 'approval', 'idle', 'running', 'archived'],
        })
        await app.paint()
        assert.deepEqual(app.headingTexts(), ['Working', 'Archived'])
        const menu = await openMenu(app)
        assert.equal(menu.injected().querySelector('button').getAttribute('aria-current'), 'true')
        menu.injected().querySelector('button').click()
        await app.browser.happyDOM.waitUntilComplete()
        assert.equal(app.view.getSnapshot().orderBy, orderBy)
        const saved = { ...app.view.getSnapshot(), groupBy }
        app.dispose()

        const reloaded = setup({ view: saved, previousSort: orderBy })
        assert.deepEqual({ ...reloaded.view.getSnapshot() }, saved, 'reload preserves the user choice')
        assert.equal(reloaded.writes(), 0)
        reloaded.dispose()
      })
    }
  }
})

void test('existing native view choices are never rewritten and no labels appear', async (t) => {
  const app = setup()
  t.after(app.dispose)
  assert.deepEqual({ ...app.view.getSnapshot() }, { ...app.original })
  assert.equal(app.writes(), 0)

  // Activity and archive facts still update internal placements, but the native
  // grouping/sort/filter choices stay untouched while the mode is off.
  app.statuses.set(new Map([['idle', { running: true }]]))
  app.workspaces.set({ ...app.workspaces.getSnapshot(), archivedSessionIds: [] })
  assert.deepEqual({ ...app.view.getSnapshot() }, { ...app.original })

  // A flat list full of Working/Archived rows receives no headings before opt-in.
  await app.paint(['pinned', 'approval', 'idle', 'running', 'archived'])
  assert.equal(app.tree.querySelectorAll('[role=heading]').length, 0)
  assert.equal(app.tree.querySelectorAll('[data-dsh-inbox-footer]').length, 0)

  const menu = await openMenu(app)
  const injected = menu.injected()
  assert.ok(injected, 'the Sort by row is injected while the menu is open')
  assert.equal(menu.row('updated').nextElementSibling, injected, 'the row follows the native sort group')
  assert.equal(injected.querySelector('button').textContent, 'Agent activity')
  assert.equal(injected.querySelector('button').getAttribute('role'), 'menuitem')
  assert.equal(injected.querySelector('button > svg'), null, 'inactive mode shows no check')
  assert.equal(injected.querySelector('button').getAttribute('aria-current'), null)
  assert.equal(app.view.getSnapshot().orderBy, 'updated')
})

void test('activating writes the flat status order', async (t) => {
  const app = setup()
  t.after(app.dispose)
  const menu = await openMenu(app)
  menu.injected().querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()

  const view = app.view.getSnapshot()
  assert.equal(view.orderBy, agentActivity)
  assert.equal(view.groupBy, 'flat', 'native Group by is respected')
  assert.equal(view.archivedFilter, 'default', 'native session filter is respected')
  assert.deepEqual(app.accounts(), {
    old: ['idle'],
    [flatKey]: ['pinned', 'approval', 'idle', 'running', 'archived'],
  })
  assert.equal(menu.injected().querySelector('button > svg') !== null, true, 'active mode shows the check')
  assert.equal(menu.injected().querySelector('button').getAttribute('aria-current'), 'true')
})

void test('archived sessions trail the list even when pinned or running', async (t) => {
  const app = setup()
  t.after(app.dispose)
  const menu = await openMenu(app)
  menu.injected().querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.order(), ['pinned', 'approval', 'idle', 'running', 'archived'])

  // A pinned or running session joins the bottom group as soon as DSH archives it.
  app.workspaces.set({
    ...app.workspaces.getSnapshot(),
    pinnedSessionIds: ['pinned', 'archived'],
    archivedSessionIds: ['archived', 'running'],
  })
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.order(), ['pinned', 'approval', 'idle', 'archived', 'running'])

  // Newer activity and live subagents never pull a row out of Archived.
  const list = app.sessions.getSnapshot()
  app.sessions.set({ ...list, byId: { ...list.byId, archived: { ...list.byId.archived, updatedAt: 999 } } })
  app.sessions.set({
    ...app.sessions.getSnapshot(),
    projectionsBySession: { archived: { values: { subagentCatalog: [{ id: 'child' }] } } },
  })
  app.statuses.set(new Map([...app.statuses.getSnapshot(), ['child', { running: true }]]))
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.order(), ['pinned', 'approval', 'idle', 'archived', 'running'])
})

void test('the all-conversations view folds archived rows into a collapsed bottom label', async (t) => {
  const app = setup({ view: { archivedFilter: 'show' } })
  t.after(app.dispose)
  const menu = await openMenu(app)
  menu.injected().querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  await app.paint()
  assert.deepEqual(app.headingTexts(), ['Working', 'Archived'])
  const [workingToggle, archivedToggle] = app.toggles()
  assert.equal(workingToggle.textContent, 'Working')
  assert.equal(workingToggle.getAttribute('aria-expanded'), 'true')
  assert.equal(archivedToggle.textContent, 'Archived')
  assert.equal(archivedToggle.getAttribute('aria-expanded'), 'false')
  const visibleIcons = (button) =>
    [...button.querySelectorAll('svg')].filter((icon) => app.browser.getComputedStyle(icon).display !== 'none')
  assert.equal(visibleIcons(workingToggle).length, 1)
  assert.equal(visibleIcons(workingToggle)[0].classList.contains('inbox-chevron-open'), true)
  assert.equal(visibleIcons(archivedToggle).length, 1)
  assert.equal(visibleIcons(archivedToggle)[0].classList.contains('inbox-chevron-closed'), true)
  assert.equal(visibleIcons(archivedToggle)[0].getAttribute('aria-hidden'), 'true')
  assert.equal(app.browser.getComputedStyle(app.row('archived')).visibility, 'hidden')
  assert.notEqual(app.browser.getComputedStyle(app.row('running')).visibility, 'hidden')

  // Expanding the archived section reveals the archived sessions in place.
  archivedToggle.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(archivedToggle.getAttribute('aria-expanded'), 'true')
  assert.equal(visibleIcons(archivedToggle).length, 1)
  assert.equal(visibleIcons(archivedToggle)[0].classList.contains('inbox-chevron-open'), true)
  assert.notEqual(app.browser.getComputedStyle(app.row('archived')).visibility, 'hidden')

  // A live language switch relabels mounted headings.
  app.locale.setActive('ko')
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.headingTexts(), ['작업 중', '보관됨'])
  assert.equal(visibleIcons(archivedToggle).length, 1, 'relabeling preserves the icon')
  app.locale.setActive('en')
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.headingTexts(), ['Working', 'Archived'])

  // The archived-only view is the whole list; folding it would hide everything.
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'only' })
  await app.paint()
  assert.deepEqual(app.headingTexts(), [])
  assert.equal(app.tree.querySelectorAll('[data-dsh-inbox-footer]').length, 0)
  assert.notEqual(app.browser.getComputedStyle(app.row('archived')).visibility, 'hidden')

  // The default filter hides archived rows in the host, so no label is added.
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'default' })
  await app.paint()
  assert.equal(app.row('archived'), null)
  assert.deepEqual(app.headingTexts(), ['Working'])

  // Unarchiving in the native menu returns the row to the ordinary list at once.
  app.workspaces.set({ ...app.workspaces.getSnapshot(), archivedSessionIds: [] })
  app.view.set({ ...app.view.getSnapshot(), archivedFilter: 'show' })
  await app.paint()
  assert.equal(app.row('archived').parentElement.dataset.dshInboxFooter, undefined)
  assert.deepEqual(app.headingTexts(), ['Working'])
  // Native view options were only read, never rewritten by the plugin.
  assert.equal(app.view.getSnapshot().orderBy, agentActivity)
  assert.equal(app.view.getSnapshot().archivedFilter, 'show')
})

void test('oversized footer sections scroll normally and dock again when they fit', async (t) => {
  const app = setup({ view: { orderBy: agentActivity, archivedFilter: 'show' } })
  t.after(app.dispose)
  await app.paint()
  let viewport = 106
  Object.defineProperty(app.tree, 'clientHeight', { get: () => viewport })
  // happy-dom has no layout: supply native 32px rows and 36px headings.
  const footers = [app.row('running').parentElement, app.row('archived').parentElement]
  for (const wrapper of footers) {
    Object.defineProperty(wrapper, 'offsetHeight', {
      get: () => 36 + (app.browser.getComputedStyle(wrapper.lastElementChild).visibility === 'hidden' ? 0 : 32),
    })
  }
  const positions = () => footers.map((wrapper) => app.browser.getComputedStyle(wrapper).position)
  app.resize()
  assert.deepEqual(positions(), ['sticky', 'sticky'], 'an exact fit still docks')
  viewport -= 1
  app.resize()
  assert.deepEqual(positions(), ['static', 'static'], 'even one overflowing pixel must remain scrollable')

  viewport = 138
  app.toggles()[1].click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(positions(), ['sticky', 'sticky'], 'both expanded sections fit exactly')
  viewport -= 1
  app.resize()
  assert.deepEqual(positions(), ['static', 'static'], 'the combined footer height determines overflow')
  app.toggles()[0].click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(positions(), ['sticky', 'sticky'], 'folding restores docking without resizing the sidebar')

  viewport = 60
  app.resize()
  assert.deepEqual(positions(), ['static', 'static'])
  app.view.set({ ...app.view.getSnapshot(), orderBy: 'updated' })
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.tree.hasAttribute('data-dsh-inbox-overflow'), false, 'opting out restores the native tree')
})

void test('flat list labels Working and Archived only while the mode owns the order', async (t) => {
  const app = setup({ view: { archivedFilter: 'show' } })
  t.after(app.dispose)
  const menu = await openMenu(app)
  menu.injected().querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  await app.paint()
  assert.deepEqual(app.headingTexts(), ['Working', 'Archived'])

  // Choosing a native sort releases the mode: labels go away and later activity
  // never moves the list again.
  app.view.set({ ...app.view.getSnapshot(), orderBy: 'updated' })
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.tree.querySelectorAll('[role=heading]').length, 0)
  assert.equal(app.tree.querySelectorAll('[data-dsh-inbox-footer]').length, 0)
  const before = app.accounts()
  app.statuses.set(new Map([['approval', {}]]))
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.accounts(), before)
})

void test('the injected row opts out to the previous native sort', async (t) => {
  const app = setup()
  t.after(app.dispose)
  const menu = await openMenu(app)
  const button = menu.injected().querySelector('button')
  button.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, agentActivity)
  assert.equal(app.browser.localStorage.getItem(previousSortKey), 'updated')
  const activatedWrites = app.writes()
  button.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, 'updated')
  assert.equal(menu.injected().querySelector('button > svg'), null)
  app.statuses.set(new Map([['idle', { running: true }]]))
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.writes(), activatedWrites + 1, 'released mode writes no further orders')
})

void test('the injected row closes the native menu and stays in its keyboard walk', async (t) => {
  const app = setup()
  t.after(app.dispose)
  const menu = await openMenu(app)
  const button = menu.injected().querySelector('button')
  assert.deepEqual(
    [...menu.viewport.querySelectorAll('button:not(:disabled)')].indexOf(button),
    [...menu.viewport.querySelectorAll('button:not(:disabled)')].indexOf(menu.row('updated').querySelector('button')) +
      1
  )
  let escapes = 0
  const onKeyDown = (event) => {
    if (event.key !== 'Escape') return
    escapes += 1
    menu.menu.remove()
  }
  app.browser.document.addEventListener('keydown', onKeyDown, true)
  t.after(() => app.browser.document.removeEventListener('keydown', onKeyDown, true))
  button.focus()
  assert.equal(app.browser.document.activeElement, button, 'the injected row is focusable')
  button.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(escapes, 1, 'activation closes the native menu through its Escape path')
  assert.equal(menu.menu.isConnected, false)
  assert.equal(app.view.getSnapshot().orderBy, agentActivity)
})

void test('leaving the plugin restores the native sort and removes every injected node', async () => {
  const app = setup({ view: { archivedFilter: 'show' } })
  const menu = await openMenu(app)
  menu.injected().querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  await app.paint()
  assert.equal(app.view.getSnapshot().orderBy, agentActivity)
  assert.deepEqual(app.headingTexts(), ['Working', 'Archived'])
  app.dispose()
  assert.equal(app.view.getSnapshot().orderBy, 'updated')
  assert.equal(menu.injected(), null)
  assert.equal(app.tree.querySelectorAll('[role=heading]').length, 0)
  const writes = app.writes()
  app.statuses.set(new Map([['idle', { running: true }]]))
  assert.equal(app.writes(), writes)
})

void test('Korean copy ships with the plugin and the sort row follows the active language', async (t) => {
  const app = setup()
  t.after(app.dispose)
  const en = app.locale.dicts.get('dungsil-sidebar-inbox:en')
  const ko = app.locale.dicts.get('dungsil-sidebar-inbox:ko')
  assert.deepEqual(Object.keys(en).sort(), ['heading.archived', 'heading.working', 'sort.agentActivity'])
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort())
  assert.equal(en['heading.archived'], 'Archived')
  assert.equal(ko['heading.archived'], '보관됨')
  assert.equal(en['sort.agentActivity'], 'Agent activity')
  assert.equal(ko['sort.agentActivity'], '에이전트 활동')
  const menu = await openMenu(app)
  assert.equal(menu.injected().querySelector('button').textContent, 'Agent activity')
  app.locale.setActive('ko')
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(menu.injected().querySelector('button').textContent, '에이전트 활동')
})

void test('repeated status updates settle to a fixed point without rewriting the view', async (t) => {
  const app = setup()
  t.after(app.dispose)
  const menu = await openMenu(app)
  menu.injected().querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  const writes = app.writes()
  const accounts = app.accounts()
  await app.browser.happyDOM.waitUntilComplete()
  app.statuses.set(new Map([...app.statuses.getSnapshot(), ['archived', { running: false, completionUnread: false }]]))
  await app.browser.happyDOM.waitUntilComplete()
  app.sessions.set({ ...app.sessions.getSnapshot() })
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.accounts(), accounts)
  // An unchanged placement set must not keep writing orders.
  assert.equal(app.writes(), writes, `unexpected writes: ${app.writes() - writes}`)
})

void test('the selected blank New Session leads the flat account', async (t) => {
  const app = setup()
  t.after(app.dispose)
  const list = app.sessions.getSnapshot()
  app.sessions.set({
    ...list,
    byId: {
      ...list.byId,
      'unused-blank': { ...list.byId['unused-blank'], retainedBy: { mainView: 1 }, updatedAt: 1 },
    },
  })
  await app.browser.happyDOM.waitUntilComplete()
  const menu = await openMenu(app)
  menu.injected().querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.accounts()[flatKey][0], 'unused-blank')
})

void test('opting out from a manual start returns to manual and records that mode', async (t) => {
  const app = setup({ view: { orderBy: 'manual' } })
  t.after(app.dispose)
  const menu = await openMenu(app, { orderBy: 'manual' })
  const injected = menu.injected()
  const button = injected.querySelector('button')
  assert.equal(injected.querySelector('button > svg'), null, 'inactive mode starts unchecked')
  button.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, agentActivity)
  assert.equal(app.browser.localStorage.getItem(previousSortKey), 'manual')
  assert.equal(injected.querySelector('button').getAttribute('aria-current'), 'true')
  button.click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, 'manual')
  assert.equal(injected.querySelector('button').getAttribute('aria-current'), null)
})

void test('the sort row is disabled unless Group by is One list', async (t) => {
  const app = setup({ view: { groupBy: 'workspace' } })
  t.after(app.dispose)
  const menu = await openMenu(app)
  const injected = menu.injected()
  assert.equal(injected.querySelector('button').disabled, true, 'grouped views cannot pick the sort')
  injected.querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, 'updated')
  assert.equal(injected.querySelector('button').getAttribute('aria-current'), null)

  app.view.set({ ...app.view.getSnapshot(), groupBy: 'flat' })
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(injected.querySelector('button').disabled, false, 'the single list enables the sort row')
  injected.querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, agentActivity)
  assert.deepEqual(app.accounts()[flatKey], ['pinned', 'approval', 'idle', 'running', 'archived'])
})

void test('switching Group by away from the single list releases the mode', async (t) => {
  const app = setup()
  t.after(app.dispose)
  const menu = await openMenu(app)
  menu.injected().querySelector('button').click()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, agentActivity)

  app.view.set({ ...app.view.getSnapshot(), groupBy: 'workspace' })
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, 'updated', 'the state order belongs to the flat list')
  assert.equal(app.view.getSnapshot().groupBy, 'workspace')
  assert.equal(menu.injected().querySelector('button').disabled, true)
  const accounts = app.accounts()
  app.statuses.set(new Map([['idle', { running: true }]]))
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.accounts(), accounts, 'released mode stops writing orders')

  app.view.set({ ...app.view.getSnapshot(), groupBy: 'workspace-tree' })
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(app.view.getSnapshot().orderBy, 'updated')

  // Back on the single list the row is available again; the mode stays off
  // until the user selects it.
  app.view.set({ ...app.view.getSnapshot(), groupBy: 'flat' })
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(menu.injected().querySelector('button').disabled, false)
  assert.equal(menu.injected().querySelector('button').getAttribute('aria-current'), null)
})

void test('a persisted mode that starts grouped is released on load', async (t) => {
  const app = setup({ previousSort: null, view: { orderBy: agentActivity, groupBy: 'workspace' } })
  t.after(app.dispose)
  assert.equal(app.view.getSnapshot().orderBy, 'manual', 'the previous sort is restored from the fallback')
  assert.equal(app.view.getSnapshot().groupBy, 'workspace')
  const menu = await openMenu(app)
  assert.equal(menu.injected().querySelector('button').disabled, true)
  assert.equal(menu.injected().querySelector('button').getAttribute('aria-current'), null)
  assert.deepEqual(app.accounts(), app.original.sessionOrderByAccount)
})

void test('a persisted mode resumes on load and reopens the menu without duplicates', async (t) => {
  const app = setup({ view: { orderBy: agentActivity } })
  t.after(app.dispose)
  assert.equal(app.view.getSnapshot().orderBy, agentActivity)
  assert.deepEqual(app.accounts()[flatKey], ['pinned', 'approval', 'idle', 'running', 'archived'])

  const first = await openMenu(app)
  assert.ok(first.injected())
  assert.equal(first.injected().querySelector('button').getAttribute('aria-current'), 'true')
  first.menu.remove()
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(first.injected(), null, 'closing the native menu removes the injected row')

  const second = await openMenu(app)
  assert.equal(second.viewport.querySelectorAll('[data-dsh-inbox-sort-item]').length, 1)
  assert.equal(second.injected().querySelector('button').textContent, 'Agent activity')
  app.view.set({ ...app.view.getSnapshot(), orderBy: 'manual' })
  await app.browser.happyDOM.waitUntilComplete()
  assert.equal(second.injected().querySelector('button').getAttribute('aria-current'), null)
  const accounts = app.accounts()
  app.statuses.set(new Map([['idle', { running: true }]]))
  await app.browser.happyDOM.waitUntilComplete()
  assert.deepEqual(app.accounts(), accounts, 'a released mode stops writing orders')
})
