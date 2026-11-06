import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { scopeOf, scopeParentOf } from '@deepseek-ai/dsh-scope'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

const nativePackage = '@deepseek-ai/dsh-tool-pwsh'
// Same-object baselines survive settings remounts, but never retain unloaded tools.
const originals = new WeakMap<ToolDefinition, PropertyDescriptor>()
const nativeIdentities = new WeakMap<Context['fiber'], WeakSet<ToolDefinition>>()

/**
 * Narrow compatibility bridge for DSH 0.2.2-rc.1: Tools retains the mutable
 * defineTool object, but exposes no public presentation transform. Decorate only
 * its configurable data description; never clone/register a replacement (which
 * would discard activation conditions, restrictions, and native effect lifetime).
 * Recheck this bridge when upstream adds an annotation API or changes storage.
 */
export function createPwshInstructionsAdapter(ctx: Context, readSaved: () => string | null) {
  const decorated = new Map<ToolDefinition, { get: () => string; previous: PropertyDescriptor; shown: string }>()
  let active = true
  let scanning = false
  const native = (consumer: Context) => consumer.fiber.entry?.options.name === nativePackage
  const notify = () => ctx.emit('tools/change')
  const editable = (definition: ToolDefinition) => {
    const owned = decorated.get(definition)
    const current = Object.getOwnPropertyDescriptor(definition, 'description')
    return !!owned && current?.configurable === true && current.get === owned.get
  }
  const baseline = (definition: ToolDefinition): string | null => {
    if (!editable(definition)) return null
    const descriptor = originals.get(definition)
    return descriptor && 'value' in descriptor && typeof descriptor.value === 'string' ? descriptor.value : null
  }
  const decorate = (definition: ToolDefinition): boolean => {
    if (!active || definition.name !== 'pwsh') return false
    const existing = decorated.get(definition)
    if (existing) {
      if (!editable(definition)) return false
      const shown = definition.description
      const changed = shown !== existing.shown
      existing.shown = shown
      return changed
    }
    const previous = Object.getOwnPropertyDescriptor(definition, 'description')
    // Foreign accessors (even configurable ones) are not ours to interpret.
    if (!previous?.configurable || !('value' in previous) || typeof previous.value !== 'string') return false
    if (!originals.has(definition)) originals.set(definition, previous)
    const original = originals.get(definition)!.value as string
    const get = () => readSaved() ?? original
    Object.defineProperty(definition, 'description', { configurable: true, enumerable: previous.enumerable, get })
    decorated.set(definition, { get, previous, shown: get() })
    return previous.value !== get()
  }
  const sources = () => {
    const found: { definition: ToolDefinition; scope: object | undefined }[] = []
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if ((fiber.state !== 1 && fiber.state !== 2) || !native(fiber.ctx)) continue
        // Resolve the native consumer's service realm, not the settings realm.
        const tools = fiber.ctx.get('tools')
        const scope = scopeOf(fiber.ctx)
        const definition = tools?.get('pwsh', scope)
        // An inherited fallback is not this scoped native owner's registration.
        if (!definition || (scope !== undefined && tools?.get('pwsh', scopeParentOf(scope)) === definition)) continue
        let identities = nativeIdentities.get(fiber)
        if (!identities) {
          identities = new WeakSet([definition])
          nativeIdentities.set(fiber, identities)
        }
        // A later same-name custom registration must not inherit provenance.
        if (identities.has(definition)) found.push({ definition, scope })
      }
    }
    return found
  }
  const scan = () => {
    if (!active || scanning) return
    scanning = true
    try {
      let changed = false
      const live = new Set(sources().map(({ definition }) => definition))
      for (const [definition, owned] of decorated) {
        if (live.has(definition)) continue
        if (editable(definition)) Object.defineProperty(definition, 'description', owned.previous)
        decorated.delete(definition)
      }
      for (const definition of live) changed = decorate(definition) || changed
      if (changed) notify()
    } finally {
      scanning = false
    }
  }
  // Cordis internal/get is deliberately limited to the proven native owner. The
  // service proxy forwards the original object/options and exact native disposer.
  ctx.on('internal/get', (consumer, service, _error, next) => {
    if (service !== 'tools' || !native(consumer)) return next()
    const tools = next() as Context['tools'] | undefined
    if (!tools) return tools
    const register: Context['tools']['register'] = (definition, options) => {
      if (definition.name === 'pwsh') {
        let identities = nativeIdentities.get(consumer.fiber)
        if (!identities) nativeIdentities.set(consumer.fiber, (identities = new WeakSet()))
        identities.add(definition)
      }
      const dispose = tools.register(definition, options)
      if (decorate(definition) && !scanning) {
        scanning = true
        try {
          notify()
        } finally {
          scanning = false
        }
      }
      return dispose
    }
    return new Proxy(tools, {
      get: (target, key, receiver) => (key === 'register' ? register : Reflect.get(target, key, receiver)),
    })
  })
  ctx.on('tools/change', scan)
  ctx.effect(() => () => {
    active = false
    let changed = false
    for (const [definition, owned] of decorated) {
      const current = Object.getOwnPropertyDescriptor(definition, 'description')
      // Never undo another plugin's later edit or touch a now-frozen definition.
      if (current?.get !== owned.get || !current.configurable) continue
      changed = definition.description !== owned.previous.value || changed
      Object.defineProperty(definition, 'description', owned.previous)
    }
    decorated.clear()
    if (changed) notify()
  })
  scan()

  return {
    async defaultInstructions(): Promise<string | null> {
      // Only RPC callers after boot may acquire a preset lease: doing so during
      // apply would wait on the Loader that is itself waiting for this plugin.
      scan()
      const presets = ctx.get('agentPresets')
      if (presets) {
        let lease: Awaited<ReturnType<typeof presets.acquireScope>>
        try {
          lease = await presets.acquireScope()
        } catch {
          // A missing/broken default preset is not an editable native target.
          return null
        }
        try {
          scan()
          const definition = ctx.get('tools')?.get('pwsh', lease.key)
          if (!definition) return null
          const proven = originals.has(definition) || sources().some((source) => source.definition === definition)
          return proven ? baseline(definition) : null
        } finally {
          await lease[Symbol.asyncDispose]()
        }
      }
      const defaults = new Set(
        sources()
          .filter((source) => source.scope === undefined)
          .map(({ definition }) => baseline(definition))
      )
      return defaults.size === 1 ? (defaults.values().next().value ?? null) : null
    },
  }
}
