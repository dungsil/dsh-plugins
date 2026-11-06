import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { Window } from 'happy-dom'
import * as React from 'react'
import { createRoot } from 'react-dom/client'

async function fixture(t, language = 'ko', accounts = exampleAccounts, results = exampleResults) {
  const window = new Window()
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT']
  const previous = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key))
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const container = window.document.createElement('div')
  window.document.body.append(container)
  const root = createRoot(container)
  t.after(async () => {
    await React.act(() => root.unmount())
    await window.happyDOM.close()
    globals.forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index])
      else delete globalThis[key]
    })
  })
  const require = createRequire(import.meta.url)
  const icon = () => React.createElement('svg', { 'aria-hidden': true })
  let plugin, Page, props
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    document: window.document,
    MutationObserver: window.MutationObserver,
    AbortController,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) =>
            id !== '@deepseek-ai/dsh-client-ui-primitives'
              ? require(id)
              : {
                  Button: ({ children, variant: _variant, size: _size, icon, ...rest }) =>
                    React.createElement('button', rest, icon, children),
                  Input: ({ icon: _icon, ...rest }) => React.createElement('input', rest),
                  IconRefreshOutlineRegular: icon,
                  IconSearchOutlineRegular: icon,
                  IconDataOutlineRegular: icon,
                }
          )
        },
      },
    },
  })
  const requests = []
  const snapshot = { active: language }
  const connection = {
    generation: { getSnapshot: () => ({ id: 1 }), subscribe: () => () => {} },
    rpc: {
      call: async (_channel, method, payload) => {
        const endpoint = method.split('/').at(-1)
        requests.push({ endpoint, payload })
        if (endpoint === 'describe')
          return {
            ok: true,
            value: { baseURL: 'http://localhost:8317', revision: '1', apiKeySaved: true, managementKeySaved: true },
          }
        if (endpoint === 'quota-list') return { ok: true, value: accounts }
        if (endpoint === 'quota-fetch') {
          const result = results[payload.name]
          return result === null ? { ok: false } : { ok: true, value: result }
        }
        return { ok: true, value: {} }
      },
    },
  }
  const ctx = {
    get: () => connection,
    locale: { getSnapshot: () => snapshot, subscribe: () => () => {} },
    effect: (setup) => setup(),
    on: () => () => {},
    emit: () => {},
    slots: {
      inject: (_slot, setup) => setup(),
      register: (options, render) => {
        if (options.name === 'main') {
          Page = render
          props = options.inject()
        }
      },
    },
  }
  plugin.apply(ctx)
  await React.act(async () => root.render(React.createElement(Page, props)))
  const search = async (value) => {
    const input = container.querySelector('input[type=search]')
    // Invoke React's bound callback: happy-dom does not emulate browser input tracking.
    const key = Object.keys(input).find((key) => key.startsWith('__reactProps'))
    await React.act(async () => input[key].onChange({ target: { value } }))
  }
  return { container, requests, search }
}

const account = (name, provider, extra = {}) => ({
  name,
  provider,
  authIndex: name,
  editable: true,
  supported: true,
  disabled: false,
  ...extra,
})
const window = (id, usedPercent, periodSeconds = 18000) => ({
  id,
  usedPercent,
  periodSeconds,
  resetAt: '2026-11-06T16:30:00+09:00',
})
const result = (windows) => ({ windows, plan: 'Pro', observedAt: '2026-11-06T05:10:00Z' })
const exampleAccounts = [
  account('google-a', 'antigravity'),
  account('claude-a', 'claude'),
  account('google-b', 'antigravity'),
]
const exampleResults = {
  'google-a': result([window('Gemini Pro', 86), window('Gemini Flash', 24), window('Gemini Pro', 42, 604800)]),
  'claude-a': result([window('five_hour', 32), window('seven_day', 18, 604800)]),
  'google-b': result([window('Gemini Pro', 31, 604800), window('Gemini Pro', 12)]),
}

await test('공급자별로 나누지 않고 계정 순서대로 카드를 표시하고 하단에서 개별 새로고침한다', async (t) => {
  const { container, requests } = await fixture(t)
  assert.equal(container.querySelector('table'), null)
  assert.equal(container.querySelectorAll('.quota-grid').length, 1)
  const cards = [...container.querySelectorAll('.quota-card')]
  assert.deepEqual(
    cards.map((card) => card.querySelector('.quota-account-name').textContent),
    ['google-a', 'claude-a', 'google-b']
  )
  for (const card of cards) {
    const refresh = card.querySelector('footer .quota-account-refresh')
    assert.ok(refresh.getAttribute('aria-label').includes(card.querySelector('.quota-account-name').textContent))
    assert.ok(refresh.querySelector('svg'))
    assert.equal(refresh.textContent, '할당량 새로고침')
  }
  await React.act(async () => cards[0].querySelector('.quota-account-refresh').click())
  assert.equal(requests.at(-1).endpoint, 'quota-fetch')
  assert.equal(requests.at(-1).payload.name, 'google-a')
})

await test('프로바이더별 로고와 별칭을 로컬 자산으로 표시하고 미등록 공급자는 기본 아이콘을 사용한다', async (t) => {
  const providers = [
    ['claude', 'claude'],
    ['Anthropic', 'claude'],
    ['antigravity', 'antigravity'],
    ['codex', 'codex'],
    ['openai_codex', 'codex'],
    ['gemini', 'gemini'],
    ['vertex', 'gemini'],
    ['openai-compatibility', 'openai'],
    ['kimi-ai', 'kimi'],
    ['grok', 'xai'],
    ['ollama-cloud', 'ollama'],
    ['meta', 'meta'],
    ['devin', 'devin'],
    ['opencode-go', 'opencode'],
    ['unknown-provider', 'generic'],
    ['__proto__', 'generic'],
  ]
  const accounts = providers.map(([provider], index) => account(`icon-${index}`, provider, { supported: false }))
  const { container } = await fixture(t, 'ko', accounts, {})
  const cards = [...container.querySelectorAll('.quota-card')]
  assert.equal(cards.length, providers.length)
  cards.forEach((card, index) => {
    const mark = card.querySelector('[data-provider-brand]')
    const brand = providers[index][1]
    const simpleIcons = ['claude', 'gemini', 'kimi', 'ollama', 'meta', 'opencode'].includes(brand)
    assert.equal(mark.dataset.providerBrand, brand)
    assert.equal(
      mark.dataset.providerSource,
      simpleIcons ? 'simple-icons' : brand === 'generic' ? 'generic' : 'lobe-icons'
    )
    assert.equal(mark.getAttribute('aria-hidden'), 'true')
    assert.ok(card.querySelector('.quota-card-heading').contains(mark))
    const image = mark.querySelector('img')
    if (image) {
      assert.ok(image.src.startsWith('data:image/svg+xml,'))
      assert.equal(image.alt, '')
      assert.ok(decodeURIComponent(image.src).includes('Copyright (c) 2023 LobeHub'))
    } else if (providers[index][1] === 'generic') {
      assert.ok(mark.querySelector('svg'))
    } else {
      const mask = mark.firstElementChild.style.maskImage
      assert.ok(mask.includes('data:image/svg+xml,'))
      assert.equal(mark.firstElementChild.style.background, 'currentcolor')
      if (simpleIcons) {
        assert.ok(decodeURIComponent(mask).includes('Simple Icons 16.36.0'))
        assert.ok(decodeURIComponent(mask).includes('CC0-1.0'))
      }
    }
  })
})

await test('프로바이더를 주 제목으로 표시하고 계정명과 요금제는 보조 정보로 유지한다', async (t) => {
  const { container } = await fixture(t)
  const cards = [...container.querySelectorAll('.quota-card')]
  assert.deepEqual(
    cards.map((card) => card.querySelector('h2').textContent),
    ['antigravity', 'claude', 'antigravity']
  )
  cards.forEach((card, index) => {
    assert.equal(card.querySelector('header .quota-account-name').textContent, exampleAccounts[index].name)
    assert.ok(card.querySelector('.quota-plan').textContent.includes('Pro'))
  })
})

await test('카드 그리드는 내부 스크롤이나 휠 이벤트로 부모 세로 스크롤을 막지 않는다', async () => {
  const source = await readFile(new URL('../src/quota-panel.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /overscroll-behavior|onWheel|position:\s*sticky|quota-table-scroll/)
  assert.match(source, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(source, /@container \(max-width: 680px\)/)
})

await test('각 카드에는 자신의 한도만 원래 순서대로 표시하고 검색 결과가 없으면 검색을 지운다', async (t) => {
  const { container, search } = await fixture(t)
  const limits = [...container.querySelectorAll('.quota-card:last-child .quota-limit')]
  assert.equal(limits.length, 2)
  assert.equal(limits[0].querySelector('progress').value, 69)
  assert.equal(limits[1].querySelector('progress').value, 88)
  await search('google-b')
  assert.equal(container.querySelectorAll('.quota-card').length, 1)
  assert.equal(container.querySelectorAll('.quota-limit').length, 2)
  await search('no-match')
  assert.ok(container.textContent.includes('검색 조건에 맞는 계정이 없습니다'))
  const clear = [...container.querySelectorAll('button')].find((button) => button.textContent === '검색 지우기')
  await React.act(async () => clear.click())
  assert.equal(container.querySelectorAll('.quota-card').length, 3)
})

await test('잔여율 막대는 사용률의 반대값이며 소진과 미확인 값을 구분한다', async (t) => {
  const accounts = [account('many', 'antigravity')]
  const windows = Array.from({ length: 8 }, (_, i) => window(`model-${i}`, i * 10))
  windows.push(window('model-0', undefined), window('model-0', 100))
  const { container } = await fixture(t, 'ko', accounts, { many: result(windows) })
  const limits = [...container.querySelectorAll('.quota-limit')]
  assert.equal(limits.length, 10)
  assert.equal(container.querySelectorAll('progress').length, 9)
  assert.equal(limits[0].querySelector('progress').value, 100)
  assert.equal(limits[0].querySelector('.quota-value').textContent, '100% 남음')
  assert.equal(limits[8].querySelector('progress'), null)
  assert.equal(limits[8].querySelector('.quota-value').textContent, '미확인')
  assert.equal(limits[9].querySelector('progress').value, 0)
  assert.equal(limits[9].querySelector('.quota-value').textContent, '0% 남음')
  assert.equal(container.querySelectorAll('.quota-limit[hidden]').length, 0)
})

await test('조회 실패와 미지원 및 비활성 카드를 구분하고 사용할 수 없는 새로고침을 막는다', async (t) => {
  const accounts = [
    account('failed', 'claude'),
    account('unsupported', 'other', { supported: false }),
    account('disabled', 'codex', { disabled: true }),
  ]
  const { container } = await fixture(t, 'ko', accounts, { failed: null })
  const cards = [...container.querySelectorAll('.quota-card')]
  assert.ok(cards[0].querySelector('[role=alert]'))
  assert.equal(cards[0].querySelector('.quota-account-refresh').disabled, false)
  assert.equal(cards[1].querySelector('.quota-account-refresh').disabled, true)
  assert.equal(cards[2].querySelector('.quota-account-refresh').disabled, true)
})

await test('계정이 20개를 넘으면 페이지를 나누고 검색을 시작하면 첫 페이지로 돌아간다', async (t) => {
  const accounts = Array.from({ length: 21 }, (_, i) => account(`account-${i}`, 'other', { supported: false }))
  const { container, search } = await fixture(t, 'ko', accounts, {})
  assert.equal(container.querySelectorAll('.quota-card').length, 20)
  const next = [...container.querySelectorAll('button')].find((button) => button.textContent === '다음')
  await React.act(async () => next.click())
  assert.equal(container.querySelectorAll('.quota-card').length, 1)
  assert.equal(container.querySelector('.quota-account-name').textContent, 'account-20')
  await search('account-0')
  assert.equal(container.querySelector('.quota-account-name').textContent, 'account-0')
  assert.equal(container.querySelector('.quota-pagination'), null)
})

await test('빈 계정 목록은 검색 결과 없음과 구분하고 검색 지우기를 표시하지 않는다', async (t) => {
  const { container } = await fixture(t, 'ko', [], {})
  assert.equal(container.querySelector('.quota-card'), null)
  assert.ok(container.textContent.includes('사용 가능한 계정이 없습니다'))
  assert.equal(
    [...container.querySelectorAll('button')].some((button) => button.textContent === '검색 지우기'),
    false
  )
})

for (const [language, remaining, help] of [
  ['en', '14% remaining', 'About quota'],
  ['ko', '14% 남음', '할당량 안내'],
  ['zh', '剩余 14%', '配额说明'],
]) {
  await test(`${language} 로케일에서 잔여율과 라우팅 관리 동작을 제공한다`, async (t) => {
    const { container, requests } = await fixture(t, language)
    assert.equal(container.querySelector('.quota-value').textContent, remaining)
    assert.equal(container.querySelector('.quota-help summary').textContent, help)
    const details = container.querySelector('.quota-routing')
    details.open = true
    await React.act(async () => details.querySelector('button').click())
    assert.equal(requests.at(-1).endpoint, 'reset')
    assert.equal(requests.at(-1).payload.authIndex, 'google-a')
  })
}
