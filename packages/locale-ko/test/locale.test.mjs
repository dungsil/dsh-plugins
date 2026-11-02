import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { Window } from 'happy-dom'
import semver from 'semver'
import { parse } from 'yaml'
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
const imeSource = await readFile(new URL(import.meta.resolve('@dungsil/dsh-plugin-korean-ime/client')), 'utf8')
const upstreamSource = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-locale/client')), 'utf8')
const plugin = loadClient(source)

await test('bundle exposes two enabled, independently loadable and localized components', async () => {
  const patch = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
  assert.deepEqual(patch, [
    {
      insert: [
        { id: 'dungsil-locale-ko', name: manifest.name },
        { id: 'dungsil-korean-ime', name: '@dungsil/dsh-plugin-korean-ime' },
      ],
    },
  ])
  for (const [index, row] of patch[0].insert.entries()) {
    const packageManifest = JSON.parse(await readFile(new URL(import.meta.resolve(`${row.name}/package.json`)), 'utf8'))
    assert.equal(packageManifest.dsh.client.platform, 'web')
    assert.equal(packageManifest.dsh.client.immediately, true)
    assert.equal(typeof (await import(row.name)).apply, 'function')
    const client = loadClient(await readFile(new URL(import.meta.resolve(`${row.name}/client`)), 'utf8'))
    assert.equal(client.id, row.name)
    for (const language of ['en', 'ko']) {
      const { meta } = JSON.parse(
        await readFile(new URL(import.meta.resolve(`${row.name}/locale/${language}.json`)), 'utf8')
      )
      assert.equal(meta.title, { en: ['Korean UI', 'Korean IME'], ko: ['한국어 UI', '한국어 IME'] }[language][index])
      assert.ok(meta.description)
    }
  }
})

await test('installation allows DSH 0.2 updates from rc.2 without opting into the next minor', () => {
  for (const version of ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1', '0.2.2-rc.1', '0.2.2', '0.2.99']) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), true, version)
  }
  for (const version of ['0.2.0', '0.2.1-rc.1', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), false, version)
  }
})

await test('Korean dictionaries stay complete and well-formed', () => {
  // These entries translate an English blank prefix, so they stay blank.
  const intentionallyBlank = new Set([
    'chat.message.stepProcess.sharedPrefix',
    'pluginManager.sentenceSeparator',
    'schedule.catalog.cron.part.join',
    'schedule.manager.cron.part.join',
  ])
  for (const [namespace, dictionary] of Object.entries(ko)) {
    assert.ok(Object.keys(dictionary).length > 0, `${namespace} is empty`)
    for (const [key, translated] of Object.entries(dictionary)) {
      const id = `${namespace}.${key}`
      assert.equal(typeof translated, 'string', id)
      if (intentionallyBlank.has(id)) assert.equal(translated.trim(), '', `${id} must stay blank`)
      else assert.ok(translated.trim(), `${id} is empty`)
      assert.doesNotMatch(translated, /[\u200b\ufeff]/u, id)
      // Every brace pair must form one placeholder; a leftover brace is a typo.
      assert.doesNotMatch(translated.replace(/\{\w+\}/g, ''), /[{}]/, id)
    }
  }
})

await test('built plugin translates, falls back, unloads and reloads through real Cordis and LocaleRuntime', async () => {
  assert.equal(plugin.id, manifest.name)
  const { LocaleRuntime } = loadClient(upstreamSource).exports
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  // English is the built-in fallback; register only what these assertions resolve.
  locale.register('settings', 'en', { title: 'Settings' })
  locale.register('futurePlugin', 'en', { newFeature: 'Future feature' })
  try {
    const fiber = ctx.plugin(plugin.exports)
    await fiber.await()
    assert.equal(locale.getLocale().active, 'en', 'installing must not override the preference')
    assert.equal(locale.getLocale().locales.find(({ id }) => id === 'ko').label, '한국어')
    locale.setLocale('ko')
    assert.equal(locale.bind('settings')('title'), '설정')
    assert.equal(locale.bind('pluginManager')('extensionsTitle'), '실험적 플러그인')
    const t = locale.bind('pluginManager')
    assert.equal(t('versionsAvailable', { version: '0.4.0' }), '0.4.0 버전으로 업데이트 가능')
    assert.equal(
      t('updateDescription', { from: '0.3.1', to: '0.4.0' }),
      '0.3.1 버전을 0.4.0 버전으로 교체하며, 플러그인이 잠시 중지될 수 있습니다. 설치에 실패하면 0.3.1 버전을 유지하거나 다시 설치합니다.'
    )
    assert.equal(t('updateStepInstalling', { version: '0.4.0', registry: 'npm' }), 'npm에서 0.4.0 버전 설치')
    assert.equal(
      t('updateRestoredDetail', { from: '0.3.1', to: '0.4.0' }),
      '0.4.0 버전을 설치하지 못해 0.3.1 버전을 다시 설치했습니다.'
    )
    assert.equal(locale.bind('settings.subagent')('subagentTitle'), '하위 에이전트')
    assert.equal(
      locale.bind('settings.subagent')('subagentDescription'),
      '하위 에이전트의 재귀 깊이, 동시 실행 수, 모델을 설정합니다.'
    )
    assert.equal(locale.bind('settings.webSearch')('title'), '웹 검색')
    assert.equal(locale.bind('settings.webSearch')('description'), 'DeepSeek 검색 공급자를 설정합니다.')
    assert.equal(locale.bind('settings.agentLoop')('title'), '에이전트 루프')
    assert.equal(locale.bind('settings.agentLoop')('description'), '에이전트가 도구 호출을 배분하는 방식을 제어합니다.')
    assert.equal(locale.bind('settings.shell')('title'), '셸')
    assert.equal(locale.bind('settings.shell')('description'), '각 명령의 실행 시간과 출력량을 제한합니다.')
    assert.equal(locale.bind('settings.pluginInventory')('search'), '플러그인 검색')
    assert.equal(locale.bind('trajectory')('view.trajectory'), '실행 기록')
    assert.equal(locale.bind('trajectory')('toolbar.search'), '실행 기록 검색')
    assert.equal(locale.bind('trajectory')('turn.label', { turn: 3 }), '3턴')
    assert.equal(locale.bind('trajectory')('summary.toolCalls.other', { count: 2 }), '도구 호출 2회')
    assert.equal(locale.bind('trajectory')('unit.tokensPerSecond', { value: '12.5' }), '12.5토큰/초')
    assert.equal(locale.bind('job')('count.live.other', { count: 2 }), '백그라운드 작업 2개 실행 중')
    assert.equal(locale.bind('command')('section.commands'), '명령')
    assert.equal(locale.bind('plan')('chip.label'), '계획')
    assert.equal(locale.bind('goal')('phase.active'), '진행 중인 목표')
    assert.equal(locale.bind('subagent')('duration.minutes', { minutes: 2, seconds: 5 }), '2분 5초')
    assert.equal(locale.bind('question')('error.incomplete'), '먼저 이 질문에 답변하세요.')
    assert.equal(locale.bind('sidebarFiles')('type.label'), '파일')
    assert.equal(locale.bind('schedule.manager')('title'), '자동화 작업')
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
    // An in-place update loads a new module instance after disposing the old one.
    const reloaded = ctx.plugin(loadClient(source).exports)
    await reloaded.await()
    assert.equal(locale.getLocale().active, 'ko', 'explicit selection is restored after reload')
    assert.equal(locale.bind('settings')('title'), '설정')
    assert.equal(t('updateDone', { version: '0.4.0' }), '0.4.0 버전으로 업데이트했습니다')
  } finally {
    await ctx.fiber.dispose()
  }
})

await test('official plugin metadata translates, keeps explicit text and unloads with the plugin', async () => {
  const { LocaleRuntime } = loadClient(upstreamSource).exports
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
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
  const client = loadClient(imeSource, browser).exports
  const ctx = new Context()
  // IME activation must not need even the host's locale service.
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

  await t.test('disposing cancels pending send; in-place replacement sends Enter only once', async () => {
    reset()
    commit()
    await fiber.dispose()
    settle()
    assert.equal(replays.length, 0)
    commit()
    settle()
    assert.equal(replays.length, 0)
    fiber = ctx.plugin(loadClient(imeSource, browser).exports)
    await fiber.await()
    commit()
    settle()
    assert.equal(replays.length, 1)
  })

  await t.test('translation and IME can be toggled independently without duplicate Enter handling', async () => {
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    locale.register('settings', 'en', { title: 'Settings' })
    const translation = loadClient(source, browser).exports
    let languageFiber = ctx.plugin(translation)
    await languageFiber.await()
    locale.setLocale('ko')
    reset()
    commit()
    settle()
    assert.equal(replays.length, 1, 'both enabled must not install duplicate handlers')
    assert.equal(locale.bind('settings')('title'), '설정')

    reset()
    commit()
    await fiber.dispose()
    settle()
    assert.equal(replays.length, 0, 'disabling IME cancels an in-flight send')
    commit()
    settle()
    assert.equal(replays.length, 0, 'translation alone must not replay Enter')
    assert.equal(locale.bind('settings')('title'), '설정')

    fiber = ctx.plugin(client)
    await fiber.await()
    await languageFiber.dispose()
    assert.equal(locale.bind('settings')('title'), 'Settings')
    reset()
    commit()
    settle()
    assert.equal(replays.length, 1, 'IME remains active with translation disabled')

    languageFiber = ctx.plugin(translation)
    await languageFiber.await()
    assert.equal(locale.getLocale().active, 'ko', 'the language preference survives toggling')
    assert.equal(locale.bind('settings')('title'), '설정')
    reset()
    commit()
    settle()
    assert.equal(replays.length, 1)

    await languageFiber.dispose()
    await fiber.dispose()
    reset()
    commit()
    settle()
    assert.equal(replays.length, 0, 'both disabled restore the host behavior')
    assert.equal(locale.bind('settings')('title'), 'Settings')
  })
})
