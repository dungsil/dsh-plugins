import assert from 'node:assert/strict'
import test from 'node:test'
import { createDelivery, rootOf } from '../src/deliver.ts'
import { DEFAULT_PREFERENCES } from '../src/preferences.ts'
import { copy } from '../src/copy.ts'

function setup({ preferences = {}, permission = 'granted', viewing = [], byId } = {}) {
  const created = []
  const sounds = []
  const opened = []
  const delivery = createDelivery({
    preferences: () => ({ ...DEFAULT_PREFERENCES, desktop: true, ...preferences }),
    notifications: () =>
      permission === undefined
        ? undefined
        : {
            permission,
            create(title, options) {
              const notification = {
                title,
                options,
                closed: false,
                onclick: null,
                close: () => (notification.closed = true),
              }
              created.push(notification)
              return notification
            },
          },
    playSound: async (volume) => {
      sounds.push(volume)
      return true
    },
    byId: () =>
      byId ?? {
        root: { cwd: '/home/me/projects/secret-app' },
        child: { parentId: 'root', cwd: '/elsewhere' },
      },
    isViewing: (id) => viewing.includes(id),
    text: () => ({
      title: (kind) => copy.en[`title.${kind}`],
      body: (workspace) => (workspace ? `Workspace: ${workspace}` : copy.en.bodyGeneric),
      lang: 'en',
    }),
    open: (id) => opened.push(id),
  })
  return { delivery, created, sounds, opened }
}

await test('알림 문구에는 이벤트 종류와 작업 공간 폴더 이름만 들어간다', () => {
  const { delivery, created } = setup()
  delivery.deliver({ key: 'k', kind: 'approval', sessionId: 'root' })
  assert.equal(created[0].title, 'Approval needed')
  assert.equal(created[0].options.body, 'Workspace: secret-app')
  assert.equal(created[0].options.tag, 'k')
})

await test('알림을 클릭하면 이벤트가 발생한 세션을 열고 알림을 닫는다', () => {
  const { delivery, created, opened } = setup()
  delivery.deliver({ key: 'k', kind: 'completed', sessionId: 'child' })
  let prevented = false
  created[0].onclick({ preventDefault: () => (prevented = true) })
  assert.deepEqual(opened, ['child'])
  assert.equal(created[0].closed, true)
  assert.equal(prevented, true)
})

await test('서브에이전트 이벤트는 최상위 세션의 음소거를 따른다', () => {
  const { delivery, created, sounds } = setup({ preferences: { muted: ['root'] } })
  delivery.deliver({ key: 'k', kind: 'question', sessionId: 'child' })
  assert.deepEqual(created, [])
  assert.deepEqual(sounds, [])
})

await test('권한이 거부되면 브라우저 알림 없이 소리만 재생한다', () => {
  const { delivery, created, sounds } = setup({ permission: 'denied' })
  delivery.deliver({ key: 'k', kind: 'approval', sessionId: 'root' })
  assert.deepEqual(created, [])
  assert.deepEqual(sounds, ['medium'])
})

await test('소리를 끄면 알림만 표시하고 꺼진 이벤트 종류는 아무것도 하지 않는다', () => {
  const { delivery, created, sounds } = setup({
    preferences: { sound: false, events: { ...DEFAULT_PREFERENCES.events, completed: false } },
  })
  delivery.deliver({ key: 'a', kind: 'approval', sessionId: 'root' })
  delivery.deliver({ key: 'c', kind: 'completed', sessionId: 'root' })
  assert.equal(created.length, 1)
  assert.deepEqual(sounds, [])
})

await test('다른 탭을 포함해 사용자가 보고 있는 세션은 알리지 않는다', () => {
  const { delivery, created, sounds } = setup({ viewing: ['root'] })
  delivery.deliver({ key: 'k', kind: 'completed', sessionId: 'child' })
  assert.deepEqual(created, [])
  assert.deepEqual(sounds, [])
})

await test('알림 생성이 실패해도 예외를 던지지 않는다', () => {
  const { delivery } = setup()
  const broken = createDelivery({
    preferences: () => ({ ...DEFAULT_PREFERENCES, desktop: true, sound: false }),
    notifications: () => ({
      permission: 'granted',
      create() {
        throw new TypeError('Illegal constructor')
      },
    }),
    playSound: async () => true,
    byId: () => ({}),
    isViewing: () => false,
    text: () => ({ title: () => 't', body: () => 'b', lang: 'en' }),
    open: () => {},
  })
  assert.doesNotThrow(() => broken.deliver({ key: 'k', kind: 'approval', sessionId: 'x' }))
  delivery.dispose()
})

await test('거둔 요청의 알림은 닫는다', () => {
  const { delivery, created } = setup()
  delivery.deliver({ key: 'k', kind: 'approval', sessionId: 'root' })
  delivery.withdraw('k')
  assert.equal(created[0].closed, true)
})

await test('부모 순환이 있어도 최상위 세션 탐색이 끝난다', () => {
  assert.ok(['a', 'b'].includes(rootOf({ a: { parentId: 'b' }, b: { parentId: 'a' } }, 'a')))
  assert.equal(rootOf({ c: { parentId: 'p' }, p: { parentId: 'r' }, r: {} }, 'c'), 'r')
  assert.equal(rootOf({ a: { parentId: 'gone' } }, 'a'), 'a')
})

await test('AudioContext를 만들 수 없으면 unlock은 예외를 던지지 않고 play는 false를 반환한다', async () => {
  const { createChime } = await import('../src/sound.ts')
  const chime = createChime(() => {
    throw new Error('unsupported')
  })
  assert.doesNotThrow(() => chime.unlock())
  assert.equal(await chime.play('medium'), false)
})
