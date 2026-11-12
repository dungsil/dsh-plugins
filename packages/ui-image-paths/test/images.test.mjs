import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { Session } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as host from '../dist/index.js'

const key = 'dungsil.imageDirectories'

await test('이전 세션과 fork의 전체 디렉터리 이력을 복원하고 세션 목록에는 보내지 않는다', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  await ctx.plugin(SessionProjections)
  const session = Session.create('image-history', [], {
    id: 'image-history',
    version: 4,
    createdAt: 1,
    cwd: '/project',
    isSeeded: false,
  })
  session.append('working-directory/change', { cwd: '/project/worktree-a' })
  session.append('working-directory/change', { cwd: '/project/worktree-b' })
  const fork = ctx.plugin(host)
  await fork
  const expected = [
    { seq: -1, cwd: '/project' },
    { seq: 1, cwd: '/project/worktree-a' },
    { seq: 2, cwd: '/project/worktree-b' },
  ]
  assert.deepEqual(ctx.sessionProjections.snapshot(session).values[key], expected)
  assert.equal(ctx.sessionProjections.summaryKeys().has(key), false)
  const child = Session.create(
    'image-child',
    session.snapshotEvents(),
    {
      id: 'image-child',
      version: 4,
      createdAt: 2,
      cwd: '/project',
      isSeeded: true,
    },
    session.seq
  )
  assert.deepEqual(ctx.sessionProjections.snapshot(child).values[key], expected)
  await fork.dispose()
  assert.equal(ctx.sessionProjections.snapshot(session).values[key], undefined)
  await ctx.plugin(host)
  assert.deepEqual(ctx.sessionProjections.snapshot(session).values[key], expected)
})

await test('flow에서 메시지별 이미지 경로를 보정하고 원래 렌더러와 해제 동작을 유지한다', async () => {
  const core = new SlotCore()
  const delegateContext = React.createContext({})
  const primitives = {
    MarkdownDelegateProvider: ({ children, ...value }) =>
      React.createElement(delegateContext.Provider, { value }, children),
    useMarkdownDelegate: () => React.useContext(delegateContext),
  }
  let plugin, disposePlugin
  const require = createRequire(import.meta.url)
  runInNewContext(await readFile(new URL('../dist/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          plugin = factory((id) => (id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(id)))
        },
      },
    },
  })
  const disposeRoot = core.register(
    {
      name: 'root',
      children: {
        'conversation.chat.flow': { kind: 'single', scope: 'session' },
      },
    },
    () => null
  )
  const nativeFlow = ({ entries, renderSlot }) =>
    entries.map((node) =>
      React.createElement(
        React.Fragment,
        { key: node.anchorSeq },
        renderSlot('conversation.chat.node', { node }, { entryKey: 'assistant-step', hookContext: node })
      )
    )
  const disposeFlow = core.register(
    {
      name: 'conversation.chat.flow',
      children: {
        'conversation.chat.node': { kind: 'keyed', scope: 'session' },
      },
    },
    nativeFlow
  )
  const nativeNode = ({ node }) => {
    const delegate = React.useContext(delegateContext)
    assert.equal(delegate.openFile, openFile)
    assert.equal(delegate.openExternalLink, openExternalLink)
    assert.equal(delegate.getTriggerProps({ kind: 'file', path: 'README.md' }).path, 'README.md')
    assert.equal(delegate.getTriggerProps({ kind: 'url', url: 'https://example.com' }).url, 'https://example.com')
    return React.createElement('img', {
      src: delegate.fileImages.resolve(node.path),
      'data-resource': delegate.fileImages.resourceAddress(node.path),
      'data-menu-path': delegate.getTriggerProps({ kind: 'image', path: node.path }).path,
    })
  }
  const disposeNode = core.register({ name: 'conversation.chat.node', key: 'assistant-step' }, nativeNode)
  const openFile = () => {}
  const openExternalLink = () => {}
  const getTriggerProps = (target) => target
  const delegate = {
    openFile,
    openExternalLink,
    getTriggerProps,
    fileImages: {
      resolve: (path) =>
        path.startsWith('/') || path.includes(':') || path.startsWith('\\') ? path : `/project/${path}`,
      resourceAddress: (path) => `resource:${path}`,
      labels: { failed: 'native error' },
    },
  }
  const timeline = [
    { seq: -1, cwd: '/project' },
    { seq: 10, cwd: '/worktree-a' },
    { seq: 20, cwd: 'C:\\worktree-b' },
  ]
  const render = (entries, directories = timeline) =>
    renderToStaticMarkup(
      React.createElement(
        delegateContext.Provider,
        { value: delegate },
        React.createElement(core.entriesOfSlot('conversation.chat.flow')[0].component, {
          entries,
          useProjection: () => directories,
          renderSlot: (_slot, owner, options) => {
            assert.equal(options.hookContext, owner.node)
            return React.createElement(nativeNode, owner)
          },
        })
      )
    )
  const rows = [9, 10, 19, 20].map((anchorSeq) => ({ anchorSeq, path: 'same.png' }))
  const before = render(rows)
  plugin.apply({
    slots: {
      inject: (_slot, setup) => {
        disposePlugin = setup()
      },
      entries: (slot) => core.entries(slot),
      subscribe: (slot, fn) => core.subscribe(slot, fn),
      register: (options, component) => core.register(options, component),
    },
  })
  await new Promise((resolve) => queueMicrotask(resolve))
  const after = render(rows)
  assert.notEqual(before, after)
  assert.match(after, /src="\/project\/same.png"/)
  assert.equal((after.match(/src="\/worktree-a\/same.png"/g) ?? []).length, 2)
  assert.match(after, /src="C:\\worktree-b\/same.png"/)
  assert.match(after, /data-resource="resource:\/worktree-a\/same.png"/)
  assert.match(after, /data-menu-path="\/worktree-a\/same.png"/)
  for (const path of [
    '/absolute.png',
    'D:\\absolute.png',
    '\\\\server\\share\\image.png',
    'https://example.com/a.png',
    'data:image/png;base64,a',
  ]) {
    assert.equal(render([{ anchorSeq: 20, path }]), render([{ anchorSeq: 9, path }]))
  }
  assert.equal(render(rows, null), before)
  assert.equal(render(rows, []), before)
  assert.equal(core.entriesOfSlot('conversation.chat.node')[0].component, nativeNode)
  disposePlugin()
  assert.equal(render(rows), before)
  assert.equal(core.entriesOfSlot('conversation.chat.flow')[0].component, nativeFlow)
  disposeNode()
  disposeFlow()
  disposeRoot()
})
