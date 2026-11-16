import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

await test('메뉴 아이콘 슬롯은 기본 아이콘을 등록하고 해제한다', async () => {
  const source = stripTypeScriptTypes(await readFile(new URL('../src/snooze-icons.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '')
  const clock = () => null
  const play = () => null
  const context = { IconClockOutlineRegular: clock, IconPlayOutlineRegular: play }
  runInNewContext(`${source}\nglobalThis.installSnoozeIcons = installSnoozeIcons`, context)
  const registered = new Map()
  let disposers = []
  const slots = {
    inject(name, callback) {
      assert.equal(name, 'contextMenu.icon')
      disposers = [...callback()]
    },
    register(options, icon) {
      assert.equal(options.name, 'contextMenu.icon')
      registered.set(options.key, icon)
      return () => registered.delete(options.key)
    },
  }
  context.installSnoozeIcons(slots)
  assert.equal(registered.get('sidebar-inbox.snooze'), clock)
  assert.equal(registered.get('sidebar-inbox.wake'), play)
  for (const dispose of disposers) dispose()
  assert.equal(registered.size, 0)
})
