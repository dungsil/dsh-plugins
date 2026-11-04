import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import * as plugin from '../dist/index.js'

test('owner creates directly; only a missing name uses the model, without tools or a conversation turn', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'ui-worktree-'))
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  await ctx.plugin(Llm)
  const requests = []
  let answer = 'fix-session-isolation'
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
  ctx.llm.registerAdapter(['conversation'], new NamingAdapter())
  const session = Session.create(SessionId('session-a'))
  session.append('turn/start', { turn: 1 })
  session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'Fix session isolation when switching worktrees' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' }
  )
  session.append('request/header', {
    header: { config: { provider: 'conversation', model: 'selected-model' } },
    reason: 'initial',
  })
  let maintaining = false
  let busy = false
  const agent = {
    id: session.id,
    session,
    options: {},
    async runMaintenance(task) {
      if (busy || maintaining) throw new Error('Agent is busy')
      maintaining = true
      try {
        return await task(new AbortController().signal)
      } finally {
        maintaining = false
      }
    },
  }
  ctx.provide('agents', { get: (id) => (id === session.id ? agent : undefined) })
  const branches = new Set()
  ctx.provide('worktrees', {
    async create(caller, { name }, signal) {
      assert.equal(maintaining, true)
      assert.equal(caller, agent)
      signal.throwIfAborted()
      if (branches.has(name)) throw new Error('Branch exists')
      branches.add(name)
      return { branch: name, path: `/repo/.worktrees/${name}`, baseCommit: 'baseline', repositoryRoot: '/repo' }
    },
  })
  await ctx.plugin(plugin)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const rpc = async (name, peer = { principal: { kind: 'owner' }, interactions: 'answer' }, id = session.id) => {
    const response = await handler.fetch(
      new Request('http://localhost/api/dungsil-ui-worktree/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId: 'test',
          method: 'dungsil-ui-worktree/create',
          payload: { sessionId: id, name },
        }),
      }),
      peer
    )
    return response.status === 200 ? (await response.json()).result : { status: response.status }
  }
  const before = session.snapshotEvents()
  const named = await rpc(' feature/한글 ')
  assert.equal(named.ok, true)
  assert.equal(named.value.branch, 'feature/한글')
  assert.equal(requests.length, 0, 'a supplied name must not incur a model request')
  const generated = await rpc('  ')
  assert.equal(generated.ok, true)
  assert.equal(generated.value.branch, 'fix-session-isolation')
  assert.equal(generated.value.path, '/repo/.worktrees/fix-session-isolation')
  assert.equal(requests.length, 1)
  assert.equal(requests[0].model, 'selected-model')
  assert.equal(requests[0].tools, undefined)
  assert.match(requests[0].messages[0].content[0].text, /Fix session isolation/)
  assert.deepEqual(session.snapshotEvents(), before, 'naming must not append a conversation turn')
  assert.equal((await rpc('feature/한글')).error.code, 'create_failed', 'collisions must not report success')
  for (const invalid of ['not a branch', 'git worktree add /tmp/evil', '../escape', '']) {
    answer = invalid
    assert.equal((await rpc('')).error.code, 'create_failed')
  }
  answer = 'truncated-name'
  reason = { kind: 'max-tokens' }
  assert.equal((await rpc('')).error.code, 'create_failed')
  assert.deepEqual([...branches], ['feature/한글', 'fix-session-isolation'])
  busy = true
  assert.equal((await rpc('busy-name')).error.code, 'create_failed')
  busy = false
  assert.equal((await rpc('no-session', undefined, 'missing')).error.code, 'unavailable')
  assert.equal((await rpc('forbidden', { principal: { kind: 'anonymous' }, interactions: 'deny' })).status, 403)
  assert.equal((await rpc(123)).error.code, 'invalid')
  assert.equal((await rpc('a'.repeat(201))).error.code, 'invalid')
})
