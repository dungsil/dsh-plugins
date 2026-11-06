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
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import SandboxLocal from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import * as ModelSettings from '@dungsil/dsh-plugin-model-settings'
import * as plugin from '../dist/index.js'
import OfficialWorktreeService from '@deepseek-ai/dsh-experimental-worktree'

await test('브랜치 모델 설정 코덱은 모든 쓰기에 로컬 상태를 기록하고 사용하지 않는 라우트와 추론 강도를 제거한다', () => {
  const definition = plugin.modelSettingsDefinition
  assert.equal(definition.key, 'branch-name')
  for (const locale of ['en', 'ko', 'zh'])
    for (const field of ['label', 'description', 'automaticReasoningLabel']) assert.ok(definition[field][locale])
  const legacy = { naming: 'semantic', provider: 'namer', model: 'small', reasoningEffort: 'quick', remote: true }
  assert.deepEqual(definition.read(legacy), {
    selection: { mode: 'model', route: { provider: 'namer', model: 'small' }, reasoningEffort: 'quick' },
    instructions: null,
  })
  for (const mode of ['auxiliary', 'conversation']) {
    const saved = definition.write(legacy, { selection: { mode }, instructions: 'Local branch instructions.' })
    assert.deepEqual(saved, {
      naming: 'semantic',
      remote: true,
      modelSettings: { inherit: mode, instructions: 'Local branch instructions.' },
    })
    assert.deepEqual(definition.read(saved), { selection: { mode }, instructions: 'Local branch instructions.' })
  }
  const automatic = definition.write(legacy, {
    selection: { mode: 'model', route: { provider: 'namer', model: 'other' }, reasoningEffort: null },
    instructions: null,
  })
  assert.deepEqual(automatic, {
    naming: 'semantic',
    remote: true,
    provider: 'namer',
    model: 'other',
    modelSettings: { inherit: 'auxiliary' },
  })
  assert.deepEqual(definition.read({ provider: 'partial', reasoningEffort: 'stale' }), {
    selection: { mode: 'auxiliary' },
    instructions: null,
  })
  assert.equal(definition.defaultInstructions({}), definition.defaultInstructions({ naming: 'semantic' }))
  assert.ok(definition.defaultInstructions({ naming: 'semantic' }).includes('semantic Git branch'))
  for (const naming of ['dsh', 'custom']) assert.ok(definition.defaultInstructions({ naming }).includes('task slug'))
  assert.equal(legacy.reasoningEffort, 'quick')
})

const owner = { principal: { kind: 'owner' }, interactions: 'answer' }

async function fixture(
  t,
  options = {},
  settings = {},
  taskModels,
  patchUrl = new URL('../cordis.patch.yml', import.meta.url)
) {
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
  initProfile(dir, ['test-bundle', 'test-extension'])
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
          { id: 'worktree', name: '@deepseek-ai/dsh-experimental-worktree' },
          {
            id: 'optional-forge-panel',
            name: 'cordis:group',
            group: true,
            isolate: { worktrees: true },
            config: [
              { id: 'forge-worktree', name: '@deepseek-ai/dsh-experimental-worktree' },
              { id: 'forge-panel', name: 'fixture-forge-panel' },
            ],
          },
          ...(taskModels
            ? [{ id: 'task-models', name: '@dungsil/dsh-plugin-model-settings', config: taskModels }]
            : []),
        ],
      },
    ])
  )
  const officialFixture = await readFile(join(bundle, 'cordis.patch.yml'), 'utf8')
  const extensionPatch = await readFile(patchUrl, 'utf8')
  await writeFile(join(bundle, 'cordis.patch.yml'), `${officialFixture}\n`) // first bundle supplies Forge's public isolation topology
  const extensionBundle = join(dir, 'node_modules/test-extension')
  await mkdir(extensionBundle, { recursive: true })
  await writeFile(
    join(extensionBundle, 'package.json'),
    JSON.stringify({ name: 'test-extension', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } })
  )
  await writeFile(
    join(extensionBundle, 'cordis.patch.yml'),
    `${extensionPatch}\n- id: dungsil-ui-worktree\n  config: ${JSON.stringify(settings)}\n`
  )
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile = {
    name: 'web',
    startedBundles: ['test-bundle', 'test-extension'],
    dir,
    patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'),
    cwd: repo,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  let agent, harness, panelWorktrees
  const requests = []
  const resolutions = []
  ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
    root.provide('profileContext', profile)
    root.loader.builtins.editor = ConfigEditor
    root.loader.internal = {
      version: 'v2',
      import: async (specifier) => {
        if (specifier === '@deepseek-ai/dsh-experimental-worktree') return { default: OfficialWorktreeService }
        if (specifier === 'fixture-forge-panel')
          return {
            inject: ['worktrees'],
            apply(child) {
              panelWorktrees = child.worktrees
            },
          }
        if (specifier === '@dungsil/dsh-plugin-model-settings') return ModelSettings
        if (specifier === '@dungsil/dsh-plugin-ui-worktree') return plugin
        // Other preset features are not under test; load inert plugins while composing the real patch.
        assert.ok(specifier.startsWith('@dungsil/dsh-plugin-'))
        return { apply() {} }
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
        yield { type: 'text-delta', index: 0, text: 'feat/forge-extension' }
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
  assert.ok(panelWorktrees instanceof plugin.default)
  assert.notEqual(panelWorktrees, ctx.worktrees)
  return { ctx, worktrees: panelWorktrees, agent, repo, git, rpc, requests, archive }
}

await test('preset-ui의 실제 patch도 루트 worktrees를 유지하고 공식 격리 안에서만 서비스를 교체한다', async (t) => {
  const { ctx, worktrees } = await fixture(
    t,
    {},
    {},
    undefined,
    new URL('../../preset-ui/cordis.patch.yml', import.meta.url)
  )
  assert.equal(Object.getPrototypeOf(ctx.worktrees).constructor, OfficialWorktreeService)
  assert.equal(Object.getPrototypeOf(worktrees).constructor, plugin.default)
})

await test('공식 worktrees 서비스에 AI 이름 요청을 전달하고 자체 예약 API를 등록하지 않는다', async (t) => {
  const { ctx, worktrees, agent, repo, git, rpc, requests } = await fixture(t)
  assert.equal((await rpc('select', { cwd: repo, choice: 'new' })).status, 404)
  const result = await worktrees.create(agent, { name: 'dsh-generated-placeholder' })
  assert.equal(result.branch, 'feat/forge-extension')
  assert.equal(ctx.workingDirectory.get(agent.session), result.path)
  assert.equal(requests.length, 1)
  assert.match(git('worktree', 'list', '--porcelain'), /feat\/forge-extension/)
  git('worktree', 'remove', '--', result.path)
  const restored = await worktrees.restore(agent, result)
  assert.equal(restored.path, result.path)
  assert.equal(restored.branchRecreated, false)
  assert.equal(requests.length, 1)
  assert.equal(ctx.workingDirectory.get(agent.session), result.path)
})

await test('원격 기준 설정이 없으면 공식 생성기는 HEAD를 유지하고 보관 시 브랜치를 삭제하지 않는다', async (t) => {
  const { ctx, worktrees, agent, git, archive } = await fixture(t, {}, { deleteOnArchive: true })
  const head = git('rev-parse', 'HEAD')
  const result = await worktrees.create(agent)
  assert.equal(result.baseCommit, head)
  await archive()
  assert.equal(git('rev-parse', 'refs/heads/feat/forge-extension'), head)
  assert.doesNotMatch(git('worktree', 'list', '--porcelain'), /feat\/forge-extension/)
  assert.equal(ctx.workingDirectory.get(agent.session), result.path)
  await worktrees.restore(agent, result)
  assert.match(git('worktree', 'list', '--porcelain'), /feat\/forge-extension/)
})

await test('원격 기준을 켜고 upstream이 없으면 공식 Git 생성 전 실패한다', async (t) => {
  const { worktrees, agent, git } = await fixture(t, {}, { remote: true })
  await assert.rejects(worktrees.create(agent), /Worktree command failed/)
  assert.equal(git('branch', '--list', 'feat/forge-extension'), '')
})

await test('명시한 공식 from은 원격 기본값보다 우선하며 진행 단계는 공식 콜백을 따른다', async (t) => {
  const { worktrees, agent, git } = await fixture(t, {}, { remote: true })
  const base = git('rev-parse', 'HEAD')
  const phases = []
  const result = await worktrees.create(agent, { from: base }, undefined, (phase) => phases.push(phase))
  assert.equal(result.baseCommit, base)
  assert.deepEqual(phases, ['prepare', 'checkout'])
})

await test('원격 기본값은 fetch 없이 현재 upstream 커밋을 사용한다', async (t) => {
  const { worktrees, agent, git } = await fixture(t, {}, { remote: true })
  const upstream = git('rev-parse', 'HEAD')
  git('config', 'remote.origin.url', 'https://example.invalid/never-fetch.git')
  git('config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*')
  git('update-ref', 'refs/remotes/origin/main', upstream)
  git('config', 'branch.main.remote', 'origin')
  git('config', 'branch.main.merge', 'refs/heads/main')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'local')
  const result = await worktrees.create(agent)
  assert.equal(result.baseCommit, upstream)
  assert.notEqual(result.baseCommit, git('rev-parse', 'HEAD'))
})

await test('취소한 이름 생성 요청은 Git 브랜치와 체크아웃을 만들지 않는다', async (t) => {
  const { worktrees, agent, git } = await fixture(t)
  await assert.rejects(worktrees.create(agent, {}, AbortSignal.abort(new Error('취소'))))
  assert.equal(git('branch', '--list', 'feat/forge-extension'), '')
})

await test('보관 시 미추적 파일이 있는 워크트리는 강제 삭제하지 않는다', async (t) => {
  const { worktrees, agent, git, archive } = await fixture(t, {}, { deleteOnArchive: true })
  const result = await worktrees.create(agent)
  await writeFile(join(result.path, 'keep.txt'), 'preserve')
  await archive()
  assert.match(git('worktree', 'list', '--porcelain'), /feat\/forge-extension/)
  assert.equal(await readFile(join(result.path, 'keep.txt'), 'utf8'), 'preserve')
})

await test('보관 정리를 끈 기본 설정은 생성한 워크트리도 삭제하지 않는다', async (t) => {
  const { worktrees, agent, git, archive } = await fixture(t)
  await worktrees.create(agent)
  await archive()
  assert.match(git('worktree', 'list', '--porcelain'), /feat\/forge-extension/)
})
