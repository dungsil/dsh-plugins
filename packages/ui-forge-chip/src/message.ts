/** Commit-message input assembly and output normalization, independent of Git and the model. */

const MAX_DIFF_CHARACTERS = 24_000
const MAX_SUBJECT_CHARACTERS = 100

export interface MessageFacts {
  status: string
  stat: string
  diff: string
  recent: string
}

/** User message for the commit-message model. The diff is cut at a line boundary to bound the request. */
export function messageInput({ status, stat, diff, recent }: MessageFacts) {
  const cut = diff.length > MAX_DIFF_CHARACTERS ? diff.slice(0, diff.lastIndexOf('\n', MAX_DIFF_CHARACTERS) + 1) : diff
  return [
    `Recent commit subjects:\n${recent.trim() || '(none)'}`,
    `Staged status:\n${status.trim()}`,
    `Staged diffstat:\n${stat.trim()}`,
    `Staged diff${cut.length < diff.length ? ' (truncated)' : ''}:\n${cut}`,
  ].join('\n\n')
}

/**
 * Reduce model output to a commit message: drop code fences, wrapping quotes and a leading label,
 * collapse blank runs, and keep a subject line that Git and code hosts display in full.
 * @returns the message, or undefined when nothing usable remains.
 */
export function normalizeMessage(output: string): string | undefined {
  let text = output.replace(/\r\n?/gu, '\n').trim()
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/u.exec(text)
  if (fenced) text = fenced[1]!.trim()
  text = text.replace(/^(?:commit message|message)\s*:\s*/iu, '').trim()
  if (/^(["'`])[\s\S]*\1$/u.test(text)) text = text.slice(1, -1).trim()
  const lines = text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .split('\n')
  const subject = lines[0]?.trim() ?? ''
  if (!subject || subject.length > MAX_SUBJECT_CHARACTERS) return undefined
  const body = lines.slice(1).join('\n').trim()
  return body ? `${subject}\n\n${body}` : subject
}
