import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import * as ModelSettings from '@dungsil/dsh-plugin-model-settings'
import * as plugin from '../dist/index.js'

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }
const gitPath = (path) => (process.platform === 'win32' ? path.replaceAll('\\', '/') : path)

async function fixture(t, options = {}, settings = {}) {
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
  let agent
  ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
    root.provide('profileContext', profile)
    root.loader.builtins.editor = ConfigEditor
    root.loader.internal = {
      version: 'v2',
      import: async (specifier) => {
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
    const harness = await mountAgentLoopTestHarness(root)
    agent = await harness.create(SessionId('worktree-ui-test'), options, { cwd: repo })
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
  return { ctx, agent, repo, other, git, rpc, home, profile }
}

await test('owner UI API lists, creates and switches real worktrees without a model or consuming source files', async (t) => {
  const { ctx, agent, repo, other, git, rpc } = await fixture(t)
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
  const created = await rpc('create', { cwd: repo, name: 'fix/login-ui' })
  assert.equal(created.ok, true)
  const path = join(repo, '.agents/worktrees/fix/login-ui')
  assert.equal(created.value.cwd, path)
  assert.ok(created.value.worktrees.some((entry) => entry.path === gitPath(path) && entry.branch === 'fix/login-ui'))
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  assert.equal(git('rev-parse', 'refs/heads/fix/login-ui'), git('rev-parse', 'HEAD'))
  assert.equal(await readFile(join(repo, 'draft.txt'), 'utf8'), 'unsaved source file')
  await assert.rejects(readFile(join(path, 'draft.txt')), { code: 'ENOENT' })

  assert.equal((await rpc('switch', { cwd: repo, path: otherPath })).error.code, 'conflict')
  assert.equal((await rpc('switch', { cwd: path, path: tmpdir() })).error.code, 'invalid')
  assert.equal(ctx.workingDirectory.get(agent.session), path)
  const switched = await rpc('switch', { cwd: path, path: otherPath })
  assert.equal(switched.ok, true)
  assert.equal(switched.value.cwd, other)
  assert.equal((await rpc('switch', { cwd: switched.value.cwd, path: mainPath })).ok, true)
  assert.equal((await rpc('create', { cwd: repo, name: 'fix/login-ui' })).ok, false)
  assert.equal(ctx.workingDirectory.get(agent.session), repo, 'an existing branch cannot change the checkout')
  assert.equal((await rpc('create', { cwd: repo, name: '../escape' })).ok, false)
  assert.equal((await rpc('create', { cwd: repo })).ok, false, 'an empty name requires a selected model')
  const events = agent.session.snapshotEvents()
  assert.equal(events.filter((event) => event.type === 'request/header' || event.type === 'user/message').length, 0)
  assert.equal(events.filter((event) => event.type === 'working-directory/change').length, 3)
})

await test('only an empty name uses the selected model before real creation, without tools or a conversation turn', async (t) => {
  const { ctx, agent, repo, git, rpc } = await fixture(t, { provider: 'fallback', model: 'fallback-model' })
  const requests = []
  let answer = 'fix/session-isolation'
  let reason = { kind: 'stop' }
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream(options) {
      requests.push(options)
      yield { type: 'text-delta', index: 0, text: answer }
      yield { type: 'finish', reason }
    }
  }
  ctx.llm.registerAdapter(['conversation', 'fallback'], new NamingAdapter())
  agent.session.append('turn/start', { turn: 1 })
  agent.session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'Fix session isolation when switching worktrees' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' }
  )
  agent.session.append('request/header', {
    header: { config: { provider: 'conversation', model: 'selected-model' } },
    reason: 'initial',
  })
  const named = await rpc('create', { cwd: repo, name: ' manual-name ' })
  assert.equal(named.ok, true)
  assert.equal(requests.length, 0, 'a supplied name must not incur a model request')
  const mainPath = named.value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd: named.value.cwd, path: mainPath })).ok, true)
  const before = agent.session.deriveMessages()
  const generated = await rpc('create', { cwd: repo, name: '  ' })
  assert.equal(generated.ok, true)
  assert.equal(generated.value.cwd, join(repo, '.agents/worktrees/fix/session-isolation'))
  assert.equal(git('rev-parse', 'refs/heads/fix/session-isolation'), git('rev-parse', 'HEAD'))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].provider, 'conversation')
  assert.equal(requests[0].model, 'selected-model')
  assert.equal(requests[0].tools, undefined)
  assert.match(requests[0].messages[0].content[0].text, /Fix session isolation/)
  assert.deepEqual(agent.session.deriveMessages(), before, 'naming must not append a conversation turn')
  const cwd = generated.value.cwd
  for (const invalid of ['not a branch', 'git worktree add /tmp/evil', '../escape', '']) {
    answer = invalid
    assert.equal((await rpc('create', { cwd })).ok, false)
  }
  answer = 'truncated-name'
  reason = { kind: 'max-tokens' }
  assert.equal((await rpc('create', { cwd })).ok, false)
  assert.equal(ctx.workingDirectory.get(agent.session), cwd)
  assert.deepEqual((await rpc('describe')).value.worktrees.map((entry) => entry.branch).sort(), [
    'fix/session-isolation',
    'main',
    'manual-name',
    null,
  ])
})

await test('automatic naming leaves room for reasoning before the branch name', async (t) => {
  const { ctx, agent, repo, git, rpc } = await fixture(t, { provider: 'reasoning', model: 'reasoner' })
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
  assert.equal(created.value.cwd, join(repo, '.agents/worktrees/fix/reasoning-budget'))
  assert.equal(git('rev-parse', 'fix/reasoning-budget'), git('rev-parse', 'HEAD'))
  assert.equal(requests.length, 1, 'naming must not retry a billable model call')
  assert.equal(requests[0].maxTokens, 4096, 'the model default includes reasoning, not just the visible name')
  assert.equal(requests[0].reasoningEffort, 'high')
  assert.equal(requests[0].tools, undefined)
  assert.deepEqual(agent.session.deriveMessages(), before)
})

await test('refuses non-owners, malformed input, concurrent maintenance, and read-only creation', async (t) => {
  const { ctx, agent, repo, rpc } = await fixture(t)
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
  const mainPath = results.find((result) => result.ok).value.worktrees.find((entry) => entry.branch === 'main').path
  assert.equal((await rpc('switch', { cwd, path: mainPath })).ok, true)
  setSandboxMode(agent.session, 'read-only')
  assert.equal((await rpc('describe')).ok, true, 'read-only policy still permits listing')
  assert.equal((await rpc('create', { cwd: repo, name: 'read-only' })).ok, false)
  assert.equal(ctx.workingDirectory.get(agent.session), repo)
  assert.equal(
    (await rpc('describe')).value.worktrees.some((entry) => entry.branch === 'read-only'),
    false
  )
})

await test('persists settings through Loader reload and uses absolute paths and the tracked remote commit, not local HEAD', async (t) => {
  const { ctx, agent, repo, home, git, rpc, profile } = await fixture(t)
  const initial = (await rpc('settings')).value
  assert.deepEqual(initial.settings, { directory: '.agents/worktrees', remote: false, naming: 'semantic', prefix: '' })
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
  const created = await rpc('create', { cwd: repo, name: 'remote-base' })
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
  const relative = await rpc('create', { cwd: nested, name: 'local-base' })
  assert.equal(relative.ok, true)
  assert.equal(relative.value.cwd, join(home, 'relative pool/local-base'))
  assert.equal(git('rev-parse', 'local-base'), git('rev-parse', 'main'))
  assert.equal(await readFile(join(relative.value.cwd, 'local-only.txt'), 'utf8'), 'not on remote')
})

await test('saved DSH and custom prefixes affect generated names only; invalid settings and missing upstream never create branches', async (t) => {
  const { ctx, repo, git, rpc } = await fixture(t, { provider: 'namer', model: 'small' })
  let modelCalls = 0
  class NamingAdapter extends LlmAdapter {
    async resolveModel(provider, model) {
      return { provider, id: model, name: model }
    }
    async *stream() {
      modelCalls++
      yield { type: 'text-delta', index: 0, text: 'task-name' }
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
    const created = await rpc('create', { cwd: repo })
    assert.equal(created.ok, true)
    assert.equal(created.value.cwd, join(repo, '.agents/worktrees', branch))
    assert.equal(git('rev-parse', branch), git('rev-parse', 'HEAD'))
    assert.equal((await rpc('switch', { cwd: created.value.cwd, path: gitPath(repo) })).ok, true)
  }
  const manual = await rpc('create', { cwd: repo, name: 'explicit-name' })
  assert.equal(manual.ok, true)
  assert.equal(manual.value.cwd, join(repo, '.agents/worktrees/explicit-name'))
  assert.equal(modelCalls, 2)
  assert.equal((await rpc('switch', { cwd: manual.value.cwd, path: gitPath(repo) })).ok, true)
  const view = (await rpc('settings')).value
  for (const change of [
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
  assert.equal((await rpc('create', { cwd: repo, name: 'no-upstream' })).ok, false)
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads/no-upstream'), '')
  assert.equal((await rpc('describe')).value.cwd, repo)
})

await test('configured hooks and checkout filters do not execute while creating a worktree', async (t) => {
  const { repo, home, git, rpc } = await fixture(t)
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
  const result = await rpc('create', { cwd: repo, name: 'safe-checkout' })
  assert.equal(result.ok, true)
  assert.equal(await readFile(join(result.value.cwd, 'tracked.txt'), 'utf8'), 'original content\n')
  await assert.rejects(readFile(marker), { code: 'ENOENT' })
})

await test('task model and worktree settings coexist across profile reloads, reject stale writes and reset to the conversation model', async (t) => {
  const initialSettings = { directory: '../naming pool', remote: true, naming: 'custom', prefix: 'team/' }
  const { ctx, agent, repo, home, git, rpc, profile } = await fixture(
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
      requests.push(options)
      yield { type: 'text-delta', index: 0, text: answer }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['naming', 'conversation', 'fallback'], new NamingAdapter())
  await ctx.plugin(ModelSettings)
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

  const manual = await rpc('create', { cwd: repo, name: 'manual' })
  assert.equal(manual.ok, true)
  assert.equal(requests.length, 0, 'saving a model and supplying a branch name must not generate text')
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
    const created = await rpc('create', { cwd: repo })
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
  const autoNamed = await rpc('create', { cwd: repo })
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
  const inherited = await rpc('create', { cwd: repo })
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
