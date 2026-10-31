import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Window } from 'happy-dom'
import semver from 'semver'
import en from './en.json' with { type: 'json' }
import ko from '../src/ko.json' with { type: 'json' }
import manifest from '../package.json' with { type: 'json' }

function loadClient(source, browser = new Window()) {
  let loaded
  runInNewContext(source, {
    Date,
    document: browser.document,
    Element: browser.Element,
    HTMLElement: browser.HTMLElement,
    KeyboardEvent: browser.KeyboardEvent,
    navigator: { languages: ['en-US'] },
    window: {
      setTimeout,
      clearTimeout,
      __ModuleLoader__: {
        load({ id, factory }) {
          // LocaleRuntime does not render. Fail if a test touches a UI dependency
          // rather than silently substituting a fake implementation for it.
          const exports = factory(
            (name) =>
              new Proxy(
                {},
                {
                  get() {
                    throw new Error(`Unexpected rendering dependency: ${name}`)
                  },
                }
              )
          )
          loaded = { id, exports }
        },
      },
    },
  })
  assert.ok(loaded, 'client must register with the Harness ModuleLoader')
  return loaded
}

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
const upstreamSource = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-locale/client')), 'utf8')
const plugin = loadClient(source)

await test('installation allows DSH 0.2 updates from rc.2 without opting into the next minor', () => {
  for (const version of ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1', '0.2.2-rc.1', '0.2.2', '0.2.99']) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), true, version)
  }
  for (const version of ['0.2.0', '0.2.1-rc.1', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), false, version)
  }
})

await test('all supported namespaces preserve upstream keys and placeholders', () => {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort())
  const placeholders = (text) =>
    [...text.matchAll(/\{\w+\}/g)].map(([value]) => value).sort((left, right) => left.localeCompare(right))
  for (const [namespace, dictionary] of Object.entries(en)) {
    assert.deepEqual(Object.keys(ko[namespace]).sort(), Object.keys(dictionary).sort(), namespace)
    for (const [key, original] of Object.entries(dictionary)) {
      const translated = ko[namespace][key]
      assert.equal(typeof translated, 'string')
      if (original.trim()) assert.ok(translated.trim(), `${namespace}.${key} is empty`)
      else assert.equal(translated, original, `${namespace}.${key} is an intentional empty prefix`)
      assert.doesNotMatch(translated, /[\u200b\ufeff]/u)
      assert.deepEqual(placeholders(translated), placeholders(original), `${namespace}.${key}`)
    }
  }
})

await test('built plugin translates, falls back, unloads and reloads through real Cordis and LocaleRuntime', async () => {
  assert.equal(plugin.id, manifest.name)
  const { LocaleRuntime } = loadClient(upstreamSource).exports
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  for (const [namespace, dictionary] of Object.entries(en)) locale.register(namespace, 'en', dictionary)
  locale.register('futurePlugin', 'en', { newFeature: 'Future feature' })
  try {
    const fiber = ctx.plugin(plugin.exports)
    await fiber.await()
    assert.equal(locale.getLocale().active, 'en', 'installing must not override the preference')
    assert.equal(locale.getLocale().locales.find(({ id }) => id === 'ko').label, '한국어')
    locale.setLocale('ko')
    assert.equal(locale.bind('settings')('title'), '설정')
    assert.equal(locale.bind('pluginManager')('extensionsTitle'), '실험적 플러그인')
    assert.equal(locale.bind('settings.pluginInventory')('search'), '플러그인 검색')
    assert.equal(
      locale.bind('conversation')('detail.output.lines', {
        begin: 2,
        end: 7,
        total: 19,
      }),
      '전체 19행 중 2–7행'
    )
    assert.equal(locale.bind('futurePlugin')('newFeature'), 'Future feature')
    assert.equal(locale.bind('futurePlugin')('cancel'), '취소')
    await fiber.dispose()
    assert.equal(locale.getLocale().active, 'en')
    assert.equal(
      locale.getLocale().locales.some(({ id }) => id === 'ko'),
      false
    )
    assert.equal(locale.bind('settings')('title'), 'Settings')
    const reloaded = ctx.plugin(plugin.exports)
    await reloaded.await()
    assert.equal(locale.getLocale().active, 'ko', 'explicit selection is restored after reload')
    assert.equal(locale.bind('settings')('title'), '설정')
  } finally {
    await ctx.fiber.dispose()
  }
})

await test('official plugin metadata translates, keeps explicit text and unloads with the plugin', async () => {
  const { LocaleRuntime } = loadClient(upstreamSource).exports
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  for (const [namespace, dictionary] of Object.entries(en)) locale.register(namespace, 'en', dictionary)
  // A package metadata map as the Host builds it from locale/en.json and locale/zh.json.
  const metadata = { en: 'Developer Tools', zh: '开发者工具' }
  const description = {
    en: 'Inspect and debug raw session data, grouped chat messages, and the NodeJS backend.',
    zh: '查看调试会话原始数据、聊天消息分组数据，以及调试 NodeJS 后端',
  }
  // A package without locale files falls back to plain strings.
  const fallback = 'Machine translation with reusable Session results'
  assert.equal(locale.resolveText(metadata), 'Developer Tools', 'English is the shipped fallback')
  try {
    const fiber = ctx.plugin(plugin.exports)
    await fiber.await()
    locale.setLocale('ko')
    assert.equal(locale.resolveText(metadata), '개발자 도구')
    assert.equal(
      locale.resolveText(description),
      '세션 원시 데이터, 그룹화된 채팅 메시지, NodeJS 백엔드를 검사하고 디버깅합니다.'
    )
    assert.equal(locale.resolveText(fallback), '재사용 가능한 세션 결과를 이용한 기계 번역')
    assert.equal(locale.resolveText('Some plugin name'), 'Some plugin name', 'unknown plain strings stay verbatim')
    assert.equal(locale.resolveText('tool-bash'), 'tool-bash', 'module identifiers stay verbatim')
    assert.equal(
      locale.resolveText({ en: 'Developer Tools', ko: '직접 번역' }),
      '직접 번역',
      'a package-supplied Korean text wins over the shared dictionary'
    )
    assert.equal(locale.resolveText({ en: 'A plugin without a translation' }), 'A plugin without a translation')
    locale.setLocale('en')
    assert.equal(locale.resolveText(metadata), 'Developer Tools', 'other active languages keep their own resolution')
    assert.equal(locale.resolveText(fallback), fallback)
    locale.setLocale('ko')
    await fiber.dispose()
    assert.equal(locale.getLocale().active, 'en')
    assert.equal(locale.resolveText(metadata), 'Developer Tools', 'disposing the plugin restores the locale service')
  } finally {
    await ctx.fiber.dispose()
  }
})

await test('IME Enter replays once after commit and respects cancellation and plugin lifecycle', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
  const browser = new Window()
  const { document, KeyboardEvent, CompositionEvent } = browser
  const { LocaleRuntime } = loadClient(upstreamSource).exports
  const client = loadClient(source, browser).exports
  const ctx = new Context()
  ctx.provide('locale', new LocaleRuntime(ctx))
  let fiber = ctx.plugin(client)
  await fiber.await()
  t.after(async () => {
    await ctx.fiber.dispose()
    await browser.happyDOM.close()
  })
  const settle = () => t.mock.timers.tick(60)
  let root
  let replays
  const key = (type, init = {}, target = root) => {
    const event = new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    assert.equal(event.defaultPrevented, false, 'the plugin must leave original IME/default behavior intact')
  }
  const composition = (type, target = root) => target.dispatchEvent(new CompositionEvent(type, { bubbles: true }))
  const commit = (init = {}) => {
    composition('compositionstart')
    key('keydown', { isComposing: true, keyCode: 229, ...init })
    composition('compositionend')
  }
  const reset = () => {
    document.body.innerHTML = '<div data-composer-input contenteditable="true"></div><textarea></textarea>'
    root = document.querySelector('[data-composer-input]')
    root.focus()
    replays = []
    // Original events have no which=13. Observe the ordinary Enter the host receives.
    root.addEventListener('keydown', (event) => {
      if (event.which === 13) replays.push(event)
    })
  }

  for (const init of [{}, { ctrlKey: true }, { metaKey: true }, { code: 'NumpadEnter' }]) {
    await t.test(`committed Enter preserves modifiers ${JSON.stringify(init)}`, () => {
      reset()
      commit(init)
      key('keyup', init)
      settle()
      assert.equal(replays.length, 1)
      assert.equal(replays[0].isComposing, false)
      assert.equal(replays[0].keyCode, 13)
      assert.equal(replays[0].ctrlKey, init.ctrlKey ?? false)
      assert.equal(replays[0].metaKey, init.metaKey ?? false)
    })
  }

  await t.test('Safari end-before-keydown and Process/229 keyup-only sequences', () => {
    for (const keyupFirst of [null, false, true]) {
      reset()
      composition('compositionstart')
      if (keyupFirst !== null) key('keydown', { key: 'Process', code: '', keyCode: 229 })
      if (keyupFirst) key('keyup')
      composition('compositionend')
      if (keyupFirst === null) key('keydown')
      if (!keyupFirst) key('keyup')
      settle()
      assert.equal(replays.length, 1)
      key('keyup')
      settle()
      assert.equal(replays.length, 1, 'late keyup must not submit again')
    }
  })

  await t.test('only replays inside the host post-composition guard, not at its boundary', () => {
    for (const [delay, expected] of [
      [9, 1],
      [10, 0],
      [11, 0],
    ]) {
      reset()
      composition('compositionstart')
      composition('compositionend')
      t.mock.timers.tick(delay)
      key('keydown')
      key('keyup')
      settle()
      assert.equal(replays.length, expected, `${delay} ms after compositionend`)
    }
  })

  await t.test('late IME-flagged Enter replays only when a composition end was observed', () => {
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      reset()
      composition('compositionstart')
      composition('compositionend')
      t.mock.timers.tick(20)
      key('keydown', init)
      settle()
      assert.equal(replays.length, 1)
      reset()
      composition('compositionstart')
      key('keydown', init)
      t.mock.timers.tick(500)
      assert.equal(replays.length, 0, 'an Enter that leaves the IME composing must not send')
    }
  })

  for (const init of [{ shiftKey: true }, { altKey: true }, { repeat: true }]) {
    await t.test(`does not replay ${JSON.stringify(init)}`, () => {
      reset()
      commit(init)
      key('keyup', init)
      settle()
      assert.equal(replays.length, 0)
    })
  }

  await t.test('ordinary Enter, composition without Enter, and unrelated fields remain untouched', () => {
    reset()
    key('keydown')
    key('keyup')
    settle()
    assert.equal(replays.length, 0)
    composition('compositionstart')
    composition('compositionend')
    settle()
    assert.equal(replays.length, 0)
    const textarea = document.querySelector('textarea')
    composition('compositionstart', textarea)
    key('keydown', { isComposing: true }, textarea)
    composition('compositionend', textarea)
    settle()
    assert.equal(replays.length, 0)
  })

  for (const action of [
    () => key('keydown', { key: 'a', code: 'KeyA' }),
    () => key('keydown', { key: 'ArrowDown', code: 'ArrowDown' }),
    () => composition('compositionstart'),
    () => document.querySelector('textarea').focus(),
    () => root.remove(),
    () => (root.contentEditable = 'false'),
    () => key('keydown'),
  ]) {
    await t.test(`cancels pending replay: ${String(action)}`, () => {
      reset()
      commit()
      // The last case is a second, ordinary Enter after the host's guard has lifted.
      t.mock.timers.tick(15)
      action()
      settle()
      assert.equal(replays.length, 0)
    })
  }

  await t.test('candidate selection that keeps composing does not send on a later end', () => {
    reset()
    composition('compositionstart')
    key('keydown', { isComposing: true })
    t.mock.timers.tick(180)
    composition('compositionend')
    key('keyup')
    settle()
    assert.equal(replays.length, 0)
  })

  await t.test('disposing cancels pending send; reload installs only one listener set', async () => {
    reset()
    commit()
    await fiber.dispose()
    settle()
    assert.equal(replays.length, 0)
    commit()
    settle()
    assert.equal(replays.length, 0)
    fiber = ctx.plugin(client)
    await fiber.await()
    commit()
    settle()
    assert.equal(replays.length, 1)
  })
})
