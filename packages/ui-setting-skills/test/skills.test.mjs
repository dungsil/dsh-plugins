import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import * as plugin from '../dist/index.js'

const method = 'dungsil-ui-setting-skills/list'
const url = `http://localhost/api/${method}`
const owner = { principal: { kind: 'owner' }, interactions: 'answer' }

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dsh-skills-test-'))
  const dsh = join(home, 'dsh')
  const agents = join(home, 'agents')
  const previousEnv = Object.fromEntries(
    ['DSH_HOME', 'DSH_AGENTS_HOME', 'DSH_BUNDLED_SKILL_DIR'].map((key) => [key, process.env[key]])
  )
  process.env.DSH_HOME = dsh
  process.env.DSH_AGENTS_HOME = agents
  delete process.env.DSH_BUNDLED_SKILL_DIR
  const ctx = new Context()
  t.after(async () => {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  await ctx.plugin(LocalCredentialProvider, { path: join(home, 'credentials.yaml'), watch: false })
  await ctx.plugin(Connection)
  const fiber = await ctx.plugin(plugin)
  const handler = ctx.connection.createSharedFetchHandler('/api')
  const fetch = (body, peer = owner) =>
    handler.fetch(
      new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      peer
    )
  const request = { type: 'client-request', rpcId: 'skills-test', method, payload: {} }
  const skill = async (root, name, description, extra = '') => {
    const path = join(root, 'skills', name, 'SKILL.md')
    await mkdir(join(root, 'skills', name), { recursive: true })
    await writeFile(path, `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nPrivate body\n`)
    return path
  }
  return {
    home,
    dsh,
    agents,
    skill,
    fiber,
    fetch,
    request,
    rpc: async () => (await (await fetch(request)).json()).result,
  }
}

await test('discovers both user roots without a global skill registry, including duplicates and symlinked skills', async (t) => {
  const h = await fixture(t)
  const dshPath = await h.skill(h.dsh, 'planning-work', 'DSH entry')
  const sharedPath = await h.skill(
    h.agents,
    'planning-work',
    'Shared entry',
    'disable-model-invocation: true\nuser-invocable: false\n'
  )
  const linkedPath = await h.skill(h.home, 'reviewing-code', 'Linked entry')
  await symlink(join(h.home, 'skills', 'reviewing-code'), join(h.agents, 'skills', 'reviewing-code'), 'junction')
  // These files must follow the same exclusions and YAML validation as DSH.
  await h.skill(join(h.home, '.agents'), 'project-only', 'Must not be listed')
  await h.skill(join(h.dsh, 'skills', '.system'), 'system-only', 'Must not be listed')
  await writeFile(join(h.agents, 'skills', 'invalid.md'), 'No frontmatter')
  const response = await h.fetch(h.request)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), {
    type: 'server-response',
    rpcId: 'skills-test',
    result: {
      ok: true,
      value: {
        complete: true,
        skills: [
          {
            name: 'planning-work',
            source: 'user-dsh',
            description: 'DSH entry',
            path: dshPath,
          },
          {
            name: 'planning-work',
            source: 'user-agents',
            description: 'Shared entry',
            path: sharedPath,
          },
          {
            name: 'reviewing-code',
            source: 'user-agents',
            description: 'Linked entry',
            path: linkedPath,
          },
        ],
      },
    },
  })
})

await test('returns empty missing roots and rereads additions and removals on the next request', async (t) => {
  const h = await fixture(t)
  assert.deepEqual(await h.rpc(), { ok: true, value: { complete: true, skills: [] } })
  const path = await h.skill(h.dsh, 'planning-work', 'New entry')
  assert.deepEqual((await h.rpc()).value.skills, [
    { name: 'planning-work', description: 'New entry', source: 'user-dsh', path },
  ])
  await rm(path)
  assert.deepEqual(await h.rpc(), { ok: true, value: { complete: true, skills: [] } })
})

await test('rejects non-owner requests and malformed envelopes, and removes the route on unload', async (t) => {
  const h = await fixture(t)
  for (const principal of [{ kind: 'anonymous' }, { kind: 'session', sessionId: 'shared' }]) {
    assert.equal((await h.fetch(h.request, { principal, interactions: 'deny' })).status, 403)
  }
  for (const body of ['{', {}, { ...h.request, method: 'other' }]) {
    assert.equal((await h.fetch(body)).status, 400)
  }
  await h.fiber.dispose()
  assert.equal((await h.fetch(h.request)).status, 404)
})

await test('all UI strings have English, Korean and Chinese translations', async () => {
  const locales = await Promise.all(
    ['en', 'ko', 'zh'].map(async (language) =>
      JSON.parse(await readFile(new URL(`../locale/${language}.json`, import.meta.url), 'utf8'))
    )
  )
  for (const locale of locales) {
    assert.deepEqual(Object.keys(locale.ui).sort(), Object.keys(locales[0].ui).sort())
    assert.ok(Object.values(locale.ui).every((value) => typeof value === 'string' && value.trim()))
  }
})
