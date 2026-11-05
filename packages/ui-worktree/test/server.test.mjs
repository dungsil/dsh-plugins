import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { Session, SessionId, pluginRecordOf } from '@deepseek-ai/dsh-session'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import * as ModelSettings from '@dungsil/dsh-plugin-model-settings'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }
const gitPath = (path) => (process.platform === 'win32' ? path.replaceAll('\\', '/') : path)

async function fixture(t, options = {}, settings = {}, taskModels) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-worktree-')))
  const repo = join(home, 'source')
  const other = join(home, process.platform === 'win32' ? 'existing space 한글' : 'existing space\n한글')
  let ctx
  t.after(async () => {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  await mkdir(repo)
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  git('init', '-b', 'main')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial')
  git('worktree', 'add', '--detach', other)
  await writeFile(join(repo, 'draft.txt'), 'unsaved source file')
  const dir = join(home, 'profiles/web')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules/test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}')
  await writeFile(
    join(bundle, 'package.json'),
    JSON.stringify({
      name: 'test-bundle',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
  )
  await writeFile(
    join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'editor', name: 'cordis:editor' },
          { id: 'worktree-ui', name: '@dungsil/dsh-plugin-ui-worktree', config: settings },
          ...(taskModels
            ? [{ id: 'task-models', name: '@dungsil/dsh-plugin-model-settings', config: taskModels }]
            : []),
        ],
      },
    ])
  )
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile = {
    name: 'web',
    startedBundles: ['test-bundle'],
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    cwd: repo,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  let agent, harness
  const requests = []
  const inspections = new Map()
  const resolutions = []
  ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
    root.provide('profileContext', profile)
    root.loader.builtins.editor = ConfigEditor
    root.loader.internal = {
      version: 'v2',
      import: async (specifier) => {
        if (specifier === '@dungsil/dsh-plugin-model-settings') return ModelSettings
        assert.equal(specifier, '@dungsil/dsh-plugin-ui-worktree')
        return plugin
      },
    }
    await mountAgentLoopTestDependencies(root, { workingDirectory: true })
    await root.plugin(Storage)
    await root.plugin(StorageJson, { root: join(home, 'storage') })
    await root.plugin(StorageDomain, { backend: 'json' })
    await root.plugin(SessionPersistenceJsonl, { root: join(home, 'sessions') })
    await root.plugin(WorkspaceRegistry)
    await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
    await root.plugin(Connection)
    await root.plugin(SubprocessLocal)
    await root.plugin(SandboxLocal)
    await root.plugin(SandboxPolicy, { mode: 'danger-full-access' })
    harness = await mountAgentLoopTestHarness(root)
    class WorkAdapter extends LlmAdapter {
      async resolveModel(provider, model) {
        return { provider, id: model, name: model }
      }
      async *stream(request) {
        requests.push({ ...request, cwd: root.workingDirectory.get(agent.session) })
        yield { type: 'text-delta', index: 0, text: 'Finished' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    root.llm.registerAdapter(['test'], new WorkAdapter())
    agent = await harness.create(
      SessionId('worktree-ui-test'),
      { provider: 'test', model: 'test-model', ...options },
      { cwd: repo }
    )
    root.provide('sessionController', {
      resolveAgent: async (id) => {
        resolutions.push(id)
        return id === agent.id ? { agent } : { error: { code: 'session/not-found', message: 'Missing' } }
      },
      inspect: async (id) => {
        const inspection = inspections.get(id)
        if (!inspection) throw { code: 'session/not-found' }
        return inspection
      },
    })
  })
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (endpoint, payload = {}, peer = owner, signal) => {
    const method = endpoint.includes('/') ? endpoint : `dungsil-worktree/${endpoint}`
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method,
          payload: { sessionId: agent.id, ...payload },
        }),
      }),
      peer
    )
    if (response.status !== 200) return { status: response.status }
    return (await response.json()).result
  }
  const submit = async (text = 'Implement the current task') => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await agent.whenIdle()
  }
  let sessionNumber = 0
  const freshSession = async () => {
    const config = agent.session.requestHeader()?.config
    agent = await harness.create(
      SessionId(`worktree-ui-test-${++sessionNumber}`),
      { provider: 'test', model: 'test-model', ...options },
      { cwd: repo }
    )
    if (config) {
      agent.session.append('request/header', { header: { config }, reason: 'initial' })
      installModelSelection(agent.ctx, { current: config })
    }
    return agent
  }
  const archive = async () => {
    const maintenance = agent.runMaintenance.bind(agent)
    let cleanup
    agent.runMaintenance = (...args) => (cleanup = maintenance(...args))
    try {
      await ctx.workspaceRegistry.archiveSession(agent.id)
      await new Promise((resolve) => setImmediate(resolve))
      // Cleanup failures are intentionally contained by the archive observer.
      // The assertions below check the resulting Git state, not its promise.
      await cleanup?.catch(() => {})
    } finally {
      agent.runMaintenance = maintenance
    }
  }
  const holdDescribeChildren = () => {
    const subprocess = ctx.subprocess
    const spawn = subprocess.spawn.bind(subprocess)
    const handles = []
    let changed = Promise.withResolvers()
    let active = 0
    let maximum = 0
    let released = false
    const releaseAll = () => {
      released = true
      for (const handle of handles) handle.exit.resolve()
    }
    subprocess.spawn = (spec) => {
      const child = spawn(spec)
      if (!spec.argv.includes('worktree') || !spec.argv.includes('--porcelain')) return child
      active++
      maximum = Math.max(maximum, active)
      const handle = { spec, waiting: Promise.withResolvers(), exit: Promise.withResolvers() }
      handles.push(handle)
      if (released) handle.exit.resolve()
      changed.resolve()
      changed = Promise.withResolvers()
      return {
        ...child,
        done: child.done,
        collected: child.collected,
        terminate: () => child.terminate(),
        async waitForExit() {
          const exited = await child.waitForExit()
          handle.waiting.resolve()
          await handle.exit.promise
          active--
          return exited
        },
      }
    }
    t.after(() => {
      releaseAll()
      subprocess.spawn = spawn
    })
    return {
      handles,
      releaseAll,
      get active() {
        return active
      },
      get maximum() {
        return maximum
      },
      async waitForCount(count) {
        while (handles.length < count) await changed.promise
        await Promise.all(handles.slice(0, count).map((handle) => handle.waiting.promise))
      },
    }
  }
  return {
    ctx,
    agent,
    repo,
    other,
    git,
    rpc,
    home,
    profile,
    requests,
    submit,
    freshSession,
    harness,
    archive,
    inspections,
    resolutions,
    holdDescribeChildren,
  }
}

await test('부작용 없이 예약하고 프롬프트 작업 전에 생성하며 작업 시작 후 선택 변경을 거부한다', async (t) => {
  const { ctx, agent, repo, other, git, rpc, requests, submit } = await fixture(t)
  const progress = []
  ctx.on('session/event', (session, event) => {
    const record = pluginRecordOf(event)
    if (session === agent.session && record?.type === 'plugin:dungsil/ui-worktree/progress') progress.push(event)
  })
  agent.inject(
    createUserMessage({
      content: [{ type: 'text', text: 'The approval policy changed from "ask" to "never" (changed by the user).' }],
      source: { kind: 'user-approval' },
    })
  )
  const initial = await rpc('describe')
  assert.equal(initial.ok, true)
  assert.deepEqual(initial.value, {
    cwd: repo,
    needsInitialization: true,
    worktrees: [
      { path: gitPath(repo), branch: 'main' },
      { path: gitPath(other), branch: null },
    ],
  })
  const otherPath = initial.value.worktrees.find((entry) => entry.branch === null).path
  const reserved = await rpc('create', { cwd: repo, name: 'fix/login-ui' })
  assert.equal(reserved.ok, true)
  assert.deepEqual(reserved.value, {
    cwd: repo,
    worktrees: initial.value.worktrees,
    pendingCreation: { name: 'fix/login-ui', failed: false },
  })
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.equal(requests.length, 0, 'reserving must not call a model')
  assert.equal(progress.length, 0, 'reserving must not display setup as started')
  assert.equal(git('branch', '--list', 'fix/login-ui'), '', 'reserving must not create a branch')
  assert.deepEqual((await rpc('describe')).value, reserved.value, 'reloading must retain the reservation')
  await submit('Fix the login UI')
  const created = await rpc('describe')
  assert.equal(created.ok, true)
  assert.equal(created.value.pendingCreation, undefined)
  const path = join(repo, '.agents/worktrees/fix/login-ui')
  assert.equal(created.value.cwd, path)
  assert.ok(created.value.worktrees.some((entry) => entry.path === gitPath(path) && entry.branch === 'fix/login-ui'))
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  assert.deepEqual([...new Set(progress.map((event) => event.data.step))], [0, 1, 2, 3])
  assert.equal(progress.at(-1).data.status, 'completed')
  assert.equal(progress.at(-1).data.branch, 'fix/login-ui')
  assert.ok(
    progress.slice(0, -1).every((event) => event.data.branch === undefined),
    'hide names until setup completes'
  )
  assert.ok(
    progress.every((event) => event.ignorable === true),
    'progress must be safe for readers without the plugin'
  )
  const restored = Session.create(agent.session.id, agent.session.snapshotEvents())
  assert.deepEqual(
    restored.deriveMessages(),
    agent.session.deriveMessages(),
    'progress must not alter replayed model history'
  )
  assert.ok(requests.length > 0)
  assert.ok(
    requests.every((request) => request.cwd === path),
    'all work calls must run in the new checkout'
  )
  assert.deepEqual(
    agent.session
      .deriveMessages()
      .filter((message) => message.source.kind === 'user')
      .map((message) => message.content),
    [[{ type: 'text', text: 'Fix the login UI' }]],
    'creation must not add a user message or rewrite the submitted task'
  )
  assert.ok(
    requests[0].messages.some((message) =>
      message.content.some(
        (block) => block.type === 'text' && block.text.includes(`Current working directory: ${JSON.stringify(path)}`)
      )
    ),
    'the first work call must see the new directory in model context'
  )
  assert.equal(git('rev-parse', 'refs/heads/fix/login-ui'), git('rev-parse', 'HEAD'))
  assert.equal(await readFile(join(repo, 'draft.txt'), 'utf8'), 'unsaved source file')
  await assert.rejects(readFile(join(path, 'draft.txt')), { code: 'ENOENT' })
  await submit('Add a regression test for the fix')
  assert.equal(ctx.workingDirectory.get(agent.session), path, 'follow-ups stay in the same checkout and session')
  assert.equal((await rpc('describe')).value.worktrees.length, 3, 'follow-ups must not create another worktree')

  const before = agent.session.snapshotEvents()
  const count = requests.length
  assert.equal(created.value.locked, true)
  assert.equal((await rpc('switch', { cwd: path, path: otherPath })).status, 404)
  assert.equal((await rpc('create', { cwd: path, name: 'must-not-create' })).error.code, 'conflict')
  assert.equal((await rpc('cancel', { cwd: path })).error.code, 'conflict')
  assert.deepEqual(agent.session.snapshotEvents(), before)
  assert.equal(requests.length, count)
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  const events = agent.session.snapshotEvents()
  assert.ok(events.some((event) => event.type === 'user/message'))
  assert.equal(events.filter((event) => event.type === 'working-directory/change').length, 1)
})

await test('새 워크트리 기본값은 부작용 없이 한 번 예약하고 프로필을 다시 불러와도 취소를 존중한다', async (t) => {
  const { agent, repo, git, rpc, requests, profile, submit } = await fixture(t, {}, { defaultSelection: 'new' })
  const before = agent.session.snapshotEvents()
  const lookup = await rpc('describe')
  assert.equal(lookup.ok, true)
  assert.equal(lookup.value.needsInitialization, true)
  assert.equal(lookup.value.pendingCreation, undefined, 'A read must not reserve a default worktree')
  assert.deepEqual(agent.session.snapshotEvents(), before, 'A read must not persist selection initialization')
  const initial = await rpc('initialize', { cwd: repo })
  assert.equal(initial.ok, true)
  assert.equal(initial.value.needsInitialization, undefined)
  assert.deepEqual(initial.value.pendingCreation, { name: '', failed: false })
  assert.equal(initial.value.cwd, repo)
  assert.equal(initial.value.worktrees.length, 2)
  assert.equal(requests.length, 0)
  const initializedEvents = agent.session.snapshotEvents()
  assert.deepEqual((await rpc('describe')).value, initial.value)
  assert.deepEqual((await rpc('initialize', { cwd: repo })).value, initial.value)
  assert.deepEqual(agent.session.snapshotEvents(), initializedEvents, 'Initialization must be idempotent')
  assert.equal((await rpc('cancel', { cwd: repo })).value.pendingCreation, undefined)
  const settings = (await rpc('settings')).value
  const saved = await rpc('save-settings', {
    ...settings,
    settings: { ...settings.settings, directory: '../different-pool' },
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.settings.defaultSelection, 'new')
  assert.match(await readFile(profile.patchPath, 'utf8'), /defaultSelection: new/)
  assert.equal((await rpc('describe')).value.pendingCreation, undefined, 'reload must not undo cancellation')
  await submit()
  assert.equal((await rpc('describe')).value.cwd, repo)
  assert.equal((await rpc('describe')).value.worktrees.length, 2)
  assert.equal(git('branch', '--list').split('\n').length, 1)
  const restored = Session.create(agent.session.id, agent.session.snapshotEvents())
  assert.deepEqual(restored.deriveMessages(), agent.session.deriveMessages(), 'selection is not model context')
})

await test('새 워크트리 기본값은 첫 프롬프트에서만 생성하며 기존 대화의 체크아웃을 대체하지 않는다', async (t) => {
  const { ctx, repo, rpc, submit } = await fixture(
    t,
    {},
    { defaultSelection: 'new', provider: 'naming', model: 'branch' }
  )
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream() {
      yield { type: 'text-delta', index: 0, text: 'feat/default-selection' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['naming'], new NamingAdapter())
  assert.equal((await rpc('initialize', { cwd: repo })).value.pendingCreation.failed, false)
  await submit('Implement default selection')
  const created = (await rpc('describe')).value
  assert.equal(created.cwd, join(repo, '.agents/worktrees/feat/default-selection'))
  assert.equal(created.worktrees.length, 3)
  assert.equal(created.pendingCreation, undefined)
  await submit('Continue in this checkout')
  assert.deepEqual((await rpc('describe')).value, created)

  const existing = await fixture(t)
  await existing.submit('An existing conversation')
  const view = (await existing.rpc('settings')).value
  assert.equal(
    (await existing.rpc('save-settings', { ...view, settings: { ...view.settings, defaultSelection: 'new' } })).ok,
    true
  )
  assert.equal((await existing.rpc('describe')).value.pendingCreation, undefined)
  assert.equal((await existing.rpc('describe')).value.cwd, existing.repo)
})

await test('예약은 세션에 한정되고 취소할 수 있으며 제출 전에 바뀐 소스 디렉터리를 거부한다', async (t) => {
  const { ctx, repo, other, git, rpc, requests, submit, harness, freshSession } = await fixture(t)
  assert.equal((await rpc('create', { cwd: repo, name: 'cancelled-task' })).ok, true)
  const unrelated = await harness.create(
    SessionId('another-session'),
    { provider: 'test', model: 'test-model' },
    { cwd: repo }
  )
  unrelated.followup(
    createUserMessage({ content: [{ type: 'text', text: 'Another session task' }], source: { kind: 'user' } })
  )
  await unrelated.whenIdle()
  assert.equal(git('branch', '--list', 'cancelled-task'), '', 'another session must not consume the reservation')
  assert.equal((await rpc('describe')).value.pendingCreation.name, 'cancelled-task')
  assert.equal((await rpc('cancel', { cwd: repo })).ok, true)
  await submit()
  assert.equal((await rpc('describe')).value.cwd, repo)
  assert.equal(git('branch', '--list', 'cancelled-task'), '', 'cancelling before submission must never create a branch')

  const agent = await freshSession()
  assert.equal((await rpc('create', { cwd: repo, name: 'stale-source' })).ok, true)
  await agent.runMaintenance((signal) => ctx.workingDirectory.set(agent, other, signal))
  const count = requests.length
  await submit()
  assert.equal(requests.length, count, 'a changed source must stop before either naming or work')
  assert.equal(git('branch', '--list', 'stale-source'), '')
  assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
})

await test('예약된 이름이 비어 있으면 이전 기록이 아니라 새로 제출된 프롬프트를 이름 짓기에만 사용한다', async (t) => {
  const { ctx, repo, git, rpc, submit, freshSession } = await fixture(t, {
    provider: 'fallback',
    model: 'fallback-model',
  })
  let agent = await freshSession()
  const requests = []
  let answer = 'fix/session-isolation'
  let reason = { kind: 'stop' }
  let namingStarted, namingGate
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream(options) {
      requests.push(options)
      const naming = options.system?.startsWith('Return only a short')
      if (naming) {
        namingStarted?.()
        await namingGate
      }
      yield { type: 'text-delta', index: 0, text: naming ? answer : 'Finished' }
      yield { type: 'finish', reason: naming ? reason : { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['conversation', 'fallback'], new NamingAdapter())
  const named = await rpc('create', { cwd: repo, name: ' manual-name ' })
  assert.equal(named.ok, true)
  assert.equal(requests.length, 0, 'a supplied name must not incur a model request')
  await submit()
  assert.ok(
    requests.every((request) => !request.system?.startsWith('Return only a short')),
    'a supplied name bypasses naming'
  )
  agent = await freshSession()
  requests.length = 0
  agent.session.append('request/header', {
    header: { config: { provider: 'conversation', model: 'selected-model' } },
    reason: 'initial',
  })
  assert.equal((await rpc('create', { cwd: repo, name: '  ' })).ok, true)
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'Earlier unrelated task' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' }
  )
  assert.equal(requests.length, 0, 'an empty name must wait for the submitted prompt too')
  const started = new Promise((resolve) => {
    namingStarted = resolve
  })
  let release
  namingGate = new Promise((resolve) => {
    release = resolve
  })
  const submitted = submit('Fix session isolation when switching worktrees')
  await started
  try {
    const duringCreation = await rpc('describe')
    assert.equal(duringCreation.ok, true, 'Naming and creation must not block a read')
    assert.equal(duringCreation.value.pendingCreation.failed, false, 'Active creation is not a failed reservation')
    assert.equal((await rpc('initialize', { cwd: repo })).error.code, 'busy')
    const settings = (await rpc('settings')).value
    assert.equal((await rpc('save-settings', settings)).error.code, 'busy', 'A read must not release the creation lock')
  } finally {
    release()
  }
  await submitted
  const generated = await rpc('describe')
  assert.equal(generated.ok, true)
  assert.equal(generated.value.cwd, join(repo, '.agents/worktrees/fix/session-isolation'))
  assert.equal(git('rev-parse', 'refs/heads/fix/session-isolation'), git('rev-parse', 'HEAD'))
  assert.equal(requests.filter((request) => request.system?.startsWith('Return only a short')).length, 1)
  assert.equal(requests[0].provider, 'conversation')
  assert.equal(requests[0].model, 'selected-model')
  assert.equal(requests[0].tools, undefined)
  assert.match(requests[0].messages[0].content[0].text, /Fix session isolation/)
  assert.doesNotMatch(requests[0].messages[0].content[0].text, /Earlier unrelated task/)
  assert.equal(
    agent.session
      .deriveMessages()
      .filter(
        (message) =>
          message.role === 'user' &&
          message.content.some(
            (block) => block.type === 'text' && block.text === 'Fix session isolation when switching worktrees'
          )
      ).length,
    1,
    'naming must not duplicate the submitted message'
  )
  agent = await freshSession()
  const cwd = repo
  for (const invalid of ['not a branch', 'git worktree add /tmp/evil', '../escape', '']) {
    answer = invalid
    assert.equal((await rpc('create', { cwd })).ok, true)
    const before = requests.length
    await submit()
    assert.equal(requests.length, before + 1, 'an invalid generated name must never start work')
    assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
    const progress = agent.session
      .snapshotEvents()
      .filter((event) => event.type === 'plugin:dungsil/ui-worktree/progress')
    assert.equal(progress.at(-1).data.status, 'failed')
    assert.equal(progress.at(-1).data.step, 0)
    assert.equal(progress.at(-1).data.branch, undefined)
    assert.doesNotMatch(JSON.stringify(progress.at(-1)), /git worktree add \/tmp\/evil|\.\.\/escape/)
    await submit()
    assert.equal(requests.length, before + 1, 'failed naming must not automatically retry')
  }
  answer = 'truncated-name'
  reason = { kind: 'max-tokens' }
  assert.equal((await rpc('create', { cwd })).ok, true)
  await submit()
  assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
  assert.equal(ctx.workingDirectory.get(agent.session), cwd)
  assert.deepEqual((await rpc('describe')).value.worktrees.map((entry) => entry.branch).sort(), [
    'fix/session-isolation',
    'main',
    'manual-name',
    null,
  ])
})

await test('자동 이름 짓기는 브랜치 이름 앞에 추론할 여지를 남긴다', async (t) => {
  const { ctx, agent, repo, git, rpc, submit } = await fixture(t, { provider: 'reasoning', model: 'reasoner' })
  const requests = []
  class ReasoningAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        defaultMaxTokens: 4096,
        reasoning: { efforts: [{ id: 'high', name: 'High' }], defaultEffort: 'high' },
      }
    }
    async *stream(options) {
      if (!options.system?.startsWith('Return only a short')) {
        yield { type: 'text-delta', index: 0, text: 'Finished' }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      requests.push(options)
      yield { type: 'reasoning-delta', index: 0, text: 'Choose a short branch name for this task.' }
      if (options.maxTokens < 512) {
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
        return
      }
      yield { type: 'text-delta', index: 1, text: 'fix/reasoning-budget' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['reasoning'], new ReasoningAdapter())
  const before = agent.session.deriveMessages()
  const created = await rpc('create', { cwd: repo })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.deepEqual(agent.session.deriveMessages(), before)
  await submit()
  assert.equal((await rpc('describe')).value.cwd, join(repo, '.agents/worktrees/fix/reasoning-budget'))
  assert.equal(git('rev-parse', 'fix/reasoning-budget'), git('rev-parse', 'HEAD'))
  assert.equal(requests.length, 1, 'naming must not retry a billable model call')
  assert.equal(requests[0].maxTokens, 4096, 'the model default includes reasoning, not just the visible name')
  assert.equal(requests[0].reasoningEffort, 'high')
  assert.equal(requests[0].tools, undefined)
  assert.ok(
    !agent.session
      .deriveMessages()
      .some((message) =>
        message.content.some((block) => block.type === 'text' && block.text.includes('Choose a short branch name'))
      )
  )
})

await test('모델에 기본값이 없으면 자동 이름 짓기는 지원되는 off 이외의 추론 강도를 선택한다', async (t) => {
  const { ctx, agent, repo, git, rpc, submit } = await fixture(t, {
    provider: 'reasoning',
    model: 'no-default',
    reasoningEffort: 'high',
  })
  const requests = []
  const workRequests = []
  class NoDefaultAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: ['off', 'low', 'medium', 'high'].map((id) => ({ id, name: id })),
        },
      }
    }
    async *stream(options) {
      if (!options.system?.startsWith('Return only a short')) {
        workRequests.push({ ...options, cwd: ctx.workingDirectory.get(agent.session) })
        yield { type: 'text-delta', index: 0, text: 'Finished' }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      requests.push(options)
      if (!options.reasoningEffort || options.reasoningEffort === 'off') {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { code: 'INVALID_REQUEST', message: 'Unsupported value: reasoning.effort none' },
          },
        }
        return
      }
      yield { type: 'text-delta', index: 0, text: 'fix/supported-reasoning' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['reasoning'], new NoDefaultAdapter())
  const before = agent.session.deriveMessages()
  const created = await rpc('create', { cwd: repo })
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(requests.length, 0, 'a reservation must not call the naming model')
  assert.deepEqual(agent.session.deriveMessages(), before)
  await submit('Fix supported reasoning for worktree names')
  const view = (await rpc('describe')).value
  const path = join(repo, '.agents/worktrees/fix/supported-reasoning')
  assert.equal(view.cwd, path)
  assert.equal(view.pendingCreation, undefined)
  assert.equal(requests.length, 1, 'select the effort before dispatch, without a billable retry')
  assert.equal(requests[0].reasoningEffort, 'low', 'skip off and do not inherit the conversation effort')
  assert.equal(requests[0].tools, undefined)
  assert.equal(git('rev-parse', 'fix/supported-reasoning'), git('rev-parse', 'HEAD'))
  assert.equal(agent.options.reasoningEffort, 'high')
  assert.ok(workRequests.length > 0)
  assert.ok(workRequests.every((request) => request.cwd === path))
  assert.ok(
    !agent.session
      .deriveMessages()
      .some((message) =>
        message.content.some((block) => block.type === 'text' && block.text === 'fix/supported-reasoning')
      )
  )
})

await test('이름 짓기는 명시적 추론 강도, 모델 기본값, 추론을 지원하지 않는 모델을 그대로 유지한다', async (t) => {
  for (const { label, configured, reasoning, expected } of [
    {
      label: '명시적 작업 추론 강도를 유지한다',
      configured: 'high',
      reasoning: { efforts: ['off', 'low', 'high'].map((id) => ({ id, name: id })), defaultEffort: 'low' },
      expected: 'high',
    },
    {
      label: '모델 기본값을 유지한다',
      reasoning: { efforts: ['off', 'low', 'medium'].map((id) => ({ id, name: id })), defaultEffort: 'medium' },
      expected: 'medium',
    },
    { label: '추론을 지원하지 않는 모델은 추론 강도를 지정하지 않는다', expected: undefined },
  ]) {
    await t.test(label, async (t) => {
      const { ctx, repo, rpc, submit } = await fixture(
        t,
        { provider: 'namer', model: 'small' },
        {
          provider: 'namer',
          model: 'small',
          ...(configured ? { reasoningEffort: configured } : {}),
        }
      )
      const requests = []
      class Adapter extends LlmAdapter {
        async resolveModel(provider, model) {
          return { provider, id: model, name: model, ...(reasoning ? { reasoning } : {}) }
        }
        async *stream(options) {
          if (!options.system?.startsWith('Return only a short')) {
            yield { type: 'text-delta', index: 0, text: 'Finished' }
            yield { type: 'finish', reason: { kind: 'stop' } }
            return
          }
          requests.push(options)
          yield { type: 'text-delta', index: 0, text: 'chore/effort-priority' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        }
      }
      ctx.llm.registerAdapter(['namer'], new Adapter())
      const created = await rpc('create', { cwd: repo })
      assert.equal(created.ok, true, JSON.stringify(created))
      assert.equal(requests.length, 0)
      await submit()
      const view = (await rpc('describe')).value
      assert.equal(view.cwd, join(repo, '.agents/worktrees/chore/effort-priority'))
      assert.equal(view.pendingCreation, undefined)
      assert.equal(requests.length, 1)
      assert.equal(requests[0].reasoningEffort, expected)
    })
  }
})

await test('콜드 조회는 중단된 세션을 활성화하거나 복구하지 않고 읽는다', async (t) => {
  const { ctx, agent, repo, other, rpc, inspections, resolutions } = await fixture(t)
  const id = SessionId('cold-worktree-read')
  const cold = Session.create(id, agent.session.snapshotEvents(), { ...agent.session.header, id })
  cold.append('working-directory/change', { cwd: other })
  setSandboxMode(cold, 'read-only')
  cold.append('turn/start', { turn: 1 })
  cold.append('step/start', { turn: 1, step: 0 })
  const events = cold.snapshotEvents()
  inspections.set(id, { meta: cold.header, inheritedEventCount: cold.inheritedEventCount, events })
  assert.equal(ctx.agents.get(id), undefined)
  const result = await rpc('describe', { sessionId: id })
  assert.equal(result.ok, true)
  assert.equal(result.value.cwd, other, 'Use the recorded directory, not the original project')
  assert.equal(cold.header.cwd, repo)
  assert.equal(ctx.sandboxPolicy.resolve({ session: cold }).mode, 'read-only')
  assert.equal(result.value.needsInitialization, true)
  assert.ok(result.value.worktrees.some((entry) => entry.branch === 'main'))
  assert.equal(ctx.agents.get(id), undefined, 'Reading a cold session must not publish an Agent')
  assert.deepEqual(resolutions, [], 'Lookup must not call the activating resolver')
  assert.deepEqual(cold.snapshotEvents(), events, 'Lookup must not close interrupted turns or initialize selection')
})

await test('다수의 동시 조회는 waitForExit가 끝나기 전까지 자식 핸들을 두 개만 유지한다', async (t) => {
  const { agent, rpc, inspections, resolutions, holdDescribeChildren } = await fixture(t)
  const id = SessionId('cold-concurrent-read')
  inspections.set(id, {
    meta: { ...agent.session.header, id },
    inheritedEventCount: agent.session.inheritedEventCount,
    events: agent.session.snapshotEvents(),
  })
  const before = agent.session.snapshotEvents()
  const children = holdDescribeChildren()
  const requests = Array.from({ length: 16 }, (_, index) => rpc('describe', index % 2 ? { sessionId: id } : {}))
  let results
  try {
    await children.waitForCount(2)
    assert.equal(children.active, 2)
    assert.equal(children.maximum, 2)
    assert.equal(children.handles.length, 2)
    children.handles[0].exit.resolve()
    await children.waitForCount(3)
    assert.equal(children.active, 2, 'The second child still occupies its slot after done resolves')
    assert.equal(children.maximum, 2)
  } finally {
    children.releaseAll()
    results = await Promise.all(requests)
  }
  assert.ok(results.every((result) => result.ok))
  assert.equal(children.handles.length, 16)
  assert.equal(children.maximum, 2)
  assert.equal(children.active, 0)
  assert.deepEqual(resolutions, [], 'Cold reads must not activate an Agent')
  assert.deepEqual(agent.session.snapshotEvents(), before)
})

await test('대기 중 취소된 콜드 조회는 세션을 검사하거나 자식 프로세스를 생성하지 않는다', async (t) => {
  const { ctx, rpc, holdDescribeChildren } = await fixture(t)
  const children = holdDescribeChildren()
  const active = [rpc('describe'), rpc('describe')]
  const controller = new AbortController()
  const inspect = ctx.sessionController.inspect
  let inspections = 0
  ctx.sessionController.inspect = async (...args) => {
    inspections++
    return inspect(...args)
  }
  let queued
  try {
    await children.waitForCount(2)
    queued = rpc('describe', { sessionId: 'cancelled-cold-read' }, owner, controller.signal)
    await rpc('settings')
    controller.abort()
    assert.equal((await queued).ok, false)
    assert.equal(inspections, 0, 'The queue must include cold session inspection, not just Git')
    assert.equal(children.handles.length, 2)
    assert.equal(children.active, 2)
  } finally {
    controller.abort()
    children.releaseAll()
    await Promise.all([...active, ...(queued ? [queued] : [])])
    ctx.sessionController.inspect = inspect
  }
  assert.equal((await rpc('describe')).ok, true)
  assert.equal(children.handles.length, 3, 'Only the later non-cancelled request may spawn')
  assert.equal(children.maximum, 2)
})

await test('조회 대기열이 가득 차면 busy를 반환하고 취소된 대기는 자식 프로세스를 생성하지 않는다', async (t) => {
  const { rpc, holdDescribeChildren } = await fixture(t)
  const children = holdDescribeChildren()
  const active = [rpc('describe'), rpc('describe')]
  const controller = new AbortController()
  let queued = []
  try {
    await children.waitForCount(2)
    queued = Array.from({ length: 128 }, () => rpc('describe', {}, owner, controller.signal))
    const overflow = await rpc('describe')
    assert.equal(overflow.ok, false)
    assert.equal(overflow.error.code, 'busy')
    controller.abort()
    assert.ok((await Promise.all(queued)).every((result) => !result.ok))
    assert.equal(children.handles.length, 2)
  } finally {
    controller.abort()
    children.releaseAll()
    await Promise.all([...active, ...queued])
  }
  assert.equal(children.active, 0)
  assert.equal(children.maximum, 2)
})

await test('플러그인을 폐기하면 대기 중인 콜드 조회는 검사와 자식 생성을 하지 않는다', async (t) => {
  const { ctx, rpc, holdDescribeChildren } = await fixture(t)
  const children = holdDescribeChildren()
  const active = [rpc('describe'), rpc('describe')]
  let inspections = 0
  ctx.sessionController.inspect = async () => {
    inspections++
    throw { code: 'session/not-found' }
  }
  let queued = []
  let disposal
  try {
    await children.waitForCount(2)
    queued = Array.from({ length: 8 }, () => rpc('describe', { sessionId: 'disposed-cold-read' }))
    await rpc('settings')
    disposal = ctx.fiber.dispose()
    assert.ok((await Promise.all(queued)).every((result) => !result.ok))
    assert.equal(inspections, 0)
    assert.equal(children.handles.length, 2)
    assert.equal(children.active, 2, 'Disposal must not free a slot before waitForExit settles')
  } finally {
    children.releaseAll()
    await Promise.all([...active, ...queued])
    await disposal
  }
  assert.equal(children.active, 0)
  assert.equal(children.maximum, 2)
})

await test('조회는 작업 중에도 세션을 바꾸지 않고 현재 체크아웃을 읽는다', async (t) => {
  const { ctx, agent, repo, rpc, submit } = await fixture(t, { provider: 'paused', model: 'paused-model' })
  const started = Promise.withResolvers()
  const work = Promise.withResolvers()
  class PausedWorkAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream() {
      started.resolve()
      await work.promise
      yield { type: 'text-delta', index: 0, text: 'Finished' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['paused'], new PausedWorkAdapter())
  assert.equal((await rpc('create', { cwd: repo, name: 'fix/navigation' })).ok, true)
  const submitted = submit()
  await started.promise
  try {
    const cwd = join(repo, '.agents/worktrees/fix/navigation')
    assert.equal(ctx.workingDirectory.get(agent.session), cwd)
    const before = agent.session.snapshotEvents()
    const views = await Promise.all([rpc('describe'), rpc('describe')])
    for (const view of views) {
      assert.equal(view.ok, true, 'Running work must not block a read-only lookup')
      assert.equal(view.value.cwd, cwd)
      assert.ok(view.value.worktrees.some((entry) => entry.branch === 'fix/navigation'))
    }
    assert.deepEqual(agent.session.snapshotEvents(), before, 'Lookup must not append session records')
    assert.equal((await rpc('create', { cwd, name: 'must-not-create' })).error.code, 'busy')
    assert.equal((await rpc('cancel', { cwd })).error.code, 'busy')
  } finally {
    work.resolve()
    await submitted
  }
  const restored = await rpc('describe')
  assert.equal(restored.ok, true)
  assert.equal(restored.value.cwd, join(repo, '.agents/worktrees/fix/navigation'))
  assert.ok(restored.value.worktrees.some((entry) => entry.branch === 'fix/navigation'))
})

await test('소유자가 아닌 요청, 형식이 잘못된 입력, 동시 유지 보수, 읽기 전용 상태의 생성을 거부한다', async (t) => {
  const { ctx, agent, repo, rpc, requests, submit } = await fixture(t)
  for (const endpoint of ['describe', 'initialize', 'create', 'cancel', 'settings', 'save-settings']) {
    assert.equal(
      (
        await rpc(
          endpoint,
          { cwd: repo, name: 'unauthorized', path: repo },
          { principal: { kind: 'anonymous' }, interactions: 'deny' }
        )
      ).status,
      403
    )
  }
  assert.equal((await rpc('create', { name: 'missing-cwd' })).error.code, 'invalid')
  assert.equal((await rpc('create', { cwd: repo, name: 42 })).error.code, 'invalid')
  assert.equal((await rpc('cancel')).error.code, 'invalid')
  assert.equal((await rpc('cancel', { cwd: tmpdir() })).error.code, 'conflict')
  assert.equal((await rpc('describe', { sessionId: 'missing' })).error.code, 'session/not-found')
  const queued = createUserMessage({ content: [{ type: 'text', text: 'Queued task' }], source: { kind: 'user' } })
  agent.inbox.append('next-turn', queued)
  const queuedEvents = agent.session.snapshotEvents()
  assert.equal((await rpc('describe')).ok, true, 'Queued prompts do not block a read')
  assert.deepEqual(agent.session.snapshotEvents(), queuedEvents)
  assert.equal((await rpc('initialize', { cwd: repo })).error.code, 'busy')
  assert.equal((await rpc('create', { cwd: repo, name: 'queued-task' })).error.code, 'busy')
  assert.equal((await rpc('cancel', { cwd: repo })).error.code, 'busy')
  agent.inbox.remove(queued.id)
  let finish
  const maintenance = agent.runMaintenance(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  try {
    const beforeMaintenanceRead = agent.session.snapshotEvents()
    assert.equal((await rpc('describe')).ok, true, 'Maintenance does not block a read')
    assert.deepEqual(agent.session.snapshotEvents(), beforeMaintenanceRead)
    const refused = await rpc('create', { cwd: repo, name: 'busy' })
    assert.equal(refused.ok, false)
    assert.equal((await rpc('initialize', { cwd: repo })).error.code, 'busy')
    assert.equal((await rpc('cancel', { cwd: repo })).error.code, 'busy')
  } finally {
    finish()
    await maintenance
  }
  const results = await Promise.all([
    rpc('create', { cwd: repo, name: 'single-creation' }),
    rpc('create', { cwd: repo, name: 'must-not-create' }),
  ])
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.find((result) => !result.ok).error.code, 'busy')
  const cwd = ctx.workingDirectory.get(agent.session)
  assert.equal(cwd, repo, 'concurrent reservations must not create anything')
  assert.equal((await rpc('cancel', { cwd })).ok, true)
  setSandboxMode(agent.session, 'read-only')
  assert.equal((await rpc('describe')).ok, true, 'read-only policy still permits listing')
  assert.equal((await rpc('create', { cwd: repo, name: 'read-only' })).ok, true)
  await submit()
  assert.equal(requests.length, 0, 'read-only creation failure must stop work')
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.equal(
    (await rpc('describe')).value.worktrees.some((entry) => entry.branch === 'read-only'),
    false
  )
})

await test('Loader를 다시 불러와도 설정을 유지하고 로컬 HEAD가 아니라 절대 경로와 추적된 리모트 커밋을 사용한다', async (t) => {
  const { ctx, repo, home, git, rpc, profile, submit, freshSession } = await fixture(t)
  const initial = (await rpc('settings')).value
  assert.deepEqual(initial.settings, {
    defaultSelection: 'current',
    directory: '.agents/worktrees',
    remote: false,
    deleteOnArchive: false,
    naming: 'semantic',
    prefix: '',
  })
  const remoteCommit = git('rev-parse', 'HEAD')
  git('remote', 'add', 'origin', join(home, 'not-fetched'))
  git('update-ref', 'refs/remotes/origin/main', remoteCommit)
  git('branch', '--set-upstream-to=origin/main', 'main')
  await writeFile(join(repo, 'local-only.txt'), 'not on remote')
  git('add', 'local-only.txt')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'local ahead')
  const directory = join(home, 'absolute pool 한글')
  const settings = { ...initial.settings, directory, remote: true }
  const saved = await rpc('save-settings', { ...initial, settings })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.value.settings, settings)
  assert.notEqual(saved.value.revision, initial.revision)
  assert.match(await readFile(profile.patchPath, 'utf8'), /remote: true/)
  assert.deepEqual((await rpc('settings')).value, saved.value)
  assert.equal((await rpc('save-settings', initial)).error.code, 'conflict')
  assert.equal((await rpc('create', { cwd: repo, name: 'remote-base' })).ok, true)
  await submit()
  const created = await rpc('describe')
  assert.equal(created.ok, true)
  assert.equal(created.value.cwd, join(directory, 'remote-base'))
  assert.equal(git('rev-parse', 'remote-base'), remoteCommit)
  assert.notEqual(git('rev-parse', 'remote-base'), git('rev-parse', 'main'))
  await assert.rejects(readFile(join(created.value.cwd, 'local-only.txt')), { code: 'ENOENT' })
  const agent = await freshSession()

  // A relative pool is resolved from the repository root even when the Session is nested.
  const latest = (await rpc('settings')).value
  assert.equal(
    (await rpc('save-settings', { ...latest, settings: { ...settings, remote: false, directory: '../relative pool' } }))
      .ok,
    true
  )
  const nested = join(repo, 'src/nested')
  await mkdir(nested, { recursive: true })
  await ctx.workingDirectory.set(agent, nested)
  assert.equal((await rpc('create', { cwd: nested, name: 'local-base' })).ok, true)
  await submit()
  const relative = await rpc('describe')
  assert.equal(relative.ok, true)
  assert.equal(relative.value.cwd, join(home, 'relative pool/local-base'))
  assert.equal(git('rev-parse', 'local-base'), git('rev-parse', 'main'))
  assert.equal(await readFile(join(relative.value.cwd, 'local-only.txt'), 'utf8'), 'not on remote')
})

await test('저장된 DSH와 사용자 지정 접두사는 생성된 이름에만 영향을 주며, 잘못된 설정과 없는 업스트림은 절대 브랜치를 만들지 않는다', async (t) => {
  const { ctx, repo, git, rpc, submit, freshSession } = await fixture(t, { provider: 'namer', model: 'small' })
  let modelCalls = 0
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream(options) {
      const naming = options.system?.startsWith('Return only a short')
      if (naming) modelCalls++
      yield { type: 'text-delta', index: 0, text: naming ? 'task-name' : 'Finished' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['namer'], new NamingAdapter())
  for (const [naming, prefix, branch] of [
    ['dsh', '', 'dsh/task-name'],
    ['custom', 'team/topic-', 'team/topic-task-name'],
  ]) {
    const view = (await rpc('settings')).value
    assert.equal((await rpc('save-settings', { ...view, settings: { ...view.settings, naming, prefix } })).ok, true)
    assert.equal((await rpc('create', { cwd: repo })).ok, true)
    await submit()
    const created = await rpc('describe')
    assert.equal(created.ok, true)
    assert.equal(created.value.cwd, join(repo, '.agents/worktrees', branch))
    assert.equal(git('rev-parse', branch), git('rev-parse', 'HEAD'))
    await freshSession()
  }
  assert.equal((await rpc('create', { cwd: repo, name: 'explicit-name' })).ok, true)
  await submit()
  const manual = await rpc('describe')
  assert.equal(manual.ok, true)
  assert.equal(manual.value.cwd, join(repo, '.agents/worktrees/explicit-name'))
  assert.equal(modelCalls, 2)
  await freshSession()
  const view = (await rpc('settings')).value
  for (const change of [
    { defaultSelection: 'other' },
    { directory: ' ' },
    { remote: 'yes' },
    { naming: 'other' },
    { prefix: '' },
    { prefix: '../escape/' },
  ]) {
    assert.equal(
      (await rpc('save-settings', { ...view, settings: { ...view.settings, ...change } })).error.code,
      'invalid'
    )
  }
  assert.deepEqual((await rpc('settings')).value, view)
  assert.equal((await rpc('save-settings', { ...view, settings: { ...view.settings, remote: true } })).ok, true)
  assert.equal((await rpc('create', { cwd: repo, name: 'no-upstream' })).ok, true)
  await submit()
  assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads/no-upstream'), '')
  assert.equal((await rpc('describe')).value.cwd, repo)
})

await test('설정된 훅과 체크아웃 필터는 워크트리를 생성하는 동안 실행되지 않는다', async (t) => {
  const { repo, home, git, rpc, submit } = await fixture(t)
  await writeFile(join(repo, '.gitattributes'), '*.txt filter=unsafe\n')
  await writeFile(join(repo, 'tracked.txt'), 'original content\n')
  git('add', '.gitattributes', 'tracked.txt')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'tracked content')
  const marker = join(home, 'must-not-execute')
  git('config', 'filter.unsafe.smudge', `touch '${marker}'; cat`)
  git('config', 'filter.unsafe.required', 'true')
  const hooks = join(home, 'hooks')
  await mkdir(hooks)
  await writeFile(join(hooks, 'post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 })
  git('config', 'core.hooksPath', hooks)
  assert.equal((await rpc('create', { cwd: repo, name: 'safe-checkout' })).ok, true)
  await submit()
  const result = await rpc('describe')
  assert.equal(result.ok, true)
  assert.equal(await readFile(join(result.value.cwd, 'tracked.txt'), 'utf8'), 'original content\n')
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
})

await test('작업 모델과 워크트리 설정은 프로필을 다시 불러와도 함께 유지되고, 오래된 쓰기를 거부하며 대화 모델로 되돌린다', async (t) => {
  const initialSettings = {
    defaultSelection: 'current',
    directory: '../naming pool',
    remote: true,
    deleteOnArchive: false,
    naming: 'custom',
    prefix: 'team/',
  }
  const { ctx, agent, repo, home, git, rpc, profile, submit, freshSession } = await fixture(
    t,
    { provider: 'fallback', model: 'large' },
    initialSettings
  )
  const requests = []
  let answer = 'task'
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        reasoning: {
          efforts: [
            { id: 'quick', name: 'Quick' },
            { id: 'thorough', name: 'Thorough' },
          ],
          defaultEffort: 'thorough',
        },
      }
    }
    async *stream(options) {
      const naming = options.system?.startsWith('Return only a short')
      if (naming) requests.push(options)
      yield { type: 'text-delta', index: 0, text: naming ? answer : 'Finished' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['naming', 'conversation', 'fallback'], new NamingAdapter())
  await ctx.plugin(ModelSettings)
  installModelSelection(agent.ctx, {
    current: { provider: 'conversation', model: 'selected', reasoningEffort: 'quick' },
  })
  agent.session.append('request/header', {
    header: { config: { provider: 'conversation', model: 'selected', reasoningEffort: 'quick' } },
    reason: 'initial',
  })
  git('remote', 'add', 'origin', join(home, 'not-fetched'))
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'))
  git('branch', '--set-upstream-to=origin/main', 'main')

  const staleSettings = (await rpc('settings')).value
  const initial = (await rpc('dungsil-model-settings/describe')).value
  assert.equal(initial.target, null)
  const route = { provider: 'naming', model: 'small' }
  const saved = await rpc('dungsil-model-settings/save', { ...initial.worktree, route, reasoningEffort: 'quick' })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.value.route, route)
  assert.deepEqual((await rpc('settings')).value.settings, initialSettings)
  assert.equal((await rpc('save-settings', staleSettings)).error.code, 'conflict')

  assert.equal((await rpc('create', { cwd: repo, name: 'manual' })).ok, true)
  assert.equal(requests.length, 0, 'saving a model and supplying a branch name must not generate text')
  await submit()
  assert.equal((await rpc('describe')).value.cwd, join(home, 'naming pool/manual'))
  assert.equal(requests.length, 0, 'an explicit name must bypass the configured naming model')
  await freshSession()

  for (const [naming, generated, branch] of [
    ['semantic', 'fix/task-1', 'fix/task-1'],
    ['dsh', 'task-2', 'dsh/task-2'],
    ['custom', 'task-3', 'team/task-3'],
  ]) {
    const view = (await rpc('settings')).value
    const modelBeforeEdit = (await rpc('dungsil-model-settings/describe')).value.worktree
    const settings = { ...view.settings, naming }
    const updated = await rpc('save-settings', {
      ...view,
      settings: { ...settings, provider: 'conversation', model: 'selected' },
    })
    assert.equal(updated.ok, true)
    assert.deepEqual(updated.value.settings, settings, 'the worktree API only reads and writes its own fields')
    const models = (await rpc('dungsil-model-settings/describe')).value
    assert.deepEqual(models.worktree.route, route, 'worktree edits must preserve the task model')
    assert.equal(models.worktree.reasoningEffort, 'quick', 'worktree edits must preserve the effort')
    const stale = await rpc('dungsil-model-settings/save', { ...modelBeforeEdit, route: null, reasoningEffort: null })
    assert.equal(stale.error?.code, 'conflict', `${naming}: ${JSON.stringify(stale)}`)
    answer = generated
    assert.equal((await rpc('create', { cwd: repo })).ok, true)
    const before = requests.length
    await submit()
    assert.equal(requests.length, before + 1, 'only submission may call the configured naming model')
    const created = await rpc('describe')
    assert.equal(created.ok, true)
    assert.equal(created.value.cwd, join(home, 'naming pool', branch))
    await freshSession()
  }
  assert.deepEqual(
    requests.map(({ provider, model, tools, reasoningEffort }) => ({ provider, model, tools, reasoningEffort })),
    Array.from({ length: 3 }, () => ({ ...route, tools: undefined, reasoningEffort: 'quick' }))
  )
  assert.match(await readFile(profile.patchPath, 'utf8'), /provider: naming/)
  assert.match(await readFile(profile.patchPath, 'utf8'), /model: small/)
  assert.match(await readFile(profile.patchPath, 'utf8'), /reasoningEffort: quick/)

  const explicit = (await rpc('dungsil-model-settings/describe')).value.worktree
  const automatic = await rpc('dungsil-model-settings/save', { ...explicit, reasoningEffort: null })
  assert.equal(automatic.ok, true)
  answer = 'automatic'
  assert.equal((await rpc('create', { cwd: repo })).ok, true)
  await submit()
  const autoNamed = await rpc('describe')
  assert.equal(autoNamed.ok, true)
  assert.equal(requests.at(-1).reasoningEffort, 'thorough', 'automatic uses the model default')
  await freshSession()
  assert.equal((await rpc('dungsil-model-settings/save', { ...automatic.value, reasoningEffort: 'quick' })).ok, true)

  const beforeReset = (await rpc('settings')).value
  const models = (await rpc('dungsil-model-settings/describe')).value
  const reset = await rpc('dungsil-model-settings/save', { ...models.worktree, route: null, reasoningEffort: null })
  assert.equal(reset.ok, true)
  assert.equal(reset.value.route, null)
  assert.deepEqual((await rpc('settings')).value.settings, beforeReset.settings)
  assert.equal((await rpc('save-settings', beforeReset)).error.code, 'conflict')
  assert.doesNotMatch(await readFile(profile.patchPath, 'utf8'), /provider:|model:|reasoningEffort:/)
  answer = 'inherited'
  assert.equal((await rpc('create', { cwd: repo })).ok, true)
  await submit()
  const inherited = await rpc('describe')
  assert.equal(inherited.ok, true)
  assert.equal(inherited.value.cwd, join(home, 'naming pool/team/inherited'))
  assert.equal(requests.at(-1).provider, 'conversation')
  assert.equal(requests.at(-1).model, 'selected')
  assert.equal(requests.at(-1).reasoningEffort, 'thorough', 'inheriting a model does not inherit conversation effort')
  assert.deepEqual(agent.session.requestHeader().config, {
    provider: 'conversation',
    model: 'selected',
    reasoningEffort: 'quick',
  })
})

await test('자동 워크트리 이름 짓기는 대화 호출을 바꾸지 않고 실시간 보조 설정을 따른다', async (t) => {
  const route = { provider: 'auxiliary', model: 'small' }
  const { ctx, agent, repo, rpc, requests, submit, freshSession } = await fixture(
    t,
    {},
    {},
    {
      auxiliaryModel: { ...route, reasoningEffort: 'quick' },
    }
  )
  const namingRequests = []
  const customInstructions = 'Return only a short custom branch name. Worktree instructions.'
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return {
        provider,
        id: model,
        name: model,
        reasoning: { efforts: ['quick', 'thorough'].map((id) => ({ id, name: id })), defaultEffort: 'thorough' },
      }
    }
    async *stream(options) {
      namingRequests.push(options)
      yield { type: 'text-delta', index: 0, text: `fix/task-${namingRequests.length}` }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['auxiliary', 'explicit'], new NamingAdapter())
  const check = async (expected, effort) => {
    assert.equal((await rpc('create', { cwd: repo })).ok, true)
    await submit()
    const created = (await rpc('describe')).value
    assert.ok(created.cwd.endsWith(`task-${namingRequests.length}`))
    assert.equal(namingRequests.at(-1).provider, expected.provider)
    assert.equal(namingRequests.at(-1).model, expected.model)
    assert.equal(namingRequests.at(-1).reasoningEffort, effort)
    assert.equal(
      namingRequests.at(-1).system,
      customInstructions + (expected.provider === 'auxiliary' ? '\n\nShared instructions.' : '')
    )
    await freshSession()
  }
  const describe = async () => (await rpc('dungsil-model-settings/describe')).value
  const save = (payload) => rpc('dungsil-model-settings/save', payload)
  const defaults = (await describe()).worktree
  assert.equal((await rpc('create', { cwd: repo })).ok, true)
  await submit()
  assert.equal(namingRequests.at(-1).system, defaults.instructions)
  assert.equal(defaults.instructions, defaults.defaultInstructions)
  await freshSession()
  for (const [task, instructions] of [
    ['auxiliary', 'Shared instructions.'],
    ['worktree', customInstructions],
  ]) {
    assert.equal(
      (await rpc('dungsil-model-settings/instructions', { ...(await describe())[task], instructions })).ok,
      true
    )
  }
  assert.equal((await describe()).worktree.useAuxiliary, true)
  await check(route, 'quick')
  const nextRoute = { provider: 'auxiliary', model: 'updated' }
  assert.equal(
    (await save({ ...(await describe()).auxiliary, route: nextRoute, reasoningEffort: 'thorough' })).ok,
    true
  )
  await check(nextRoute, 'thorough')
  const explicit = { provider: 'explicit', model: 'own' }
  assert.equal((await save({ ...(await describe()).worktree, route: explicit, reasoningEffort: 'quick' })).ok, true)
  await check(explicit, 'quick')
  assert.equal(
    (await save({ ...(await describe()).worktree, route: null, reasoningEffort: null, useAuxiliary: true })).ok,
    true
  )
  await check(nextRoute, 'thorough')
  const worktree = (await describe()).worktree
  assert.equal((await rpc('dungsil-model-settings/instructions', { ...worktree, instructions: '' })).ok, true)
  assert.equal((await rpc('create', { cwd: repo })).ok, true)
  await submit()
  assert.equal(namingRequests.at(-1).system, `${defaults.defaultInstructions}\n\nShared instructions.`)
  await freshSession()
  assert.equal(
    (
      await rpc('dungsil-model-settings/instructions', {
        ...(await describe()).worktree,
        instructions: customInstructions,
      })
    ).ok,
    true
  )
  assert.equal(
    (await save({ ...(await describe()).worktree, route: null, reasoningEffort: null, useAuxiliary: false })).ok,
    true
  )
  const auxiliaryCalls = namingRequests.length
  assert.equal((await rpc('create', { cwd: repo })).ok, true)
  await submit()
  assert.equal(namingRequests.length, auxiliaryCalls)
  assert.ok(requests.some((request) => request.system?.startsWith('Return only a short')))
  const naming = requests.findLast((request) => request.system?.startsWith('Return only a short'))
  assert.equal(naming.system, customInstructions)
  assert.ok(!naming.system.includes('Shared instructions.'))
  assert.ok(
    requests
      .filter((request) => request !== naming)
      .every((request) => !request.system?.includes('Worktree instructions.'))
  )
  assert.deepEqual(
    { provider: agent.options.provider, model: agent.options.model },
    { provider: 'test', model: 'test-model' }
  )
  assert.ok(requests.every((request) => request.provider === 'test' && request.model === 'test-model'))
})

await test('대상 디렉터리에만 적용되는 조건부 필터는 체크아웃이나 아카이브 정리 중에 실행될 수 없다', async (t) => {
  const { repo, home, git, rpc, submit, archive } = await fixture(t, {}, { deleteOnArchive: true })
  await writeFile(join(repo, '.gitattributes'), '*.txt filter=linked\n')
  await writeFile(join(repo, 'tracked.txt'), 'unchanged\n')
  git('add', '.gitattributes', 'tracked.txt')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'content')
  const marker = join(home, 'filter-executed')
  const included = join(home, 'linked-config')
  await writeFile(
    included,
    `[filter "linked"]\n smudge = "touch '${marker}'; cat"\n clean = "touch '${marker}'; cat"\n required = true\n`
  )
  git('config', `includeIf.gitdir:${gitPath(repo)}/.git/worktrees/.path`, included)
  assert.equal(git('config', '--get-regexp', '^includeIf\\.').includes('linked-config'), true)
  assert.equal((await rpc('create', { cwd: repo, name: 'linked-safe' })).ok, true)
  await submit()
  const result = await rpc('describe')
  assert.notEqual(result.value.cwd, repo)
  assert.equal(await readFile(join(result.value.cwd, 'tracked.txt'), 'utf8'), 'unchanged\n')
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
  await writeFile(join(result.value.cwd, 'tracked.txt'), 'unchanged\n')
  await archive()
  assert.equal(git('worktree', 'list', '--porcelain').includes(gitPath(result.value.cwd)), false)
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
})

await test('저장소 심볼릭 링크는 풀이나 브랜치 접두사 할당 경로를 다른 곳으로 돌릴 수 없다', async (t) => {
  for (const component of ['.agents', '.agents/worktrees', '.agents/worktrees/fix']) {
    await t.test(`${component} 심볼릭 링크를 통한 외부 경로 생성을 거부한다`, async (t) => {
      const { repo, home, git, rpc, submit } = await fixture(t)
      const outside = join(home, 'outside')
      await mkdir(outside)
      const parts = component.split('/')
      if (parts.length > 1) await mkdir(join(repo, ...parts.slice(0, -1)), { recursive: true })
      await symlink(outside, join(repo, component), 'dir')
      await rpc('create', { cwd: repo, name: 'fix/escape' })
      await submit()
      assert.equal((await rpc('describe')).value.cwd, repo)
      assert.equal(git('branch', '--list', 'fix/escape'), '')
      await assert.rejects(readFile(join(outside, 'escape/.git')), { code: 'ENOENT' })
      assert.deepEqual(await (await import('node:fs/promises')).readdir(outside), [])
    })
  }
})

await test('초기 선택에서도 기존 워크트리로 전환하는 RPC를 제공하지 않는다', async (t) => {
  const { ctx, agent, repo, other, rpc } = await fixture(t)
  const before = agent.session.snapshotEvents()
  assert.equal((await rpc('switch', { cwd: repo, path: gitPath(other) })).status, 404)
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.deepEqual(agent.session.snapshotEvents(), before)
})

await test('현재 체크아웃에서 user 또는 user-rpc 작업을 시작하면 라이브 및 콜드 조회의 선택을 잠근다', async (t) => {
  for (const kind of ['user', 'user-rpc']) {
    await t.test(`${kind} 작업 이후 생성과 취소를 거부한다`, async (t) => {
      const { ctx, agent, repo, rpc, inspections, resolutions } = await fixture(t, {}, { defaultSelection: 'new' })
      agent.session.append('turn/start', { turn: 1 })
      agent.session.append(
        'user/message',
        createUserMessage({ content: [{ type: 'text', text: 'Started task' }], source: { kind } }),
        { surfaceOp: 'append' }
      )
      assert.equal((await rpc('describe')).value.locked, true)
      const initialized = await rpc('initialize', { cwd: repo })
      assert.equal(initialized.value.locked, true)
      assert.equal(initialized.value.pendingCreation, undefined)
      const before = agent.session.snapshotEvents()
      assert.equal((await rpc('create', { cwd: repo, name: 'must-not-create' })).error.code, 'conflict')
      assert.equal((await rpc('cancel', { cwd: repo })).error.code, 'conflict')
      assert.deepEqual(agent.session.snapshotEvents(), before)
      assert.equal(ctx.workingDirectory.get(agent.session), repo)
      const id = SessionId(`cold-locked-${kind}`)
      inspections.set(id, {
        meta: { ...agent.session.header, id },
        inheritedEventCount: agent.session.inheritedEventCount,
        events: before,
      })
      const count = resolutions.length
      assert.equal((await rpc('describe', { sessionId: id })).value.locked, true)
      assert.equal(resolutions.length, count)
      assert.equal(ctx.agents.get(id), undefined)
    })
  }
})

await test('생성 실패 예약은 자동 재시도하지 않으며 취소하거나 다시 예약하여 복구한다', async (t) => {
  for (const recovery of ['cancel', 'create']) {
    await t.test(
      recovery === 'cancel'
        ? '실패 예약을 취소하고 현재 체크아웃을 잠근다'
        : '실패 예약을 새 이름으로 다시 예약하고 생성한다',
      async (t) => {
        const { ctx, agent, repo, git, rpc, requests, submit } = await fixture(t)
        assert.equal((await rpc('create', { cwd: repo, name: 'main' })).ok, true)
        await submit()
        const failed = (await rpc('describe')).value
        assert.equal(failed.pendingCreation.failed, true)
        assert.equal(failed.locked, undefined)
        assert.equal(requests.length, 0)
        await submit('Do not retry automatically')
        assert.equal(requests.length, 0)
        assert.equal(ctx.workingDirectory.get(agent.session), repo)
        assert.equal((await rpc('cancel', { cwd: tmpdir() })).error.code, 'conflict')
        assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
        const result = await rpc(recovery, { cwd: repo, name: 'fix/recovered' })
        assert.equal(result.ok, true)
        if (recovery === 'cancel') {
          assert.equal(result.value.pendingCreation, undefined)
          assert.equal(result.value.locked, true)
          assert.equal((await rpc('create', { cwd: repo, name: 'must-not-create' })).error.code, 'conflict')
        } else {
          assert.equal(result.value.pendingCreation.failed, false)
          assert.equal(result.value.locked, undefined)
        }
        await submit('Continue after recovery')
        const view = (await rpc('describe')).value
        assert.equal(view.locked, true)
        assert.equal(view.pendingCreation, undefined)
        assert.equal(view.cwd, recovery === 'cancel' ? repo : join(repo, '.agents/worktrees/fix/recovered'))
        assert.equal(git('branch', '--list', 'fix/recovered') !== '', recovery === 'create')
        assert.ok(requests.length > 0)
      }
    )
  }
})

await test('명시적 외부 풀은 소유자가 선택한 심볼릭 링크 상위 경로를 유지한다', async (t) => {
  const { repo, home, rpc, submit } = await fixture(t)
  const external = join(home, 'external')
  const alias = join(home, 'pool-alias')
  await mkdir(external)
  await symlink(external, alias, 'dir')
  const current = (await rpc('settings')).value
  assert.equal(
    (await rpc('save-settings', { ...current, settings: { ...current.settings, directory: join(alias, 'pool') } })).ok,
    true
  )
  await rpc('create', { cwd: repo, name: 'safe' })
  await submit()
  assert.equal((await rpc('describe')).value.cwd, join(external, 'pool/safe'))
})

await test('아카이브 정리는 선택해야 동작하고 다시 불러와도 유지되며, 체크아웃만 제거하고 소스 디렉터리를 복원한다', async (t) => {
  const { ctx, agent, repo, git, rpc, submit, archive, profile } = await fixture(t)
  assert.equal((await rpc('create', { cwd: repo, name: 'feat/archived' })).ok, true)
  await submit()
  const path = ctx.workingDirectory.get(agent.session)
  const settings = (await rpc('settings')).value
  assert.equal(
    (
      await rpc('save-settings', {
        ...settings,
        settings: { ...settings.settings, deleteOnArchive: true },
      })
    ).ok,
    true
  )
  assert.match(await readFile(profile.patchPath, 'utf8'), /deleteOnArchive: true/)
  await archive()
  assert.equal(git('worktree', 'list', '--porcelain').includes(gitPath(path)), false)
  assert.equal(git('branch', '--list', 'feat/archived'), 'feat/archived')
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.ok(ctx.workspaceRegistry.archivedSessionIds.includes(agent.id))
  await ctx.workspaceRegistry.unarchiveSession(agent.id)
  assert.equal((await rpc('describe')).value.cwd, repo)
  await submit('Continue from the source checkout')
})

await test('아카이브 정리는 비활성, 변경 사항이 있는, 무시된, 잠긴, 외부, 공유 체크아웃을 보존한다', async (t) => {
  for (const [scenario, label] of [
    ['disabled', '정리가 비활성이면 체크아웃을 보존한다'],
    ['tracked', '추적 파일이 변경되면 체크아웃을 보존한다'],
    ['untracked', '추적하지 않는 파일이 있으면 체크아웃을 보존한다'],
    ['ignored', '무시된 파일이 있으면 체크아웃을 보존한다'],
    ['locked', '잠긴 체크아웃을 보존한다'],
    ['foreign', '소유하지 않은 외부 체크아웃을 보존한다'],
    ['shared-live', '라이브 세션이 공유하는 체크아웃을 보존한다'],
    ['shared-stored', '저장된 세션이 공유하는 체크아웃을 보존한다'],
    ['fork', '포크된 세션이 공유하는 체크아웃을 보존한다'],
  ]) {
    await t.test(label, async (t) => {
      const { ctx, agent, repo, other, git, rpc, submit, harness, archive } = await fixture(
        t,
        {},
        {
          deleteOnArchive: scenario !== 'disabled',
        }
      )
      if (scenario === 'foreign') {
        await ctx.workingDirectory.set(agent, other)
      } else {
        await writeFile(join(repo, 'tracked.txt'), 'committed')
        await writeFile(join(repo, '.gitignore'), 'ignored.txt\n')
        git('add', 'tracked.txt', '.gitignore')
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'tracked file')
        assert.equal((await rpc('create', { cwd: repo, name: 'feat/preserve' })).ok, true)
        await submit()
      }
      const path = ctx.workingDirectory.get(agent.session)
      if (['tracked', 'untracked', 'ignored'].includes(scenario)) {
        await writeFile(join(path, `${scenario}.txt`), 'must survive')
      }
      if (scenario === 'locked') git('worktree', 'lock', path)
      if (scenario === 'shared-live') {
        await harness.create(SessionId('shared-live'), { provider: 'test', model: 'test-model' }, { cwd: path })
      }
      if (scenario === 'fork') {
        const fork = ctx.sessions.create(SessionId('forked'), {
          seed: agent.session.snapshotEvents(),
          meta: { cwd: repo },
        })
        assert.equal(ctx.workingDirectory.get(fork), path)
      }
      if (scenario === 'shared-stored') {
        const stored = Session.create(SessionId('shared-stored'), [], {
          ...agent.session.header,
          id: SessionId('shared-stored'),
        })
        stored.append('working-directory/change', { cwd: path })
        const handle = await ctx.sessionPersistence.create(stored.header)
        await handle.append(stored.snapshotEvents())
        await handle.close()
      }
      await archive()
      assert.ok(git('worktree', 'list', '--porcelain').includes(gitPath(path)))
      assert.equal(ctx.workingDirectory.get(agent.session), path)
      if (['tracked', 'untracked', 'ignored'].includes(scenario)) {
        assert.equal(await readFile(join(path, `${scenario}.txt`), 'utf8'), 'must survive')
      }
    })
  }
})
