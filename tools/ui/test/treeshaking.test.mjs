import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { clientConfig } from '@dungsil/dsh-tsdown'
import { build } from 'tsdown'

await test('클라이언트 번들은 사용하는 UI 내보내기만 유지한다', async (t) => {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(cwd, '.treeshaking-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const Button = () => null
  const cases = [
    {
      name: '프리미티브는 설정이나 React를 끌어오지 않는다',
      source: "export { Button } from '@dungsil/dsh-ui'",
      modules: { '@deepseek-ai/dsh-client-ui-primitives': { Button } },
      check: (exports) => assert.equal(exports.Button, Button),
    },
    {
      name: '작성기 스타일은 사용하지 않는 트리거를 초기화하지 않는다',
      source: "export { composerStyles } from '@dungsil/dsh-ui/composer'",
      modules: { react: {}, 'react/jsx-runtime': {} },
      check: (exports) => assert.match(exports.composerStyles, /\.dsh-plugin-composer-trigger/),
    },
    {
      name: 'SVG는 React나 업스트림 아이콘을 끌어오지 않는다',
      source: "export { modelSettingsIconSvg } from '@dungsil/dsh-ui/icons'",
      modules: {},
      check: (exports) => assert.match(exports.modelSettingsIconSvg, /^<svg /),
    },
    {
      name: 'DOM 헬퍼는 SVG 자산을 끌어오지 않는다',
      source: "export { createIconGlyph } from '@dungsil/dsh-ui/icons/dom'",
      modules: {},
      check: (exports, code) => {
        assert.equal(typeof exports.createIconGlyph, 'function')
        assert.doesNotMatch(code, /<svg /)
      },
    },
    {
      name: '사용되는 작성기 트리거는 렌더 함수와 전달된 ref를 유지한다',
      source: "export { ComposerTrigger } from '@dungsil/dsh-ui/composer'",
      modules: {
        react: { forwardRef: (render) => render },
        'react/jsx-runtime': {
          jsx: (type, props) => ({ type, props }),
          jsxs: (type, props) => ({ type, props }),
        },
        '@deepseek-ai/dsh-client-ui-primitives': { IconChevronDownOutlineRegular: () => null },
      },
      check: (exports, code) => {
        const ref = { current: null }
        const element = exports.ComposerTrigger({ icon: 'icon', label: 'label', disabled: true }, ref)
        assert.equal(element.type, 'button')
        assert.equal(element.props.ref, ref)
        assert.equal(element.props.disabled, true)
        assert.equal(element.props.children[1].props.children, 'label')
        assert.doesNotMatch(code, /:where\(\.dsh-plugin-composer-trigger\)/)
      },
    },
  ]

  for (const { name, source, modules, check } of cases) {
    await t.test(name, async () => {
      const entry = join(directory, 'entry.ts')
      await writeFile(entry, source)
      await build({
        ...clientConfig('@dungsil/dsh-ui-test', {
          entry: [entry],
          deps: {
            alwaysBundle: ['@dungsil/dsh-ui'],
            neverBundle: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
          },
        }),
        cwd,
        config: false,
        outDir: join(directory, 'dist'),
        logLevel: 'error',
      })
      const code = await readFile(join(directory, 'dist/entry.js'), 'utf8')
      let exports
      runInNewContext(code, {
        window: {
          __ModuleLoader__: {
            load: ({ factory }) => {
              exports = factory((id) => {
                assert.ok(Object.hasOwn(modules, id), `Unexpected runtime dependency: ${id}`)
                return modules[id]
              })
            },
          },
        },
      })
      check(exports, code)
    })
  }
})
