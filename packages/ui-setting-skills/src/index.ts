import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-cot-translation'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'
import { channel, method, saveMethod, translateMethod, type SkillsView } from './protocol.js'

export const name = 'dungsil-ui-setting-skills'
export const inject = ['connection', 'configEditor']
export const Config = z.object({ disabled: z.array(z.string()).default([]) })

export function apply(ctx: Context, config: { disabled?: string[] } = {}) {
  const editor = ctx.configEditor
  const cacheDir = dshCachePath('dungsil-ui-setting-skills', 'translations-v1')
  const entry = () => editor.entries().find((entry) => entry.options.name === '@dungsil/dsh-plugin-ui-setting-skills')
  // Read the live Loader config even from handles retained across configuration reloads.
  const disabled = (): string[] => (entry()?.options.config?.disabled as string[] | undefined) ?? config.disabled ?? []
  // DSH also reads raw registries through ctx.get() and preset serviceFor(), bypassing
  // internal/get hooks. Cover every registry instance, including isolated presets.
  ctx.effect(() => {
    const prototype = SkillRegistry.prototype
    // Keep the original receiver unbound; each registry supplies it via call() below.
    // oxlint-disable-next-line typescript/unbound-method
    const originalSnapshot = prototype.snapshot
    // oxlint-disable-next-line typescript/unbound-method
    const originalGet = prototype.get
    const snapshot: SkillRegistry['snapshot'] = async function (this: SkillRegistry, options) {
      const result = await originalSnapshot.call(this, options)
      return { ...result, skills: result.skills.filter((skill) => !disabled().includes(skill.name)) }
    }
    const get: SkillRegistry['get'] = async function (this: SkillRegistry, name, options) {
      if (disabled().includes(name)) return undefined
      const result = await originalGet.call(this, name, options)
      return disabled().includes(name) ? undefined : result
    }
    prototype.snapshot = snapshot
    prototype.get = get
    return () => {
      if (prototype.snapshot === snapshot) prototype.snapshot = originalSnapshot
      if (prototype.get === get) prototype.get = originalGet
    }
  }, 'ui-setting-skills: DSH registry visibility')
  const lifetime = new AbortController()
  // Web profiles mount filesystem skills inside agent scopes, not the global registry.
  // Reuse host discovery without registering a provider or changing any agent's skills.
  const provider = new FileSystemSkillProvider(ctx, { signal: lifetime.signal, invalidate() {} }, { watch: false })
  ctx.effect(
    () => async () => {
      lifetime.abort()
      await provider.dispose()
    },
    'ui-setting-skills: dispose discovery'
  )
  // Exact Connection routes are owner-only, unlike shared session RPC handlers.
  for (const endpoint of [method, saveMethod, translateMethod])
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: `${channel}/${endpoint}`,
          methods: ['POST'],
          requestBody: 'buffered',
          async fetch(request) {
            let body
            try {
              body = clientRequestSchema.safeParse(await request.json())
            } catch {
              return new Response('Invalid request', { status: 400 })
            }
            if (!body.success || body.data.method !== endpoint) return new Response('Invalid request', { status: 400 })
            if (endpoint === translateMethod) {
              const payload = body.data.payload as { path?: unknown; language?: unknown }
              if (!payload || typeof payload.path !== 'string' || typeof payload.language !== 'string') {
                return new Response('Invalid request', { status: 400 })
              }
              let result
              try {
                const signal = AbortSignal.any([request.signal, lifetime.signal])
                const translator = ctx.get('cotTranslation')
                if (!translator) throw new Error('Translation unavailable')
                const observation = await provider.list({ signal })
                const candidates = 'candidates' in observation ? observation.candidates : observation
                const skill = candidates.find(
                  (skill) => skill.path === payload.path && ['user-agents', 'user-dsh'].includes(skill.source)
                )
                if (!skill) throw new Error('Unknown user skill')
                const { preferences } = await translator.limits(signal)
                const targetLanguage =
                  preferences.targetLanguage === 'auto' ? payload.language : preferences.targetLanguage
                const key = createHash('sha256')
                  .update(JSON.stringify([preferences.provider, targetLanguage, skill.description]))
                  .digest('hex')
                const cachePath = join(cacheDir, `${key}.json`)
                let value: string | undefined
                try {
                  const cached: unknown = JSON.parse(await readFile(cachePath, 'utf8'))
                  if (typeof cached === 'string') value = cached
                } catch {
                  // Missing or damaged cache entries are retried through the selected provider.
                }
                signal.throwIfAborted()
                if (value === undefined) {
                  value = await translator.translate(
                    { text: skill.description, provider: preferences.provider, targetLanguage },
                    signal
                  )
                  signal.throwIfAborted()
                  try {
                    await writeFileAtomic(cachePath, JSON.stringify(value), { mode: 0o600, dirMode: 0o700 })
                  } catch {
                    ctx.logger.warn('Could not cache skill description translation')
                  }
                }
                signal.throwIfAborted()
                result = { ok: true as const, value }
              } catch {
                result = {
                  ok: false as const,
                  error: { code: 'translation_failed', message: 'Could not translate skill description.', details: {} },
                }
              }
              return Response.json(
                { type: 'server-response', rpcId: body.data.rpcId, result },
                { headers: { 'Cache-Control': 'no-store' } }
              )
            }
            if (endpoint === saveMethod) {
              const payload = body.data.payload as { name?: unknown; disabled?: unknown }
              if (!payload || typeof payload.name !== 'string' || typeof payload.disabled !== 'boolean') {
                return new Response('Invalid request', { status: 400 })
              }
              let result
              try {
                const target = entry()
                if (!target) throw new Error('Settings entry unavailable')
                const observation = await provider.list({ signal: request.signal })
                const candidates = 'candidates' in observation ? observation.candidates : observation
                if (
                  !candidates.some(
                    (skill) => skill.name === payload.name && ['user-agents', 'user-dsh'].includes(skill.source)
                  )
                ) {
                  throw new Error('Unknown user skill')
                }
                await editor.edit(target, (current) => {
                  const names = (current.disabled as string[] | undefined) ?? []
                  return {
                    ...current,
                    disabled: payload.disabled
                      ? [...new Set([...names, payload.name])]
                      : names.filter((name) => name !== payload.name),
                  }
                })
                ctx.emit('skills/change')
                result = { ok: true as const, value: { disabled: disabled() } }
              } catch {
                result = {
                  ok: false as const,
                  error: { code: 'save_failed', message: 'Could not save skill settings.', details: {} },
                }
              }
              return Response.json(
                { type: 'server-response', rpcId: body.data.rpcId, result },
                { headers: { 'Cache-Control': 'no-store' } }
              )
            }
            let result
            try {
              const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(15_000)])
              // No cwd: project skills are intentionally outside this settings page.
              const observation = await provider.list({ signal })
              signal.throwIfAborted()
              const skills = 'candidates' in observation ? observation.candidates : observation
              const value: SkillsView = {
                translationAvailable: !!ctx.get('cotTranslation'),
                disabled: disabled(),
                complete: 'candidates' in observation ? observation.complete : true,
                skills: skills.flatMap((skill) =>
                  skill.source === 'user-agents' || skill.source === 'user-dsh'
                    ? [
                        {
                          name: skill.name,
                          description: skill.description,
                          source: skill.source === 'user-agents' ? 'user-agents' : 'user-dsh',
                          path: skill.path,
                        },
                      ]
                    : []
                ),
              }
              result = { ok: true as const, value }
            } catch {
              result = {
                ok: false as const,
                error: { code: 'load_failed', message: 'Could not load skills.', details: {} },
              }
            }
            return Response.json(
              { type: 'server-response', rpcId: body.data.rpcId, result },
              { headers: { 'Cache-Control': 'no-store' } }
            )
          },
        }),
      'ui-setting-skills: owner-only list'
    )
}
