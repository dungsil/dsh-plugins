import type { ModelProviderGroup, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'

const storageKey = 'dungsil.model-picker.favorites'

type FavoriteStorage = Pick<Storage, 'getItem' | 'setItem'>

export function sameFavorite(left: ModelSelection, right: ModelSelection) {
  return (
    left.provider === right.provider && left.model === right.model && left.reasoningEffort === right.reasoningEffort
  )
}

function parse(raw: string | null): readonly ModelSelection[] {
  let value: unknown
  try {
    value = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const favorites: ModelSelection[] = []
  for (const item of value) {
    if (typeof item?.provider !== 'string' || typeof item.model !== 'string') continue
    if (item.reasoningEffort !== undefined && typeof item.reasoningEffort !== 'string') continue
    const favorite: ModelSelection = {
      provider: item.provider,
      model: item.model,
      ...(item.reasoningEffort === undefined ? {} : { reasoningEffort: item.reasoningEffort }),
    }
    if (!favorites.some((other) => sameFavorite(other, favorite))) favorites.push(favorite)
  }
  return favorites
}

/**
 * Ordered favorites persisted in this browser profile. A storage failure keeps
 * the in-memory list so the current page still works.
 */
export function createFavoriteStore(storage: () => FavoriteStorage) {
  const read = () => {
    try {
      return parse(storage().getItem(storageKey))
    } catch {
      return []
    }
  }
  let favorites = read()
  const listeners = new Set<() => void>()
  const publish = (next: readonly ModelSelection[]) => {
    favorites = next
    listeners.forEach((listener) => listener())
  }
  return {
    getSnapshot: () => favorites,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Append a new favorite at the end of the cycle, or remove an existing one. */
    toggle(favorite: ModelSelection) {
      const next = favorites.some((item) => sameFavorite(item, favorite))
        ? favorites.filter((item) => !sameFavorite(item, favorite))
        : [...favorites, favorite]
      try {
        storage().setItem(storageKey, JSON.stringify(next))
      } catch {}
      publish(next)
    },
    /** Adopt a change written by another tab. */
    sync(event: StorageEvent) {
      if (event.key === storageKey || event.key === null) publish(read())
    },
  }
}

/** The catalog entry when the favorite's model is listed and supports its effort. */
export function availableFavorite(groups: readonly ModelProviderGroup[], favorite: ModelSelection) {
  const model = groups
    .find((group) => group.id === favorite.provider)
    ?.models.find((item) => item.id === favorite.model)
  if (!model) return undefined
  if (favorite.reasoningEffort === undefined) return model
  return model.reasoning?.efforts.some((effort) => effort.id === favorite.reasoningEffort) ? model : undefined
}

/**
 * The favorite after the current selection in saved order, skipping
 * unavailable entries, or null when fewer than two favorites are usable.
 */
export function nextFavorite(
  favorites: readonly ModelSelection[],
  groups: readonly ModelProviderGroup[],
  current: ModelSelection | null
) {
  const usable = favorites.flatMap((favorite) => {
    const model = availableFavorite(groups, favorite)
    return model ? [{ favorite, effort: favorite.reasoningEffort ?? model.reasoning?.defaultEffort }] : []
  })
  if (usable.length < 2) return null
  const currentModel = current
    ? availableFavorite(groups, { provider: current.provider, model: current.model })
    : undefined
  const currentEffort = current?.reasoningEffort ?? currentModel?.reasoning?.defaultEffort
  const index = usable.findIndex(
    ({ favorite, effort }) =>
      favorite.provider === current?.provider && favorite.model === current.model && effort === currentEffort
  )
  return usable[(index + 1) % usable.length]!.favorite
}
