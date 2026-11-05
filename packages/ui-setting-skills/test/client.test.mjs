import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

await test('settings uses the native skill icon across locales, navigation remounts and plugin unload', async (t) => {
  const window = new Window()
  const previous = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const disposers = []
  t.after(async () => {
    await React.act(() =>
      disposers
        .splice(0)
        .reverse()
        .forEach((dispose) => dispose())
    )
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const require = createRequire(import.meta.url)
  let plugin
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    document: window.document,
    MutationObserver: window.MutationObserver,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id !== '@deepseek-ai/dsh-client-ui-primitives') return require(id)
            return {
              IconSkillOutlineRegular: ({ size }) =>
                React.createElement('svg', { 'data-icon': 'skill', width: size, height: size }),
            }
          })
        },
      },
    },
  })
  const settle = () => React.act(() => window.happyDOM.whenAsyncComplete())
  await React.act(() =>
    plugin.apply({
      effect: (setup) => disposers.push(setup()),
      slots: { inject() {} },
    })
  )
  const modal = window.document.createElement('div')
  modal.setAttribute('data-shortcut-modal', 'settings')
  const nav = window.document.createElement('nav')
  modal.append(nav)
  window.document.body.append(modal)
  const makeRow = (label) => {
    const row = window.document.createElement('button')
    row.innerHTML = `<svg aria-hidden="true"></svg><span>${label}</span>`
    return row
  }
  const neighbor = makeRow('General')
  const skills = makeRow('Skills')
  nav.append(neighbor, skills)
  await settle()
  for (const label of ['Skills', '스킬', '技能']) {
    skills.querySelector('span:last-child').textContent = label
    await settle()
    assert.equal(skills.textContent, label)
    assert.equal(skills.querySelectorAll('svg[data-icon="skill"]').length, 1)
    assert.equal(skills.querySelector('svg[data-icon="skill"]').getAttribute('width'), '16')
    assert.equal(skills.querySelector('svg[data-icon="skill"]').parentElement.getAttribute('aria-hidden'), 'true')
    assert.equal(window.getComputedStyle(skills.querySelector(':scope > svg')).display, 'none')
    assert.equal(neighbor.querySelectorAll('svg').length, 1)
    assert.notEqual(window.getComputedStyle(neighbor.querySelector('svg')).display, 'none')
  }
  modal.remove()
  await settle()
  assert.equal(skills.querySelectorAll('svg[data-icon="skill"]').length, 0)
  window.document.body.append(modal)
  await settle()
  assert.equal(skills.querySelectorAll('svg[data-icon="skill"]').length, 1)
  await React.act(() =>
    disposers
      .splice(0)
      .reverse()
      .forEach((dispose) => dispose())
  )
  assert.equal(skills.querySelectorAll('svg[data-icon="skill"]').length, 0)
  assert.notEqual(window.getComputedStyle(skills.querySelector('svg')).display, 'none')
})
