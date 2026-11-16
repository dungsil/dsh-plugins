import assert from 'node:assert/strict'
import test from 'node:test'
import { dictionaries } from '../src/locale.ts'

await test('모든 언어가 같은 UI 키와 비어 있지 않은 문구를 제공한다', () => {
  const keys = Object.keys(dictionaries.en).sort()
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys, language)
    for (const key of keys)
      assert.ok(typeof dictionary[key] === 'string' && dictionary[key].trim(), `${language}: ${key}`)
  }
})
