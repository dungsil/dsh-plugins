import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parse } from 'yaml'
import type { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-experimental-client-ui-cot-translation'
import { dshCachePath } from '@deepseek-ai/dsh-home-paths'
import { canOpenNativePath, openNativePath } from '@deepseek-ai/dsh-native-command'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import z from '@deepseek-ai/schemastery'
import {
  channel,
  method,
  openFolderMethod,
  saveMethod,
  sourceMethod,
  translateMethod,
  type SkillsView,
} from './protocol.js'
import { matchesTargetLanguage } from './language.js'

export const name = 'dungsil-ui-setting-skills'
export const inject = ['connection', 'configEditor']
export const Config = z.object({ disabled: z.array(z.string()).default([]) })

async function readDisplay(path: string | undefined, signal: AbortSignal) {
  if (!path || basename(path) !== 'SKILL.md') return undefined
  try {
    const metadataPath = join(dirname(path), 'agents', 'openai.yaml')
    const info = await stat(metadataPath)
    if (!info.isFile() || info.size > 64 * 1024) return undefined
    const value: unknown = parse(await readFile(metadataPath, { encoding: 'utf8', signal }))
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const surface: unknown = Reflect.get(value, 'interface')
    if (!surface || typeof surface !== 'object' || Array.isArray(surface)) return undefined
    const text = (key: string) => {
      const field: unknown = Reflect.get(surface, key)
      return typeof field === 'string' && /[\p{L}\p{N}\p{P}\p{S}]/u.test(field) ? field.trim() : undefined
    }
    const name = text('display_name')
    const description = text('short_description')
    return name || description ? { ...(name && { name }), ...(description && { description }) } : undefined
  } catch {
    return undefined
  }
}

/** Only sources the settings page manages can be disabled; same-name catalog entries stay visible. */
const isUserSource = (source: string) => source === 'user-agents' || source === 'user-dsh'

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
      const off = disabled()
      return {
        ...result,
        skills: result.skills.filter((skill) => !(off.includes(skill.name) && isUserSource(skill.source))),
      }
    }
    const get: SkillRegistry['get'] = async function (this: SkillRegistry, name, options) {
      const result = await originalGet.call(this, name, options)
      return result !== undefined && isUserSource(result.source) && disabled().includes(name) ? undefined : result
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
  // All paths and preset identities originate in host registries; the browser sends only IDs.
  type Scope = NonNullable<Parameters<SkillRegistry['snapshot']>[0]>['scope']
  type Presets = {
    defaultId: string
    list(): Promise<{ id: string; name?: string; broken?: string }[]>
    acquireScope(id: string): Promise<{ key: Scope } & AsyncDisposable>
  }
  type Workspace = { id: string; title: string; path: string; status(): Promise<'ok' | 'missing-dir'> }
  const service = <T>(name: string): T | undefined =>
    (ctx.get as (name: string) => unknown).call(ctx, name) as T | undefined
  const waitForSignal = async <T>(pending: Promise<T>, signal: AbortSignal): Promise<T> => {
    return await new Promise<T>((resolve, reject) => {
      const abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      pending
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort))
        .catch(() => {})
      if (signal.aborted) abort()
    })
  }
  const resolveContext = async (
    selection: { workspaceId?: unknown; presetId?: unknown },
    signal: AbortSignal,
    report?: (context: NonNullable<SkillsView['contexts']>) => void
  ) => {
    const workspaceRegistry = service<{ list(): Workspace[] }>('workspaceRegistry')
    if (!workspaceRegistry) throw new Error('Workspace registry unavailable')
    const workspaceEntities = workspaceRegistry.list()
    const workspaces = workspaceEntities.map((workspace) => ({
      id: workspace.id,
      title: workspace.title,
      path: workspace.path,
    }))
    const presets = service<Presets>('agentPresets')
    const rows = presets ? await waitForSignal(presets.list(), signal) : []
    const defaultDirectory = service<{ defaultDirectory: string }>('workingDirectory')?.defaultDirectory
    const workspaceId = selection.workspaceId === undefined ? (workspaces[0]?.id ?? '') : selection.workspaceId
    const presetId = selection.presetId === undefined ? (presets?.defaultId ?? '') : selection.presetId
    if (typeof workspaceId !== 'string' || typeof presetId !== 'string') throw new Error('Invalid catalog context')
    const workspace = workspaces.find((item) => item.id === workspaceId)
    // The empty workspace is valid only when there are no registered workspaces.
    const cwd = workspace?.path ?? (workspaceId === '' && workspaces.length === 0 ? defaultDirectory : undefined)
    report?.({ workspaces, presets: rows, workspaceId, presetId, cwd: cwd ?? '' })
    if (!cwd || (presetId && !rows.some((item) => item.id === presetId))) throw new Error('Catalog context unavailable')
    const entity = workspaceEntities.find((item) => item.id === workspaceId)
    if (
      entity
        ? (await waitForSignal(entity.status(), signal)) !== 'ok'
        : !(await waitForSignal(stat(cwd), signal)).isDirectory()
    )
      throw new Error('Catalog workspace unavailable')
    if (presets && !presetId) throw new Error('Catalog preset unavailable')
    if (!presets && presetId) throw new Error('Catalog preset unavailable')
    return {
      workspaces,
      presets: rows,
      workspaceId,
      presetId,
      cwd,
      registry: service<SkillRegistry>('skills'),
      presetRegistry: presets,
    }
  }
  const scopedRead = async <T>(
    context: Awaited<ReturnType<typeof resolveContext>>,
    signal: AbortSignal,
    read: (registry: SkillRegistry, options: { cwd: string; scope: Scope; signal: AbortSignal }) => Promise<T>
  ) => {
    if (!context.registry || !context.presetRegistry) throw new Error('Catalog services unavailable')
    signal.throwIfAborted()
    const lease = await new Promise<Awaited<ReturnType<Presets['acquireScope']>>>((resolve, reject) => {
      let settled = false
      const abort = () => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        reject(signal.reason)
      }
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve()
        .then(() => context.presetRegistry!.acquireScope(context.presetId))
        .then(
          (acquired) => {
            if (settled) {
              void Promise.resolve()
                .then(() => acquired[Symbol.asyncDispose]())
                .catch(() => {})
              return
            }
            settled = true
            signal.removeEventListener('abort', abort)
            resolve(acquired)
          },
          (error: unknown) => {
            if (settled) return
            settled = true
            signal.removeEventListener('abort', abort)
            reject(error)
          }
        )
      if (signal.aborted) abort()
    })
    await using ownedLease = lease
    signal.throwIfAborted()
    return await read(context.registry, { cwd: context.cwd, scope: ownedLease.key, signal })
  }
  // Exact Connection routes are owner-only, unlike shared session RPC handlers.
  for (const endpoint of [method, saveMethod, translateMethod, openFolderMethod, sourceMethod])
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
            if (endpoint === sourceMethod) {
              const payload = body.data.payload as {
                path?: unknown
                catalog?: {
                  name?: unknown
                  provider?: unknown
                  source?: unknown
                  path?: unknown
                  workspaceId?: unknown
                  presetId?: unknown
                }
              }
              if (!payload || (!payload.catalog && typeof payload.path !== 'string'))
                return new Response('Invalid request', { status: 400 })
              let result
              try {
                const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(15_000)])
                if (payload.catalog) {
                  const selected = payload.catalog
                  if (
                    typeof selected.name !== 'string' ||
                    typeof selected.provider !== 'string' ||
                    typeof selected.source !== 'string' ||
                    typeof selected.workspaceId !== 'string' ||
                    typeof selected.presetId !== 'string' ||
                    (selected.path !== undefined && typeof selected.path !== 'string')
                  )
                    throw new Error('Invalid catalog selection')
                  const context = await resolveContext(selected, signal)
                  const content = await scopedRead(context, signal, async (registry, options) => {
                    const snapshot = await registry.snapshot(options)
                    const matches = (skill: { name: string; provider: string; source: string; path?: string }) =>
                      skill.name === selected.name &&
                      skill.provider === selected.provider &&
                      skill.source === selected.source &&
                      skill.path === selected.path
                    if (!snapshot.complete || !snapshot.skills.some(matches)) throw new Error('Stale catalog selection')
                    const definition = await registry.get(selected.name as string, options)
                    if (!definition || !matches(definition)) throw new Error('Stale catalog selection')
                    signal.throwIfAborted()
                    return definition.content
                  })
                  result = { ok: true as const, value: content }
                } else {
                  const observation = await provider.list({ signal })
                  const candidates = 'candidates' in observation ? observation.candidates : observation
                  const skill = candidates.find(
                    (item) => item.path === payload.path && ['user-agents', 'user-dsh'].includes(item.source)
                  )
                  if (!skill) throw new Error('Unknown user skill')
                  const definition = await provider.get(skill, { signal })
                  if (!definition) throw new Error('Skill unavailable')
                  signal.throwIfAborted()
                  result = { ok: true as const, value: definition.content }
                }
              } catch {
                result = {
                  ok: false as const,
                  error: { code: 'source_failed', message: 'Could not load skill source.', details: {} },
                }
              }
              return Response.json(
                { type: 'server-response', rpcId: body.data.rpcId, result },
                { headers: { 'Cache-Control': 'no-store' } }
              )
            }
            if (endpoint === openFolderMethod) {
              const payload = body.data.payload as { path?: unknown }
              if (!payload || typeof payload.path !== 'string') return new Response('Invalid request', { status: 400 })
              let result
              try {
                const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(15_000)])
                if (!canOpenNativePath()) throw new Error('Native folder opening unavailable')
                const observation = await provider.list({ signal })
                const candidates = 'candidates' in observation ? observation.candidates : observation
                const skill = candidates.find(
                  (skill) => skill.path === payload.path && ['user-agents', 'user-dsh'].includes(skill.source)
                )
                if (!skill?.path) throw new Error('Unknown user skill')
                await openNativePath(dirname(skill.path), signal)
                result = { ok: true as const, value: {} }
              } catch {
                result = {
                  ok: false as const,
                  error: { code: 'open_folder_failed', message: 'Could not open skill folder.', details: {} },
                }
              }
              return Response.json(
                { type: 'server-response', rpcId: body.data.rpcId, result },
                { headers: { 'Cache-Control': 'no-store' } }
              )
            }
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
                const description = (await readDisplay(skill.path, signal))?.description ?? skill.description
                const key = createHash('sha256')
                  .update(JSON.stringify([preferences.provider, targetLanguage, description]))
                  .digest('hex')
                const cachePath = join(cacheDir, `${key}.json`)
                // Resolve this before the cache so older same-language translations cannot replace the original.
                let value: string | undefined = matchesTargetLanguage(description, targetLanguage)
                  ? description
                  : undefined
                if (value === undefined) {
                  try {
                    const cached: unknown = JSON.parse(await readFile(cachePath, 'utf8'))
                    if (typeof cached === 'string') value = cached
                  } catch {
                    // Missing or damaged cache entries are retried through the selected provider.
                  }
                }
                signal.throwIfAborted()
                if (value === undefined) {
                  value = await translator.translate(
                    { text: description, provider: preferences.provider, targetLanguage },
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
                if (!candidates.some((skill) => skill.name === payload.name && isUserSource(skill.source))) {
                  throw new Error('Unknown user skill')
                }
                const skillName = payload.name
                let savedDisabled: string[] = []
                await editor.edit(target, (current) => {
                  const names = (current.disabled as string[] | undefined) ?? []
                  savedDisabled = payload.disabled
                    ? [...new Set([...names, skillName])]
                    : names.filter((name) => name !== skillName)
                  return { ...current, disabled: savedDisabled }
                })
                ctx.emit('skills/change')
                result = { ok: true as const, value: { disabled: savedDisabled } }
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
                folderOpenAvailable: canOpenNativePath(),
                disabled: disabled(),
                complete: 'candidates' in observation ? observation.complete : true,
                skills: await Promise.all(
                  skills.flatMap((skill) =>
                    skill.source === 'user-agents' || skill.source === 'user-dsh'
                      ? [
                          (async () => {
                            const display = await readDisplay(skill.path, signal)
                            return {
                              name: skill.name,
                              description: skill.description,
                              source: skill.source === 'user-agents' ? ('user-agents' as const) : ('user-dsh' as const),
                              path: skill.path,
                              ...(display && { display }),
                            }
                          })(),
                        ]
                      : []
                  )
                ),
              }
              const selection = (body.data.payload ?? {}) as { workspaceId?: unknown; presetId?: unknown }
              if (service('workingDirectory')) {
                try {
                  const context = await resolveContext(selection, signal, (contexts) => {
                    value.contexts = contexts
                  })
                  try {
                    const snapshot = await scopedRead(context, signal, (registry, options) =>
                      registry.snapshot(options)
                    )
                    value.catalog = {
                      complete: snapshot.complete,
                      skills: snapshot.skills.map((skill) => ({
                        name: skill.name,
                        description: skill.description,
                        source: skill.source,
                        provider: skill.provider,
                        ...(skill.path && { path: skill.path }),
                      })),
                    }
                  } catch {
                    request.signal.throwIfAborted()
                    lifetime.signal.throwIfAborted()
                    value.catalog = { complete: false, skills: [] }
                  }
                } catch {
                  request.signal.throwIfAborted()
                  lifetime.signal.throwIfAborted()
                  value.catalogError = true
                  if (value.contexts) value.catalog = { complete: false, skills: [] }
                }
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
