import type { RequestChanges } from './protocol.js'

/** Keep both the subprocess output and the rendered snapshot bounded. */
const MAX_FILES = 100
const MAX_DIFF_BYTES = 1_000_000

function path(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0'))
    throw new Error('invalid_response')
  return value
}

function diff(value: unknown): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > MAX_DIFF_BYTES || value.includes('\0'))
    throw new Error('invalid_response')
  return value
}

/** A failed or capped read is never interpreted as an empty change set. */
export async function readChanges(input: {
  provider: 'github' | 'gitlab' | 'gitea' | 'forgejo'
  github: () => Promise<{ files: unknown; changedFiles: unknown; diff: unknown }>
  gitlab: () => Promise<unknown>
  forge: () => Promise<{ files: unknown[]; changedFiles: unknown; diff: unknown }>
}): Promise<RequestChanges> {
  try {
    if (input.provider === 'github') {
      const result = await input.github()
      if (
        !Array.isArray(result.files) ||
        result.files.length > MAX_FILES ||
        result.changedFiles !== result.files.length
      )
        throw new Error('invalid_response')
      const files = result.files.map((file) => ({ path: path(file?.path) }))
      const patch = diff(result.diff)
      if (files.length && !patch) throw new Error('invalid_response')
      return { files, diff: patch, complete: true }
    }
    if (input.provider === 'gitlab') {
      const result = (await input.gitlab()) as { changes?: unknown; overflow?: unknown }
      if (!result || result.overflow !== false || !Array.isArray(result.changes) || result.changes.length > MAX_FILES)
        throw new Error('invalid_response')
      const files = result.changes.map((file) => ({ path: path(file?.new_path) }))
      const patches = result.changes.map((file) => {
        const patch = diff(file?.diff)
        if (file?.collapsed || file?.too_large) throw new Error('invalid_response')
        const oldPath = path(file?.old_path)
        const newPath = path(file?.new_path)
        const modeChanged =
          typeof file?.a_mode === 'string' &&
          /^[0-7]{6}$/.test(file.a_mode) &&
          typeof file?.b_mode === 'string' &&
          /^[0-7]{6}$/.test(file.b_mode) &&
          file.a_mode !== file.b_mode
        const metadataOnly =
          (file?.renamed_file === true && oldPath !== newPath) ||
          file?.new_file === true ||
          file?.deleted_file === true ||
          modeChanged
        if (!patch && !metadataOnly) throw new Error('invalid_response')
        const metadata = !patch
          ? [
              file.renamed_file === true ? `rename from ${oldPath}\nrename to ${newPath}` : '',
              file.new_file === true ? 'new file' : '',
              file.deleted_file === true ? 'deleted file' : '',
              modeChanged ? `old mode ${file.a_mode}\nnew mode ${file.b_mode}` : '',
            ]
              .filter(Boolean)
              .join('\n') + '\n'
          : ''
        return `diff --git a/${oldPath} b/${newPath}\n${metadata}${patch}`
      })
      return { files, diff: diff(patches.join('\n')), complete: true }
    }
    const result = await input.forge()
    if (!Array.isArray(result.files) || result.files.length > MAX_FILES || result.changedFiles !== result.files.length)
      throw new Error('invalid_response')
    const files = result.files.map((file: any) => ({ path: path(file?.filename) }))
    const patch = diff(result.diff)
    if (files.length && !patch) throw new Error('invalid_response')
    return { files, diff: patch, complete: true }
  } catch {
    return { files: [], diff: '', complete: false }
  }
}
