export interface DiffNote {
  path: string
  old_text: string
  new_text: string
  note: string
}

export function isDiffNote(value: unknown): value is DiffNote {
  if (!value || typeof value !== 'object') return false
  const note = value as DiffNote
  return (
    typeof note.path === 'string' &&
    !!note.path.trim() &&
    note.path.length <= 4096 &&
    !/[\r\n\0]/u.test(note.path) &&
    typeof note.old_text === 'string' &&
    note.old_text.length <= 20_000 &&
    typeof note.new_text === 'string' &&
    note.new_text.length <= 20_000 &&
    note.old_text !== note.new_text &&
    typeof note.note === 'string' &&
    !!note.note.trim() &&
    note.note.length <= 2000
  )
}
