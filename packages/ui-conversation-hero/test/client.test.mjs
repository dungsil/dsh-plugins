import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

async function load() {
  const content = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')
  let module
  let entryId
  const imports = []
  const createElement = (type, props, ...children) => ({ type, props, children })
  runInNewContext(content, {
    window: {
      __ModuleLoader__: {
        load(entry) {
          entryId = entry.id
          module = entry.factory((name) => {
            imports.push(name)
            if (name !== 'react') throw new Error('Unexpected client module')
            return { createElement }
          })
        },
      },
    },
  })
  return { module, entryId, imports }
}

await test('클라이언트 번들은 React를 외부 로더에서 가져오고 공식 슬롯만 사용한다', async () => {
  const { module, entryId, imports } = await load()
  assert.equal(entryId, packageInfo.name)
  assert.deepEqual(imports, ['react'])
  assert.deepEqual([...module.inject], ['slots'])
})

await test('공식 슬롯이 준비되었을 때 프레임을 등록하고 해제한다', async () => {
  const { module } = await load()
  let register
  let released = false
  let slotName
  let options
  let Frame
  module.apply({
    slots: {
      inject(name, mount) {
        slotName = name
        register = mount
      },
      register(entry, component) {
        options = entry
        Frame = component
        return () => {
          released = true
        }
      },
    },
  })
  assert.equal(slotName, 'conversation.hero.frame')
  assert.equal(Frame, undefined)
  const unmount = register()
  assert.equal(options.id, 'dungsil-centered-hero')
  assert.equal(options.name, 'conversation.hero.frame')
  assert.equal(typeof Frame, 'function')
  unmount()
  assert.equal(released, true)
})

await test('새 대화에서만 카드 너비를 제한하고 입력창과 스크롤 본문을 재생성하지 않는다', async () => {
  const { module } = await load()
  let Frame
  module.apply({
    slots: {
      inject(_name, mount) {
        mount()
      },
      register(_entry, component) {
        Frame = component
        return () => {}
      },
    },
  })
  const body = { type: 'scroll-body', props: { draft: '작성 중' } }
  const hero = Frame({ hero: true, children: body })
  const active = Frame({ hero: false, children: body })
  assert.equal(hero.type, 'div')
  assert.equal(active.type, hero.type)
  assert.equal(hero.children[0], body)
  assert.equal(active.children[0], body)
  assert.equal(hero.props.style.display, 'contents')
  assert.equal(active.props.style.display, 'contents')
  assert.equal(hero.props.style['--dsh-composer-card-max-width'], '752px')
  assert.equal(active.props.style['--dsh-composer-card-max-width'], undefined)
  assert.equal(hero.props['data-dungsil-conversation-hero-frame'], '')
  assert.equal(active.props['data-dungsil-conversation-hero-frame'], undefined)
})

await test('영어 한국어 중국어 메타데이터를 제공한다', async () => {
  for (const language of ['en', 'ko', 'zh']) {
    const locale = JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    assert.equal(locale.meta.title, packageInfo.market.title[language])
    assert.equal(locale.meta.description, packageInfo.market.description[language])
    assert.ok(locale.meta.title.trim())
    assert.ok(locale.meta.description.trim())
  }
})
