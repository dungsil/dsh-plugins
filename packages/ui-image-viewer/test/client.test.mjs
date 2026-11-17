import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import * as React from 'react'

/** Boot the built client bundle against a happy-dom document with a recorded locale service. */
async function boot(t) {
  const window = new Window()
  const previous = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })
  const disposers = []
  const dispose = () =>
    React.act(async () =>
      disposers
        .splice(0)
        .reverse()
        .forEach((fn) => fn())
    )
  t.after(async () => {
    await dispose()
    await window.happyDOM.close()
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const require = createRequire(import.meta.url)
  const icon = (name) => () => React.createElement('svg', { 'data-icon': name })
  let plugin
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    document: window.document,
    MutationObserver: window.MutationObserver,
    setTimeout,
    clearTimeout,
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((id) =>
            id === '@deepseek-ai/dsh-client-ui-primitives'
              ? new Proxy({}, { get: (_, name) => (typeof name === 'string' ? icon(name) : undefined) })
              : require(id)
          )
        },
      },
    },
  })
  const dictionaries = new Map()
  await React.act(() =>
    plugin.apply({
      effect: (setup) => disposers.push(setup()),
      locale: {
        register: (ns, language, dictionary) => (dictionaries.set(language, dictionary), () => {}),
        bind: () => (key) => dictionaries.get('en')[key],
        subscribe: () => () => {},
      },
    })
  )
  return { window, document: window.document, dispose }
}

/** Mount a conversation the way DSH renders it: history thumbnails and a composer seat. */
function conversation(document, labels, { composer = [] } = {}) {
  const root = document.createElement('div')
  root.setAttribute('data-conversation-content', '')
  const thumbnail = (label) => {
    const button = document.createElement('button')
    button.setAttribute('aria-label', label)
    const image = document.createElement('img')
    image.alt = label
    button.append(image)
    return button
  }
  const history = labels.map(thumbnail)
  const seat = document.createElement('div')
  seat.setAttribute('data-composer-seat', '')
  seat.append(...composer.map(thumbnail))
  root.append(...history, seat)
  document.body.append(root)
  return { root, history, drafts: [...seat.children] }
}

/** Native `ImageLightbox` contract: body portal, focus restore to the element focused at open. */
function nativeLightbox(document, opener) {
  opener.addEventListener('click', () => {
    const restore = document.activeElement
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    const stage = document.createElement('div')
    const image = document.createElement('img')
    image.alt = opener.querySelector('img').alt
    // The native image menu binding makes the preview image focusable.
    image.tabIndex = 0
    const close = document.createElement('button')
    close.setAttribute('aria-label', 'Close')
    close.addEventListener('click', () => {
      dialog.remove()
      restore?.focus()
    })
    stage.append(document.createElement('div'), image, close)
    dialog.append(stage)
    document.body.append(dialog)
    close.focus()
  })
}

/** Run `fn` and let the plugin's mutation observers render inside the same act scope. */
const run = (fn) =>
  React.act(async () => {
    await fn()
    await sleep(0)
  })
const settle = () => run(() => {})
const openDialog = (document) => document.querySelector('body > [role="dialog"]')
const shown = (document) => openDialog(document)?.querySelector('img').alt
const control = (document, direction) => openDialog(document)?.querySelector(`[data-dungsil-image-nav="${direction}"]`)

await test('다운로드 중인 대화 이미지에만 표시기를 붙이고 로드·오류·제거·해제 때 정리한다', async (t) => {
  const { window, document, dispose } = await boot(t)
  const { root, history, drafts } = conversation(document, ['slow', 'cached', 'failing', 'removed'], {
    composer: ['draft'],
  })
  const [slow, cached, failing] = history.map((button) => button.querySelector('img'))
  // The observer reads these after this synchronous block, as a browser reads a fresh node.
  for (const image of [...history, ...drafts].map((button) => button.querySelector('img'))) {
    Object.defineProperty(image, 'complete', { configurable: true, value: image === cached })
    image.src = `https://example.test/${image.alt}.png`
  }
  await settle()
  // Booleans and labels keep a failure message small; printing a happy-dom node exhausts memory.
  const indicator = (button) => button.querySelector('[data-dungsil-image-loading-indicator]') !== null
  assert.equal(indicator(history[0]), false, '짧은 지연 안에는 표시기를 그리지 않는다')
  await run(() => sleep(200))
  assert.equal(indicator(history[0]), true)
  assert.equal(history[0].getAttribute('aria-busy'), 'true')
  assert.equal(indicator(history[1]), false)
  assert.equal(indicator(drafts[0]), false)
  // The native image node, its URL and its label stay as rendered.
  assert.equal(history[0].querySelector(':scope > img') === slow, true)
  assert.equal(slow.src, 'https://example.test/slow.png')
  assert.equal(history[0].getAttribute('aria-label'), 'slow')

  Object.defineProperty(slow, 'complete', { configurable: true, value: true })
  await run(() => slow.dispatchEvent(new window.Event('load')))
  assert.equal(indicator(history[0]), false)
  assert.equal(history[0].hasAttribute('aria-busy'), false)
  await run(() => failing.dispatchEvent(new window.Event('error')))
  assert.equal(indicator(history[2]), false)
  assert.equal(history[2].hasAttribute('data-dungsil-image-loading'), false)

  history[3].remove()
  await settle()
  assert.equal(indicator(history[3]), false)
  assert.equal(history[3].hasAttribute('data-dungsil-image-loading'), false)

  const late = conversation(document, ['late'])
  const lateImage = late.history[0].querySelector('img')
  Object.defineProperty(lateImage, 'complete', { configurable: true, value: false })
  lateImage.src = 'https://example.test/late.png'
  await run(() => sleep(200))
  assert.equal(indicator(late.history[0]), true)
  await dispose()
  assert.equal(
    document.querySelectorAll('[data-dungsil-image-loading-indicator], [data-dungsil-image-loading]').length,
    0
  )
  assert.equal(late.history[0].hasAttribute('aria-busy'), false)
  root.remove()
})

await test('같은 대화의 이미지 사이를 이동하고 작성기 첨부를 제외하며 처음 연 이미지로 포커스를 돌려준다', async (t) => {
  const { window, document, dispose } = await boot(t)
  const other = conversation(document, ['other'])
  const { history, drafts } = conversation(document, ['first', 'middle', 'last'], { composer: ['draft'] })
  const single = conversation(document, ['solo'])
  for (const button of [...other.history, ...history, ...drafts, ...single.history]) nativeLightbox(document, button)
  const key = (name) => run(() => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: name })))

  // Opened without focusing the thumbnail, as Safari does for a pointer click.
  await run(() => history[1].click())
  assert.equal(shown(document), 'middle')
  assert.equal(control(document, 'previous').disabled, false)
  assert.equal(control(document, 'next').getAttribute('aria-label'), 'Next image')
  openDialog(document).querySelector('img').focus()
  await run(() =>
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, cancelable: true }))
  )
  assert.equal(document.activeElement?.getAttribute('data-dungsil-image-nav'), 'next')

  await key('ArrowRight')
  assert.equal(shown(document), 'last')
  assert.equal(document.querySelectorAll('body > [role="dialog"]').length, 1)
  assert.equal(control(document, 'next').disabled, true, '작성기 첨부는 다음 이미지가 아니다')
  await key('ArrowRight')
  assert.equal(shown(document), 'last')

  await run(() => control(document, 'previous').click())
  await run(() => control(document, 'previous').click())
  assert.equal(shown(document), 'first')
  assert.equal(control(document, 'previous').disabled, true, '다른 대화의 이미지는 이전 이미지가 아니다')
  // The pressed control is disabled at the first image, so the native close control keeps focus.
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'Close')
  await run(() => control(document, 'next').click())
  assert.equal(shown(document), 'middle')
  assert.equal(document.activeElement?.getAttribute('data-dungsil-image-nav'), 'next')
  await key('ArrowLeft')
  assert.equal(shown(document), 'first')

  await run(() => openDialog(document).querySelector('button[aria-label="Close"]').click())
  await settle()
  assert.equal(shown(document), undefined)
  assert.equal(document.activeElement?.getAttribute('aria-label'), 'middle')

  await run(() => single.history[0].click())
  assert.equal(control(document, 'next') === null, true)
  await key('ArrowLeft')
  assert.equal(shown(document), 'solo')
  await run(() => openDialog(document).querySelector('button[aria-label="Close"]').click())

  await run(() => drafts[0].click())
  assert.equal(control(document, 'previous') === null, true)
  await run(() => openDialog(document).querySelector('button[aria-label="Close"]').click())

  await run(() => history[0].click())
  assert.equal(control(document, 'next') === null, false)
  await dispose()
  assert.equal(control(document, 'next') === null, true)
  await key('ArrowRight')
  assert.equal(shown(document), 'first')
})
