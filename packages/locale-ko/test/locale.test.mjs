import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import semver from 'semver'
import en from './en.json' with { type: 'json' }
import ko from '../src/ko.json' with { type: 'json' }
import manifest from '../package.json' with { type: 'json' }

function loadClient(source, languages = ['en-US']) {
  let loaded
  runInNewContext(source, {
    navigator: { languages },
    window: {
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

test('installation allows DSH 0.2 updates from rc.2 without opting into the next minor', () => {
  for (const version of ['0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.4', '0.2.1', '0.2.2-rc.1', '0.2.2', '0.2.99']) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), true, version)
  }
  for (const version of ['0.2.0', '0.2.1-rc.1', '0.3.0-rc.1', '0.3.0', '1.0.0']) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, { includePrerelease: true }), false, version)
  }
})

test('all supported namespaces preserve upstream keys and placeholders', () => {
  assert.deepEqual(Object.keys(ko).sort(), Object.keys(en).sort())
  let count = 0
  for (const [namespace, dictionary] of Object.entries(en)) {
    assert.deepEqual(Object.keys(ko[namespace]).sort(), Object.keys(dictionary).sort(), namespace)
    for (const [key, original] of Object.entries(dictionary)) {
      const translated = ko[namespace][key]
      assert.equal(typeof translated, 'string')
      if (original.trim()) assert.ok(translated.trim(), `${namespace}.${key} is empty`)
      else assert.equal(translated, original, `${namespace}.${key} is an intentional empty prefix`)
      assert.doesNotMatch(translated, /[\u200b\ufeff]/u)
      const placeholders = (text) =>
        [...text.matchAll(/\{\w+\}/g)].map(([value]) => value).sort((left, right) => left.localeCompare(right))
      assert.deepEqual(placeholders(translated), placeholders(original), `${namespace}.${key}`)
      count++
    }
  }
  console.log(`Verified ${count} translations in ${Object.keys(ko).length} namespaces`)
})

test('built plugin translates, falls back, unloads and reloads through real Cordis and LocaleRuntime', async () => {
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
    assert.equal(locale.bind('conversation')('image.remove', { name: '도면.png' }), '이미지 도면.png 삭제')
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

test('ko-KR browser selects Korean, while an explicit English preference stays English', async () => {
  const { LocaleRuntime } = loadClient(upstreamSource, ['ko-KR', 'en-US']).exports
  for (const explicitEnglish of [false, true]) {
    const ctx = new Context()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    if (explicitEnglish) locale.setLocale('en')
    try {
      await ctx.plugin(plugin.exports).await()
      assert.equal(locale.getLocale().active, explicitEnglish ? 'en' : 'ko')
    } finally {
      await ctx.fiber.dispose()
    }
  }
})
