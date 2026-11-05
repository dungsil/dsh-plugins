import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

await test('설정은 로케일, 내비게이션 재마운트, 플러그인 언로드 전반에서 네이티브 스킬 아이콘을 사용한다', async (t) => {
  const window = new Window()
  const previous = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const disposers = []
  t.after(async () => {
    await React.act(async () =>
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
  const makeRow = (label, wrapped = false) => {
    const row = window.document.createElement('button')
    const icon = '<svg aria-hidden="true"></svg>'
    row.innerHTML = `${wrapped ? `<span aria-hidden="true"><span data-slot="settings.section.icon">${icon}</span></span>` : icon}<span>${label}</span>`
    return row
  }
  const neighbor = makeRow('General', true)
  const skills = makeRow('Skills')
  const wrappedSkills = makeRow('Skills', true)
  nav.append(neighbor, skills, wrappedSkills)
  await settle()
  for (const label of ['Skills', '스킬', '技能']) {
    skills.querySelector('span:last-child').textContent = label
    wrappedSkills.querySelector(':scope > span:last-child').textContent = label
    await settle()
    assert.equal(skills.textContent, label)
    assert.equal(skills.querySelectorAll('svg[data-icon="skill"]').length, 1)
    assert.equal(skills.querySelector('svg[data-icon="skill"]').getAttribute('width'), '16')
    assert.equal(skills.querySelector('svg[data-icon="skill"]').parentElement.getAttribute('aria-hidden'), 'true')
    assert.equal(window.getComputedStyle(skills.querySelector(':scope > svg')).display, 'none')
    assert.equal(wrappedSkills.textContent, label)
    assert.equal(wrappedSkills.querySelectorAll('svg[data-icon="skill"]').length, 1)
    assert.equal(
      window.getComputedStyle(wrappedSkills.querySelector('[data-slot="settings.section.icon"]').parentElement).display,
      'none'
    )
    assert.notEqual(
      window.getComputedStyle(wrappedSkills.querySelector('svg[data-icon="skill"]').parentElement).display,
      'none'
    )
    assert.equal(neighbor.querySelectorAll('svg').length, 1)
    assert.notEqual(window.getComputedStyle(neighbor.querySelector('svg')).display, 'none')
    assert.notEqual(window.getComputedStyle(neighbor.firstElementChild).display, 'none')
  }
  modal.remove()
  await settle()
  assert.equal(skills.querySelectorAll('svg[data-icon="skill"]').length, 0)
  assert.equal(wrappedSkills.querySelectorAll('svg[data-icon="skill"]').length, 0)
  window.document.body.append(modal)
  await settle()
  assert.equal(skills.querySelectorAll('svg[data-icon="skill"]').length, 1)
  assert.equal(wrappedSkills.querySelectorAll('svg[data-icon="skill"]').length, 1)
  await React.act(async () =>
    disposers
      .splice(0)
      .reverse()
      .forEach((dispose) => dispose())
  )
  assert.equal(skills.querySelectorAll('svg[data-icon="skill"]').length, 0)
  assert.notEqual(window.getComputedStyle(skills.querySelector('svg')).display, 'none')
  assert.equal(wrappedSkills.querySelectorAll('svg[data-icon="skill"]').length, 0)
  assert.notEqual(window.getComputedStyle(wrappedSkills.firstElementChild).display, 'none')
})

await test('폴더 열기는 클릭한 스킬만 잠그고 다른 스킬의 요청과 오류에 영향을 주지 않는다', async (t) => {
  const window = new Window()
  const previous = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(window.document.body.appendChild(window.document.createElement('div')))
  const disposers = []
  t.after(async () => {
    await React.act(async () => root.unmount())
    disposers.reverse().forEach((dispose) => dispose())
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const require = createRequire(import.meta.url)
  let plugin
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    AbortController,
    document: window.document,
    MutationObserver: window.MutationObserver,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) => {
            if (id !== '@deepseek-ai/dsh-client-ui-primitives') return require(id)
            return {
              Button: ({ icon, variant: _variant, size: _size, ...props }) =>
                React.createElement('button', props, icon),
              Tooltip: ({ children }) => children,
              SegmentedControl: () => null,
              Switch: ({ label, checked, disabled }) =>
                React.createElement('input', {
                  type: 'checkbox',
                  'aria-label': label,
                  checked,
                  disabled,
                  readOnly: true,
                }),
              ...Object.fromEntries(
                ['ChevronRight', 'FolderOpen', 'Loading', 'Skill'].map((name) => [
                  `Icon${name}OutlineRegular`,
                  () => React.createElement('svg'),
                ])
              ),
            }
          })
        },
      },
    },
  })
  const paths = ['/agents/alpha/SKILL.md', '/agents/beta/SKILL.md']
  const requests = []
  const snapshot = { active: 'ko' }
  let connection
  const ctx = {
    effect: (setup) => disposers.push(setup()),
    locale: { subscribe: () => () => {}, getSnapshot: () => snapshot },
    get: () =>
      (connection ??= {
        rpc: {
          call: async (_channel, method, payload) => {
            if (method.endsWith('/list')) {
              return {
                ok: true,
                value: {
                  complete: true,
                  disabled: [],
                  folderOpenAvailable: true,
                  translationAvailable: false,
                  skills: paths.map((path, index) => ({
                    name: index === 0 ? 'alpha' : 'beta',
                    path,
                    description: 'Skill description',
                    source: 'user-agents',
                  })),
                },
              }
            }
            assert.equal(method, 'dungsil-ui-setting-skills/open-folder')
            return new Promise((resolve) => requests.push({ path: payload.path, resolve }))
          },
        },
      }),
    slots: {
      inject: (_name, setup) => setup(),
      register: (_options, Component) => root.render(React.createElement(Component, { ctx })),
    },
  }
  await React.act(() => plugin.apply(ctx))
  const buttons = [...window.document.querySelectorAll('.dsh-skills-folder')]
  const rows = [...window.document.querySelectorAll('li')]
  await React.act(async () => {
    buttons[0].click()
    buttons[0].click()
  })
  assert.deepEqual(
    requests.map(({ path }) => path),
    [paths[0]]
  )
  assert.equal(buttons[0].disabled, true)
  assert.equal(buttons[0].getAttribute('aria-busy'), 'true')
  assert.equal(buttons[1].disabled, false)
  assert.equal(buttons[1].getAttribute('aria-busy'), 'false')
  assert.equal(window.document.querySelectorAll('details[open]').length, 0)
  await React.act(() => buttons[1].click())
  assert.deepEqual(
    requests.map(({ path }) => path),
    paths
  )
  await React.act(() => requests[0].resolve({ ok: false }))
  assert.equal(buttons[0].disabled, false)
  assert.equal(buttons[1].disabled, true)
  assert.ok(rows[0].querySelector('[role="alert"]'))
  assert.equal(rows[1].querySelector('[role="alert"]'), null)
  await React.act(() => requests[1].resolve({ ok: false }))
  assert.ok(rows[0].querySelector('[role="alert"]'))
  assert.ok(rows[1].querySelector('[role="alert"]'))
  await React.act(() => buttons[1].click())
  assert.ok(rows[0].querySelector('[role="alert"]'))
  assert.equal(rows[1].querySelector('[role="alert"]'), null)
  await React.act(() => requests[2].resolve({ ok: true, value: {} }))
  assert.equal(buttons[1].disabled, false)
  assert.equal(buttons[1].getAttribute('aria-busy'), 'false')
})
