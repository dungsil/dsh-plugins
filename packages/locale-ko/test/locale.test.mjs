import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import semver from 'semver'
import { parse } from 'yaml'
import ko from '../src/ko.json' with { type: 'json' }
import manifest from '../package.json' with { type: 'json' }
import releaseLocale from './fixtures/dsh-0.2.2.json' with { type: 'json' }

function loadClient(source) {
  let loaded
  runInNewContext(source, {
    Date,
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

await test('번들은 활성화되었고 독립적으로 로드할 수 있으며 로케일이 적용된 컴포넌트 세 개를 노출한다', async () => {
  const patch = parse(await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
  assert.deepEqual(patch, [
    {
      insert: [
        { id: 'dungsil-locale-ko', name: manifest.name },
        { id: 'dungsil-korean-ime', name: '@dungsil/dsh-plugin-korean-ime' },
        { id: 'dungsil-yoonmoon', name: '@dungsil/dsh-plugin-yoonmoon' },
      ],
    },
  ])
  for (const [index, row] of patch[0].insert.entries()) {
    const packageManifest = JSON.parse(await readFile(new URL(import.meta.resolve(`${row.name}/package.json`)), 'utf8'))
    assert.equal(typeof (await import(row.name)).apply, 'function')
    if (row.name !== '@dungsil/dsh-plugin-yoonmoon') {
      assert.equal(packageManifest.dsh.client.platform, 'web')
      assert.equal(packageManifest.dsh.client.immediately, true)
      const client = loadClient(await readFile(new URL(import.meta.resolve(`${row.name}/client`)), 'utf8'))
      assert.equal(client.id, row.name)
    }
    for (const language of ['en', 'ko']) {
      const { meta } = JSON.parse(
        await readFile(new URL(import.meta.resolve(`${row.name}/locale/${language}.json`)), 'utf8')
      )
      assert.equal(
        meta.title,
        { en: ['Korean UI', 'Korean IME', 'Yoonmoon'], ko: ['한국어 UI', '한국어 IME', '윤문'] }[language][index]
      )
      assert.ok(meta.description)
    }
  }
})

await test('설치는 rc.5부터 DSH 0.2 업데이트를 허용하며 다음 마이너 버전은 선택하지 않는다', () => {
  for (const version of ['0.2.1-rc.5', '0.2.1-rc.6', '0.2.1', '0.2.2-rc.1', '0.2.2', '0.2.99']) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), true, version)
  }
  for (const version of [
    '0.2.0',
    '0.2.1-rc.1',
    '0.2.1-rc.2',
    '0.2.1-rc.3',
    '0.2.1-rc.4',
    '0.3.0-rc.1',
    '0.3.0',
    '1.0.0',
  ]) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), false, version)
  }
})

await test('한국어 사전은 완전하고 형식이 올바르게 유지된다', () => {
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

await test('DSH 0.2.2 신규 문구는 영어와 중국어에 대응하는 한국어 번역과 보간 변수를 빠짐없이 유지한다', () => {
  const placeholders = (text) =>
    [...text.matchAll(/\{\w+\}/g)].map(([value]) => value).sort((a, b) => a.localeCompare(b))
  assert.equal(releaseLocale.version, '0.2.2-rc.1')
  assert.equal(releaseLocale.commit, '66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db')
  assert.ok(Object.keys(releaseLocale.namespaces).length > 0)
  for (const [namespace, dictionary] of Object.entries(releaseLocale.namespaces)) {
    for (const [key, { en, zh }] of Object.entries(dictionary)) {
      const id = `${namespace}.${key}`
      const translated = ko[namespace]?.[key]
      assert.ok(en.trim(), `${id}: en`)
      assert.ok(zh.trim(), `${id}: zh`)
      assert.equal(typeof translated, 'string', `${id}: ko`)
      assert.ok(translated.trim(), `${id}: ko`)
      assert.deepEqual(placeholders(translated), placeholders(en), id)
      assert.deepEqual(placeholders(translated), placeholders(zh), id)
    }
  }
})

await test('빌드된 플러그인은 실제 Cordis와 LocaleRuntime을 통해 번역하고, 대체값으로 넘어가며, 언로드하고 다시 로드한다', async () => {
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

await test('빌드된 0.2.2 신규 문구는 영어와 한국어와 중국어 전환 및 보간을 지원한다', async () => {
  const { LocaleRuntime } = loadClient(upstreamSource).exports
  const ctx = new Context()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  try {
    for (const [namespace, dictionary] of Object.entries(releaseLocale.namespaces)) {
      for (const language of ['en', 'zh']) {
        locale.register(
          namespace,
          language,
          Object.fromEntries(Object.entries(dictionary).map(([key, translations]) => [key, translations[language]]))
        )
      }
    }
    await ctx.plugin(plugin.exports).await()
    for (const language of ['en', 'ko', 'zh']) {
      locale.setLocale(language)
      for (const [namespace, dictionary] of Object.entries(releaseLocale.namespaces)) {
        const t = locale.bind(namespace)
        for (const [key, translations] of Object.entries(dictionary)) {
          const text = language === 'ko' ? ko[namespace][key] : translations[language]
          const params = Object.fromEntries([...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, `값-${name}`]))
          const expected = text.replace(/\{(\w+)\}/g, (_, name) => params[name])
          assert.equal(t(key, params), expected, `${language}:${namespace}.${key}`)
        }
      }
    }
  } finally {
    await ctx.fiber.dispose()
  }
})

await test('공식 플러그인 메타데이터는 번역되고 명시적 텍스트를 유지하며 플러그인과 함께 언로드된다', async () => {
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
    assert.equal(locale.resolveText({ en: 'Action cards', zh: '操作卡片' }), '작업 카드')
    assert.equal(locale.resolveText({ en: 'File actions', zh: '文件操作' }), '파일 작업')
    assert.equal(locale.resolveText({ en: 'Agent teams', zh: '智能体团队' }), '에이전트 팀')
    for (const en of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      assert.equal(locale.resolveText({ en }), en)
      assert.equal(locale.resolveText({ en, ko: '명시적 번역' }), '명시적 번역')
    }
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
