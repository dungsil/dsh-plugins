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
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
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
  const dir = join(home, 'profiles/test')
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
    name: 'test',
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
      resolveAgent: async (id) =>
        id === agent.id ? { agent } : { error: { code: 'session/not-found', message: 'Missing' } },
    })
  })
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (endpoint, payload = {}, peer = owner) => {
    const method = endpoint.includes('/') ? endpoint : `dungsil-worktree/${endpoint}`
    const response = await handler.fetch(
      new Request(`http://localhost/api/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  return { ctx, agent, repo, other, git, rpc, home, profile, requests, submit, harness }
}

await test('reserves without side effects, creates before prompt work, and keeps existing switches immediate', async (t) => {
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
    worktrees: [
      { path: gitPath(repo), branch: 'main' },
      { path: gitPath(other), branch: null },
    ],
  })
  const mainPath = initial.value.worktrees.find((entry) => entry.branch === 'main').path
  const otherPath = initial.value.worktrees.find((entry) => entry.branch === null).path
  const reserved = await rpc('create', { cwd: repo, name: 'fix/login-ui' })
  assert.equal(reserved.ok, true)
  assert.deepEqual(reserved.value, { ...initial.value, pendingCreation: { name: 'fix/login-ui', failed: false } })
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

  assert.equal((await rpc('switch', { cwd: repo, path: otherPath })).error.code, 'conflict')
  assert.equal((await rpc('switch', { cwd: path, path: tmpdir() })).error.code, 'invalid')
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  const switched = await rpc('switch', { cwd: path, path: otherPath })
  assert.equal(switched.ok, true)
  assert.equal(switched.value.cwd, other)
  assert.equal((await rpc('switch', { cwd: switched.value.cwd, path: mainPath })).ok, true)
  const count = requests.length
  assert.equal((await rpc('create', { cwd: repo, name: 'fix/login-ui' })).ok, true)
  await submit()
  assert.equal(requests.length, count, 'an existing branch must stop work, not run in the source checkout')
  assert.equal(ctx.workingDirectory.get(agent.session), repo, 'an existing branch cannot change the checkout')
  assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
  await submit('Do not retry the failed creation')
  assert.equal(requests.length, count)
  assert.equal((await rpc('switch', { cwd: repo, path: mainPath })).ok, true)
  assert.equal(
    (await rpc('describe')).value.pendingCreation,
    undefined,
    'selecting the current checkout cancels a reservation'
  )
  const events = agent.session.snapshotEvents()
  assert.ok(events.some((event) => event.type === 'user/message'))
  assert.equal(events.filter((event) => event.type === 'working-directory/change').length, 3)
})

await test('new-worktree default reserves once without side effects and respects cancellation across profile reloads', async (t) => {
  const { agent, repo, git, rpc, requests, profile, submit } = await fixture(t, {}, { defaultSelection: 'new' })
  const initial = await rpc('describe')
  assert.equal(initial.ok, true)
  assert.deepEqual(initial.value.pendingCreation, { name: '', failed: false })
  assert.equal(initial.value.cwd, repo)
  assert.equal(initial.value.worktrees.length, 2)
  assert.equal(requests.length, 0)
  assert.deepEqual((await rpc('describe')).value, initial.value)
  const main = initial.value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd: repo, path: main })).value.pendingCreation, undefined)
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

await test('new-worktree default creates on first prompt only and does not replace an existing conversation checkout', async (t) => {
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
  assert.equal((await rpc('describe')).value.pendingCreation.failed, false)
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

await test('reservations are session-local, cancellable, and refuse a source directory changed before submission', async (t) => {
  const { ctx, agent, repo, other, git, rpc, requests, submit, harness } = await fixture(t)
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
  const main = (await rpc('describe')).value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd: repo, path: main })).ok, true)
  await submit()
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.equal(git('branch', '--list', 'cancelled-task'), '', 'cancelling before submission must never create a branch')

  assert.equal((await rpc('create', { cwd: repo, name: 'stale-source' })).ok, true)
  await agent.runMaintenance((signal) => ctx.workingDirectory.set(agent, other, signal))
  const count = requests.length
  await submit()
  assert.equal(requests.length, count, 'a changed source must stop before either naming or work')
  assert.equal(git('branch', '--list', 'stale-source'), '')
  assert.equal((await rpc('describe')).value.pendingCreation.failed, true)
})

await test('an empty reserved name uses the newly submitted prompt, not earlier history, only for naming', async (t) => {
  const { ctx, agent, repo, git, rpc, submit } = await fixture(t, { provider: 'fallback', model: 'fallback-model' })
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
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'Earlier unrelated task' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' }
  )
  const named = await rpc('create', { cwd: repo, name: ' manual-name ' })
  assert.equal(named.ok, true)
  assert.equal(requests.length, 0, 'a supplied name must not incur a model request')
  await submit()
  assert.ok(
    requests.every((request) => !request.system?.startsWith('Return only a short')),
    'a supplied name bypasses naming'
  )
  const mainPath = named.value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd: ctx.workingDirectory.get(agent.session), path: mainPath })).ok, true)
  requests.length = 0
  agent.session.append('request/header', {
    header: { config: { provider: 'conversation', model: 'selected-model' } },
    reason: 'initial',
  })
  assert.equal((await rpc('create', { cwd: repo, name: '  ' })).ok, true)
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
    const settings = (await rpc('settings')).value
    assert.equal((await rpc('save-settings', settings)).error.code, 'busy', 'settings cannot interrupt creation')
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
  const cwd = generated.value.cwd
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

await test('automatic naming leaves room for reasoning before the branch name', async (t) => {
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

await test('automatic naming selects a supported non-off effort when the model has no default', async (t) => {
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

await test('naming preserves explicit efforts, model defaults and non-reasoning models', async (t) => {
  for (const { label, configured, reasoning, expected } of [
    {
      label: 'explicit task effort',
      configured: 'high',
      reasoning: { efforts: ['off', 'low', 'high'].map((id) => ({ id, name: id })), defaultEffort: 'low' },
      expected: 'high',
    },
    {
      label: 'model default',
      reasoning: { efforts: ['off', 'low', 'medium'].map((id) => ({ id, name: id })), defaultEffort: 'medium' },
      expected: 'medium',
    },
    { label: 'non-reasoning model', expected: undefined },
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

await test('refuses non-owners, malformed input, concurrent maintenance, and read-only creation', async (t) => {
  const { ctx, agent, repo, rpc, requests, submit } = await fixture(t)
  for (const endpoint of ['describe', 'create', 'switch', 'settings', 'save-settings']) {
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
  assert.equal((await rpc('describe', { sessionId: 'missing' })).error.code, 'session/not-found')
  const queued = createUserMessage({ content: [{ type: 'text', text: 'Queued task' }], source: { kind: 'user' } })
  agent.inbox.append('next-turn', queued)
  assert.equal((await rpc('create', { cwd: repo, name: 'queued-task' })).error.code, 'busy')
  agent.inbox.remove(queued.id)
  let finish
  const maintenance = agent.runMaintenance(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const refused = await rpc('create', { cwd: repo, name: 'busy' })
  assert.equal(refused.ok, false)
  finish()
  await maintenance
  const results = await Promise.all([
    rpc('create', { cwd: repo, name: 'single-creation' }),
    rpc('create', { cwd: repo, name: 'must-not-create' }),
  ])
  assert.equal(results.filter((result) => result.ok).length, 1)
  assert.equal(results.find((result) => !result.ok).error.code, 'busy')
  const cwd = ctx.workingDirectory.get(agent.session)
  assert.equal(cwd, repo, 'concurrent reservations must not create anything')
  const mainPath = results.find((result) => result.ok).value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd, path: mainPath })).ok, true)
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

await test('persists settings through Loader reload and uses absolute paths and the tracked remote commit, not local HEAD', async (t) => {
  const { ctx, agent, repo, home, git, rpc, profile, submit } = await fixture(t)
  const initial = (await rpc('settings')).value
  assert.deepEqual(initial.settings, {
    defaultSelection: 'current',
    directory: '.agents/worktrees',
    remote: false,
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
  assert.equal((await rpc('switch', { cwd: created.value.cwd, path: gitPath(repo) })).ok, true)

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

await test('saved DSH and custom prefixes affect generated names only; invalid settings and missing upstream never create branches', async (t) => {
  const { ctx, repo, git, rpc, submit } = await fixture(t, { provider: 'namer', model: 'small' })
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
    assert.equal((await rpc('switch', { cwd: created.value.cwd, path: gitPath(repo) })).ok, true)
  }
  assert.equal((await rpc('create', { cwd: repo, name: 'explicit-name' })).ok, true)
  await submit()
  const manual = await rpc('describe')
  assert.equal(manual.ok, true)
  assert.equal(manual.value.cwd, join(repo, '.agents/worktrees/explicit-name'))
  assert.equal(modelCalls, 2)
  assert.equal((await rpc('switch', { cwd: manual.value.cwd, path: gitPath(repo) })).ok, true)
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

await test('configured hooks and checkout filters do not execute while creating a worktree', async (t) => {
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

await test('task model and worktree settings coexist across profile reloads, reject stale writes and reset to the conversation model', async (t) => {
  const initialSettings = {
    defaultSelection: 'current',
    directory: '../naming pool',
    remote: true,
    naming: 'custom',
    prefix: 'team/',
  }
  const { ctx, agent, repo, home, git, rpc, profile, submit } = await fixture(
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
  const manual = await rpc('describe')
  assert.equal(requests.length, 0, 'an explicit name must bypass the configured naming model')
  assert.equal((await rpc('switch', { cwd: manual.value.cwd, path: gitPath(repo) })).ok, true)

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
    assert.equal((await rpc('switch', { cwd: created.value.cwd, path: gitPath(repo) })).ok, true)
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
  assert.equal((await rpc('switch', { cwd: autoNamed.value.cwd, path: gitPath(repo) })).ok, true)
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

await test('automatic worktree naming follows live auxiliary settings without changing conversation calls', async (t) => {
  const route = { provider: 'auxiliary', model: 'small' }
  const { ctx, agent, repo, rpc, requests, submit } = await fixture(
    t,
    {},
    {},
    {
      auxiliaryModel: { ...route, reasoningEffort: 'quick' },
    }
  )
  const namingRequests = []
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
    assert.equal((await rpc('switch', { cwd: created.cwd, path: gitPath(repo) })).ok, true)
  }
  const describe = async () => (await rpc('dungsil-model-settings/describe')).value
  const save = (payload) => rpc('dungsil-model-settings/save', payload)
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
  assert.equal(
    (await save({ ...(await describe()).worktree, route: null, reasoningEffort: null, useAuxiliary: false })).ok,
    true
  )
  const auxiliaryCalls = namingRequests.length
  assert.equal((await rpc('create', { cwd: repo })).ok, true)
  await submit()
  assert.equal(namingRequests.length, auxiliaryCalls)
  assert.ok(requests.some((request) => request.system?.startsWith('Return only a short')))
  assert.deepEqual(
    { provider: agent.options.provider, model: agent.options.model },
    { provider: 'test', model: 'test-model' }
  )
  assert.ok(requests.every((request) => request.provider === 'test' && request.model === 'test-model'))
})

await test('destination-only conditional checkout filters cannot execute', async (t) => {
  const { repo, home, git, rpc, submit } = await fixture(t)
  await writeFile(join(repo, '.gitattributes'), '*.txt filter=linked\n')
  await writeFile(join(repo, 'tracked.txt'), 'unchanged\n')
  git('add', '.gitattributes', 'tracked.txt')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'content')
  const marker = join(home, 'filter-executed')
  const included = join(home, 'linked-config')
  await writeFile(included, `[filter "linked"]\n smudge = "touch '${marker}'; cat"\n required = true\n`)
  git('config', `includeIf.gitdir:${gitPath(repo)}/.git/worktrees/.path`, included)
  assert.equal(git('config', '--get-regexp', '^includeIf\\.').includes('linked-config'), true)
  assert.equal((await rpc('create', { cwd: repo, name: 'linked-safe' })).ok, true)
  await submit()
  const result = await rpc('describe')
  assert.notEqual(result.value.cwd, repo)
  assert.equal(await readFile(join(result.value.cwd, 'tracked.txt'), 'utf8'), 'unchanged\n')
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
})

await test('repository symlinks cannot redirect pool or branch-prefix allocation', async (t) => {
  for (const component of ['.agents', '.agents/worktrees', '.agents/worktrees/fix']) {
    await t.test(component, async (t) => {
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

await test('stale or forged worktree metadata cannot switch to unrelated directories', async (t) => {
  for (const replacement of ['plain', 'repository', 'forged-link', 'symlink-git']) {
    await t.test(replacement, async (t) => {
      const { ctx, agent, repo, other, git, rpc } = await fixture(t)
      const link = await readFile(join(other, '.git'), 'utf8')
      await rm(other, { recursive: true })
      await mkdir(other)
      if (replacement === 'repository') execFileSync('git', ['init', '-b', 'main', other])
      if (replacement === 'forged-link' || replacement === 'symlink-git') {
        const valid = join(repo, 'valid')
        git('worktree', 'add', '--detach', valid)
        if (replacement === 'symlink-git') await symlink(join(valid, '.git'), join(other, '.git'), 'file')
        else await writeFile(join(other, '.git'), await readFile(join(valid, '.git')))
        assert.notEqual(await readFile(join(other, '.git'), 'utf8'), link)
      }
      const response = await rpc('switch', { cwd: repo, path: gitPath(other) })
      assert.equal(response.ok, false)
      assert.equal(ctx.workingDirectory.get(agent.session), repo)
    })
  }
})

await test('explicit external pools retain owner-selected symlink ancestors', async (t) => {
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
