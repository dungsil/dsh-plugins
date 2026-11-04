import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const React = require('react')
const base = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('package.json', base), 'utf8'))
const code = await readFile(new URL('dist/client.js', base), 'utf8')

function loadClient() {
  let definition
  vm.runInNewContext(code, {
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value
        },
      },
    },
  })
  assert.equal(definition.id, manifest.name)
  const imports = []
  const plugin = definition.factory((id) => {
    imports.push(id)
    assert.equal(id, 'react')
    return React
  })
  return { plugin, imports }
}

function registration() {
  const { plugin } = loadClient()
  let owner
  let mount
  let entry
  const dispose = () => {
    entry = undefined
  }
  plugin.apply({
    slots: {
      inject(key, callback) {
        owner = key
        mount = callback
      },
      register(options, component) {
        entry = { options, component }
        return dispose
      },
    },
  })
  assert.equal(owner, 'shell.overlay')
  assert.equal(entry, undefined)
  const unmount = mount()
  return { getEntry: () => entry, mount, unmount, dispose }
}

test('the client loads only the shared React module without DOM access', () => {
  const { plugin, imports } = loadClient()
  assert.deepEqual(imports, ['react'])
  assert.deepEqual(Array.from(plugin.inject), ['slots'])
  assert.equal(plugin.name, 'dungsil-turn-rail-left')
})

test('the additive style entry follows the owning Slot lifetime', () => {
  const state = registration()
  assert.equal(state.getEntry().options.name, 'shell.overlay')
  assert.equal(state.getEntry().options.id, 'dungsil-turn-rail-left')
  assert.equal(state.getEntry().options.priority, undefined)
  assert.equal(state.unmount, state.dispose)
  state.unmount()
  assert.equal(state.getEntry(), undefined)
  const disposeAgain = state.mount()
  assert.ok(state.getEntry())
  disposeAgain()
  assert.equal(state.getEntry(), undefined)
})

test('the entry renders one removable style element with no extra interface', () => {
  const state = registration()
  try {
    const element = state.getEntry().component()
    assert.ok(React.isValidElement(element))
    assert.equal(element.type, 'style')
    assert.equal(element.props['data-dungsil-turn-rail-left'], '')
    assert.equal(typeof element.props.children, 'string')
    assert.doesNotMatch(
      element.props.children,
      /!important|display\s*:|position\s*:|z-index|@media|@container|animation\s*:|color\s*:/u
    )
  } finally {
    state.unmount()
  }
})

test('styles move the native frame, marks and preview without layout replacement', () => {
  const state = registration()
  try {
    const css = state.getEntry().component().props.children
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/gu)]
    assert.equal(rules.length, 3)
    const declarations = (index) =>
      Object.fromEntries(
        rules[index][2]
          .trim()
          .split(';')
          .filter((part) => part.trim())
          .map((part) => part.trim().split(/:\s*/u))
      )
    assert.equal(rules[0][1].trim(), 'nav.SNx2jG_frame')
    assert.deepEqual(declarations(0), { left: '12px', right: 'auto' })
    assert.equal(rules[1][1].trim(), 'nav.SNx2jG_frame .SNx2jG_mark::before')
    assert.deepEqual(declarations(1), { left: '0', right: 'auto', 'transform-origin': '0% 50%' })
    assert.equal(rules[2][1].trim(), 'nav.SNx2jG_frame > .SNx2jG_preview')
    assert.deepEqual(declarations(2), { left: 'calc(100% + 12px)', right: 'auto' })
  } finally {
    state.unmount()
  }
})

test('the package exports localized metadata and its original SVG icon', async () => {
  for (const locale of ['en', 'ko']) {
    const dictionary = JSON.parse(await readFile(new URL(`locale/${locale}.json`, base), 'utf8'))
    assert.ok(dictionary.meta.title)
    assert.ok(dictionary.meta.description)
  }
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.ok(manifest.files.includes('icon.svg'))
  const icon = await readFile(new URL('icon.svg', base), 'utf8')
  assert.match(icon, /<svg[^>]+xmlns="http:\/\/www.w3.org\/2000\/svg"/u)
  assert.ok(Buffer.byteLength(icon) < 256 * 1024)
  assert.doesNotMatch(icon, /<script|<image|href=/u)
  assert.doesNotThrow(() => new vm.Script(code))
})
