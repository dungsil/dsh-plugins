import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { clientConfig } from '@dungsil/dsh-tsdown'
import { build } from 'tsdown'

await test('client bundles retain only the UI exports they use', async (t) => {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(cwd, '.treeshaking-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const Button = () => null
  const cases = [
    {
      name: 'a primitive does not pull in settings or React',
      source: "export { Button } from '@dungsil/dsh-ui'",
      modules: { '@deepseek-ai/dsh-client-ui-primitives': { Button } },
      check: (exports) => assert.equal(exports.Button, Button),
    },
    {
      name: 'composer styles do not initialize the unused trigger',
      source: "export { composerStyles } from '@dungsil/dsh-ui/composer'",
      modules: { react: {}, 'react/jsx-runtime': {} },
      check: (exports) => assert.match(exports.composerStyles, /\.dsh-plugin-composer-trigger/),
    },
    {
      name: 'an SVG does not pull in React or upstream icons',
      source: "export { modelSettingsIconSvg } from '@dungsil/dsh-ui/icons'",
      modules: {},
      check: (exports) => assert.match(exports.modelSettingsIconSvg, /^<svg /),
    },
    {
      name: 'a DOM helper does not pull in SVG assets',
      source: "export { createIconGlyph } from '@dungsil/dsh-ui/icons/dom'",
      modules: {},
      check: (exports, code) => {
        assert.equal(typeof exports.createIconGlyph, 'function')
        assert.doesNotMatch(code, /<svg /)
      },
    },
    {
      name: 'a used composer trigger keeps its render function and forwarded ref',
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
