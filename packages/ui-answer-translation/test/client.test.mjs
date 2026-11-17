import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { Window } from 'happy-dom'
import * as React from 'react'

const SLOT = 'conversation.chat.node'

// Same structure the native Chat renders: answer Markdown roots and compact reasoning inside one row.
const ANSWER = `<div data-row>
  <div data-text-interaction-source="">
    <h2>Result</h2>
    <p>이 문단은 한국어로 작성되어 있으므로 번역 버튼이 없어야 합니다.</p>
    <p>The build failed because the <code>tsdown</code> step could not resolve <a href="https://example.com/ui">the shared UI package</a>.</p>
    <ul>
      <li>First, open the settings page and confirm the provider.<ul>
        <li>Nested item: the <code>targetLanguage</code> value follows the interface language.</li>
        <li>중첩 항목도 한국어라면 버튼이 없습니다.</li>
      </ul></li>
    </ul>
    <table><tbody><tr><td>Table cell text stays exactly as it is written.</td></tr></tbody></table>
    <pre><code>const untouched = 'code blocks are never translated'</code></pre>
    <p>Ce paragraphe est écrit en français et doit recevoir une action de traduction.</p>
  </div>
  <div data-text-interaction-source="">
    <div data-markdown-variant="compact"><p>This reasoning paragraph must never receive a translation action.</p></div>
  </div>
</div>`

async function setup(t, { remote = true } = {}) {
  const window = new Window()
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = window.document.createElement('div')
  window.document.body.append(container)
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(container)
  const effects = []
  t.after(async () => {
    await React.act(async () => root.unmount())
    for (const dispose of effects.reverse()) dispose()
    await window.happyDOM.close()
    keys.forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index])
      else delete globalThis[key]
    })
  })

  const core = new SlotCore()
  core.register({ name: 'root', children: { [SLOT]: { kind: 'keyed', scope: 'session' } } }, () => null)
  const native = ({ node }) => React.createElement('div', { dangerouslySetInnerHTML: { __html: node.html } })
  core.register({ name: SLOT, key: 'assistant-step' }, native)

  const calls = []
  const cotTranslation = {
    limits: async () => ({
      ok: true,
      value: {
        maxTextChars: 4000,
        preferences: { provider: 'bing', targetLanguage: 'auto' },
        availableProviders: ['bing', 'google'],
      },
    }),
    translate: (request, signal) =>
      new Promise((resolve, reject) => {
        const call = {
          request,
          aborted: false,
          succeed: (value) => resolve({ ok: true, value }),
          fail: () => resolve({ ok: false, error: new Error('provider failed') }),
        }
        signal.addEventListener('abort', () => {
          call.aborted = true
          reject(signal.reason)
        })
        calls.push(call)
      }),
  }
  const locale = { active: 'ko' }
  const ctx = {
    logger: { warn() {} },
    locale: { getSnapshot: () => locale, subscribe: () => () => {} },
    remote: { $on: () => () => {}, ...(remote ? { cotTranslation } : {}) },
    on() {},
    effect(effect) {
      const result = effect()
      for (const dispose of [result].flat()) if (typeof dispose === 'function') effects.push(dispose)
    },
    inject(dependencies, callback) {
      if (dependencies.every((dependency) => dependency !== 'remote.cotTranslation' || remote)) callback(ctx)
    },
    slots: {
      inject: (_slot, setup) => effects.push(setup()),
      entries: (slot) => core.entries(slot),
      subscribe: (slot, fn) => core.subscribe(slot, fn),
      register: (options, component) => core.register(options, component),
    },
  }

  const require = createRequire(import.meta.url)
  const primitives = {
    Button: ({ children, ...props }) => React.createElement('button', { type: 'button', ...props }, children),
    Tooltip: ({ children }) => children,
    IconLoadingOutlineRegular: () => null,
  }
  let plugin
  window.__ModuleLoader__ = {
    load: ({ factory }) => {
      plugin = factory((id) => (id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(id)))
    },
  }
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    MutationObserver: window.MutationObserver,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    requestAnimationFrame: (fn) => setTimeout(() => fn(), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    AbortController,
    AbortSignal,
  })
  plugin.apply(ctx)
  await React.act(async () => {})

  const node = (status = 'settled', html = ANSWER) => ({
    kind: 'assistant-step',
    data: { status, finalNode: status === 'running' ? undefined : { messageId: 'message-1' } },
    html,
  })
  const render = async (props) => {
    const Component = core.entriesOfSlot(SLOT).find((entry) => entry.options.key === 'assistant-step').component
    await React.act(async () => root.render(props ? React.createElement(Component, props) : null))
  }
  const triggers = () => [...container.querySelectorAll('.dsh-answer-translation-trigger')]
  const triggerFor = (prefix) =>
    triggers().find((button) => button.closest('p, li').textContent.trim().startsWith(prefix))
  const click = async (button) => React.act(async () => button.click())
  const settle = async () => React.act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
  return { core, native, container, calls, effects, node, render, triggers, triggerFor, click, settle }
}

await test('혼합 언어 답변에서 대상 언어가 아닌 문단에만 동작을 붙이고 활성화 전에는 아무것도 보내지 않는다', async (t) => {
  const { node, render, triggers, calls, container } = await setup(t)
  await render({ node: node(), sessionId: 'session-1' })
  const owners = triggers().map((button) => button.closest('p, li').textContent.trim().slice(0, 24))
  assert.deepEqual(owners, [
    'The build failed because',
    'First, open the settings',
    'Nested item: the targetL',
    'Ce paragraphe est écrit ',
  ])
  // The parent item's action ends its own text and stays before its sublist.
  const parent = triggers()[1].closest('li')
  assert.equal(triggers()[1].parentElement.nextElementSibling, parent.querySelector('ul'))
  assert.equal(container.querySelector('[data-markdown-variant] [data-answer-translation]'), null)
  assert.equal(calls.length, 0)
})

await test('스트리밍 중인 답변에는 동작을 붙이지 않고 완료되면 붙인다', async (t) => {
  const { node, render, triggers } = await setup(t)
  await render({ node: node('running'), sessionId: 'session-1' })
  assert.equal(triggers().length, 0)
  await render({ node: node(), sessionId: 'session-1' })
  assert.equal(triggers().length, 4)
})

await test('문단 텍스트만 보내고 인라인 코드와 링크를 원본 요소로 복원하며 중복 요청을 보내지 않는다', async (t) => {
  const { node, render, triggerFor, click, calls, settle, container } = await setup(t)
  await render({ node: node(), sessionId: 'session-1' })
  const trigger = triggerFor('The build failed')
  await click(trigger)
  await click(trigger)
  await click(trigger)
  assert.equal(calls.length, 1)
  // The request object comes from the plugin's realm; compare its fields.
  assert.deepEqual(
    { ...calls[0].request },
    {
      text: 'The build failed because the ⟦0⟧ step could not resolve ⟦1⟧.',
      provider: 'bing',
      targetLanguage: 'ko',
      sessionId: 'session-1',
    }
  )
  // Providers may reorder placeholders and drop one; nothing from the original is lost.
  await React.act(async () => calls[0].succeed('빌드는 ⟦1⟧ 때문에 실패했습니다.'))
  await settle()
  const paragraph = trigger.closest('p')
  const panel = paragraph.nextElementSibling.querySelector('.dsh-answer-translation-panel')
  const translated = panel.querySelector('.dsh-answer-translation-text')
  assert.equal(translated.textContent, '빌드는 the shared UI package 때문에 실패했습니다. tsdown')
  assert.equal(translated.querySelector('a').getAttribute('href'), 'https://example.com/ui')
  assert.equal(translated.querySelector('code').textContent, 'tsdown')
  // The original paragraph stays untouched apart from its action.
  assert.equal(paragraph.querySelector('a').textContent, 'the shared UI package')
  assert.equal(trigger.getAttribute('aria-expanded'), 'true')
  await click(trigger)
  assert.equal(container.querySelector('.dsh-answer-translation-panel'), null)
  assert.equal(trigger.getAttribute('aria-label'), '번역 표시')
  assert.equal(calls.length, 1)
})

await test('실패하면 원문을 유지한 채 다시 시도할 수 있다', async (t) => {
  const { node, render, triggerFor, click, calls, settle, container } = await setup(t)
  await render({ node: node(), sessionId: 'session-1' })
  await click(triggerFor('Ce paragraphe'))
  await React.act(async () => calls[0].fail())
  await settle()
  const alert = container.querySelector('[role="alert"]')
  assert.match(alert.textContent, /번역하지 못했습니다/)
  await click(alert.querySelector('button'))
  assert.equal(calls.length, 2)
  await React.act(async () => calls[1].succeed('이 문단은 프랑스어로 작성되었습니다.'))
  await settle()
  assert.equal(
    container.querySelector('.dsh-answer-translation-text').textContent,
    '이 문단은 프랑스어로 작성되었습니다.'
  )
})

await test('행이 사라지면 대기 요청을 취소하고 다시 나타나면 열어 둔 번역을 다시 요청 없이 복원한다', async (t) => {
  const { node, render, triggerFor, click, calls, settle, container } = await setup(t)
  const props = { node: node(), sessionId: 'session-1' }
  await render(props)
  await click(triggerFor('Nested item'))
  await render(null)
  assert.equal(calls[0].aborted, true)
  // The reader asked for this translation, so the remounted row resumes it once.
  await render(props)
  await settle()
  assert.equal(calls.length, 2)
  await React.act(async () => calls[1].succeed('중첩 항목: ⟦0⟧ 값은 인터페이스 언어를 따릅니다.'))
  await settle()
  await render(null)
  assert.equal(container.querySelector('[data-answer-translation]'), null)
  await render(props)
  await settle()
  assert.equal(calls.length, 2)
  const item = triggerFor('Nested item').closest('li')
  assert.equal(
    item.querySelector('.dsh-answer-translation-text').textContent,
    '중첩 항목: targetLanguage 값은 인터페이스 언어를 따릅니다.'
  )
})

await test('번역 서비스가 없으면 원래 답변 렌더러를 바꾸지 않는다', async (t) => {
  const { core, native } = await setup(t, { remote: false })
  assert.equal(core.entriesOfSlot(SLOT).find((entry) => entry.options.key === 'assistant-step').component, native)
})

await test('플러그인을 해제하면 원래 답변 렌더러와 DOM을 복원한다', async (t) => {
  const { core, native, effects, node, render, container } = await setup(t)
  await render({ node: node(), sessionId: 'session-1' })
  assert.ok(container.querySelector('[data-answer-translation]'))
  await React.act(async () => {
    for (const dispose of effects.splice(0).reverse()) dispose()
  })
  assert.equal(core.entriesOfSlot(SLOT).find((entry) => entry.options.key === 'assistant-step').component, native)
  await render({ node: node(), sessionId: 'session-1' })
  assert.equal(container.querySelector('[data-answer-translation], [data-answer-translation-marker]'), null)
})
