import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Titles from '@deepseek-ai/dsh-session-title'
import * as FirstPrompt from '@deepseek-ai/dsh-session-title-first-prompt-llm'
import * as AllPrompts from '@deepseek-ai/dsh-session-title-all-prompts-llm'
import * as plugin from '../dist/index.js'

export const owner = { principal: { kind: 'owner' }, interactions: 'answer' }
export const titleConfig = {
  targetWords: 7,
  targetCjkCharacters: 13,
  maxInputBytes: 4096,
  maxOutputTokens: 256,
  timeoutMs: 5000,
}

class RecordingAdapter extends LlmAdapter {
  requests = []
  async listModels(provider) {
    return [
      { provider, id: 'chat-large', name: 'Chat Large' },
      { provider, id: 'title-small', name: 'Title Small' },
    ]
  }
  async resolveModel(provider, model) {
    if (!['chat-large', 'title-small'].includes(model)) throw new Error('Unavailable model')
    return { provider, id: model, name: model }
  }
  async *stream(options) {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: '모델 설정 구현' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Real profile persistence, Loader reconciliation, title service and LLM routing. */
export async function profileFixture(strategy = 'first-prompt', initialRoute = {}) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-model-settings-'))
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"test-installation"}\n')
  await writeFile(
    join(bundle, 'package.json'),
    JSON.stringify({
      name: 'test-bundle',
      version: '1.0.0',
      dsh: { bundle: { patch: 'cordis.patch.yml' } },
    })
  )
  const providerName = `@deepseek-ai/dsh-session-title-${strategy}-llm`
  await writeFile(
    join(bundle, 'cordis.patch.yml'),
    JSON.stringify([
      {
        insert: [
          { id: 'editor', name: 'cordis:editor' },
          { id: 'custom-title-entry', name: providerName, config: { ...titleConfig, ...initialRoute } },
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
    cwd: home,
    home,
    overlays: [],
    telemetryDisabledEnv: undefined,
  }
  let ctx
  let adapter
  let handler
  const start = async () => {
    ctx = await boot('dsh', join(dir, 'cordis.yml'), readProfilePatches('dsh', profile), async (root) => {
      root.provide('profileContext', profile)
      root.provide('appReady', {
        onReady: (listener) => {
          listener()
          return () => {}
        },
      })
      root.loader.builtins.editor = ConfigEditor
      root.loader.internal = {
        version: 'v2',
        import: async (specifier) => {
          if (specifier === providerName) return strategy === 'first-prompt' ? FirstPrompt : AllPrompts
          throw new Error(`Unexpected import: ${specifier}`)
        },
      }
      await root.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
      await root.plugin(Connection)
      await root.plugin(Llm)
      await root.plugin(Sessions)
      await root.plugin(Projections)
      await root.plugin(AgentRegistry)
      await root.plugin(Titles, { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 })
      adapter = new RecordingAdapter()
      root.llm.registerAdapter(['conversation', 'auxiliary'], adapter)
    })
    await ctx.plugin(plugin)
    handler = ctx.connection.createSharedFetchHandler('/api')
  }
  const close = async () => {
    await ctx?.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
  try {
    await start()
  } catch (error) {
    await close()
    throw error
  }
  return {
    get ctx() {
      return ctx
    },
    get adapter() {
      return adapter
    },
    profile,
    close,
    restart: async () => {
      await ctx.fiber.dispose()
      await start()
    },
    fetch: (request, peer = owner) => handler.fetch(request, peer),
    async rpc(endpoint, payload = {}, peer = owner) {
      const method = `dungsil-model-settings/${endpoint}`
      const response = await handler.fetch(
        new Request(`http://localhost/api/${method}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: 'test', method, payload }),
        }),
        peer
      )
      if (response.status !== 200) return { status: response.status }
      return (await response.json()).result
    },
    async generate(id) {
      const session = ctx.sessions.create(SessionId(id))
      session.append('turn/start', { turn: 1 })
      session.append(
        'user/message',
        createUserMessage({
          content: [{ type: 'text', text: '세션 제목에 사용할 모델을 설정해 주세요' }],
          source: { kind: 'user' },
        }),
        { surfaceOp: 'append' }
      )
      session.append('request/header', {
        header: { config: { provider: 'conversation', model: 'chat-large' } },
        reason: 'initial',
      })
      await ctx.sessionTitle.refresh(session)
      return session
    },
  }
}
