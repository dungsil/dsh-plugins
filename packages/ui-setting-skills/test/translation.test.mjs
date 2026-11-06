import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

async function mount(t, available = true) {
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
    disposers.reverse().forEach((dispose) => dispose?.())
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
              Button: ({ icon, children, variant: _variant, size: _size, ...props }) =>
                React.createElement('button', props, icon, children),
              Tooltip: ({ children }) => children,
              SegmentedControl: () => null,
              Switch: () => null,
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
  const requests = []
  let snapshot = { active: 'ko' }
  const listeners = new Set()
  const skills = ['alpha', 'beta', 'empty'].map((name, index) => ({
    name,
    path: `/${name}/SKILL.md`,
    description: index === 2 ? '' : `Original ${name}`,
    source: index === 1 ? 'user-dsh' : 'user-agents',
  }))
  const connection = {
    rpc: {
      call: async (_channel, method, payload, signal) => {
        if (method.endsWith('/list'))
          return {
            ok: true,
            value: {
              complete: true,
              disabled: [],
              folderOpenAvailable: false,
              translationAvailable: available,
              skills,
            },
          }
        assert.equal(method, 'dungsil-ui-setting-skills/translate')
        return new Promise((resolve) => requests.push({ ...payload, signal, resolve }))
      },
    },
  }
  const ctx = {
    effect: (setup) => disposers.push(setup()),
    locale: {
      subscribe: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      getSnapshot: () => snapshot,
    },
    get: () => connection,
    slots: {
      inject: (_name, setup) => setup(),
      register: (_options, Component) => root.render(React.createElement(Component, { ctx })),
    },
  }
  await React.act(async () => plugin.apply(ctx))
  const doc = window.document
  return {
    doc,
    requests,
    button: (text) => [...doc.querySelectorAll('button')].find((button) => button.textContent === text),
    async toggle(index, open) {
      await React.act(async () => {
        const details = doc.querySelectorAll('details')[index]
        details.open = open
        details.dispatchEvent(new window.Event('toggle'))
        await window.happyDOM.whenAsyncComplete()
      })
    },
    async language(active) {
      await React.act(async () => {
        snapshot = { active }
        listeners.forEach((listener) => listener())
      })
    },
  }
}

await test('개별 번역은 접힌 미리보기에 유지되고 원문 보기는 상세 설명만 변경한다', async (t) => {
  const ui = await mount(t)
  await ui.toggle(0, true)
  assert.equal(ui.requests.length, 1)
  await React.act(async () => ui.requests[0].resolve({ ok: true, value: '알파 번역' }))
  const row = ui.doc.querySelector('li')
  assert.equal(row.querySelector('.dsh-skills-preview').textContent, '알파 번역')
  await React.act(async () => ui.button('원문 보기').click())
  assert.equal(row.querySelector('.dsh-skills-detail p').textContent, 'Original alpha')
  assert.equal(row.querySelector('.dsh-skills-preview').textContent, '알파 번역')
  await ui.toggle(0, false)
  await ui.toggle(0, true)
  assert.equal(ui.requests.length, 1)
  assert.equal(row.querySelector('.dsh-skills-preview').textContent, '알파 번역')
})

await test('전체 번역은 숨겨진 탭도 순차 처리하고 실패 후 재시도는 성공한 항목을 제외한다', async (t) => {
  const ui = await mount(t)
  await React.act(async () => {
    ui.button('전체 스킬 번역').click()
    ui.button('전체 스킬 번역').click()
  })
  assert.equal(ui.requests.length, 1)
  assert.equal(ui.button('전체 스킬 번역 중…').disabled, true)
  await React.act(async () => ui.requests[0].resolve({ ok: true, value: '알파 번역' }))
  assert.equal(ui.requests.length, 2)
  assert.equal(ui.requests[1].path, '/beta/SKILL.md')
  await React.act(async () => ui.requests[1].resolve({ ok: false }))
  assert.equal(ui.doc.querySelectorAll('details[open]').length, 0)
  assert.deepEqual(
    [...ui.doc.querySelectorAll('.dsh-skills-preview')].map((node) => node.textContent),
    ['알파 번역', '', 'Original beta']
  )
  assert.ok(ui.doc.querySelector('.dsh-skills-translation-toolbar [role="alert"]'))
  await React.act(async () => ui.button('전체 스킬 번역').click())
  assert.equal(ui.requests.length, 3)
  assert.equal(ui.requests[2].path, '/beta/SKILL.md')
  await React.act(async () => ui.requests[2].resolve({ ok: true, value: '베타 번역' }))
  assert.equal(ui.doc.querySelector('.dsh-skills-translation-toolbar [role="alert"]'), null)
  assert.equal(ui.button('전체 스킬 번역').disabled, false)
})

await test('전체 번역은 펼치기로 진행 중인 요청을 재사용하고 언어 변경 시 이전 결과를 표시하지 않는다', async (t) => {
  const ui = await mount(t)
  await ui.toggle(0, true)
  await React.act(async () => ui.button('전체 스킬 번역').click())
  assert.equal(ui.requests.length, 1)
  await ui.language('en')
  assert.equal(ui.requests[0].signal.aborted, true)
  assert.equal(ui.requests.length, 2)
  assert.equal(ui.requests[1].language, 'en')
  assert.ok(ui.button('Translate all skills'))
  await React.act(async () => ui.requests[0].resolve({ ok: true, value: '오래된 번역' }))
  assert.equal(ui.doc.querySelector('.dsh-skills-preview').textContent, 'Original alpha')
  await React.act(async () => ui.requests[1].resolve({ ok: true, value: 'English alpha' }))
  assert.equal(ui.doc.querySelector('.dsh-skills-preview').textContent, 'English alpha')
  await ui.language('zh')
  assert.ok(ui.button('翻译全部技能'))
  await React.act(async () => ui.requests[2].resolve({ ok: true, value: '中文描述' }))
  assert.equal(ui.doc.querySelector('.dsh-skills-preview').textContent, '中文描述')
})

await test('번역 서비스가 없으면 전체 번역 버튼과 자동 번역 요청을 제공하지 않는다', async (t) => {
  const ui = await mount(t, false)
  assert.equal(ui.button('전체 스킬 번역'), undefined)
  await ui.toggle(0, true)
  assert.equal(ui.requests.length, 0)
})
