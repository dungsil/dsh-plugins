import type { TaskSettings } from './contract.js'
import type { TaskSnapshot, TitleTarget } from './protocol.js'

// Only the legacy wire format and migration reader know these historical roles.
export function legacyRole(packageName: string, key: string) {
  if (packageName === '@dungsil/dsh-plugin-ui-worktree' && key === 'branch-name') return 'worktree'
  if (packageName === '@dungsil/dsh-plugin-yoonmoon' && key === 'writing') return 'yoonmoon'
  return undefined
}

export function readLegacySettings(
  entryId: string,
  config: Readonly<Record<string, unknown>>,
  settings: TaskSettings,
  ownerConfig: Record<string, unknown> | undefined
): TaskSettings {
  if (config.modelSettings !== undefined) return settings
  const inheritance = ownerConfig?.inheritAuxiliary as Record<string, boolean> | undefined
  const instructions = ownerConfig?.instructions as Record<string, string> | undefined
  return {
    selection:
      settings.selection.mode === 'model'
        ? settings.selection
        : { mode: inheritance?.[entryId] === false ? 'conversation' : 'auxiliary' },
    instructions: instructions?.[entryId] ?? settings.instructions,
  }
}

export function legacyTarget(snapshot: TaskSnapshot | null): TitleTarget | null {
  if (!snapshot) return null
  return {
    id: snapshot.owner.entryId,
    revision: snapshot.revision,
    route: snapshot.selection.mode === 'model' ? snapshot.selection.route : null,
    reasoningEffort: snapshot.selection.mode === 'model' ? snapshot.selection.reasoningEffort : null,
    useAuxiliary: snapshot.selection.mode === 'auxiliary',
    instructions: snapshot.instructions,
    defaultInstructions: snapshot.defaultInstructions,
  }
}
