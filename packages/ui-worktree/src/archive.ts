type ArchiveSessionHeader = {
  readonly id: string
  readonly parentSession?: string
  readonly origin?: 'subagent'
}

// Ordinary conversation forks also have a parent, but retain independent ownership.
export function isOwnedDescendant(
  id: string,
  owner: string,
  headers: ReadonlyMap<string, ArchiveSessionHeader>
): boolean {
  const seen = new Set<string>()
  while (id !== owner) {
    if (seen.has(id)) return false
    seen.add(id)
    const header = headers.get(id)
    if (header?.origin !== 'subagent' || !header.parentSession) return false
    id = header.parentSession
  }
  return seen.size > 0
}
