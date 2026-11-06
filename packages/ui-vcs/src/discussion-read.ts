import type { ChangeRequestRef } from '@deepseek-ai/dsh-experimental-forge'
import type { Api } from './forge-providers.js'

export interface Discussion {
  url: string
  body: string
  entries: Array<{ author: string; body: string; kind: 'comment' | 'review' }>
}

export async function readDiscussion(
  ref: ChangeRequestRef,
  api: Api,
  signal: AbortSignal
): Promise<Omit<Discussion, 'url'>> {
  const r = ref.repository
  const repo = `${r.owner}/${r.name}`
  const base =
    r.forge === 'gitlab'
      ? `projects/${encodeURIComponent(repo)}/merge_requests/${ref.number}`
      : `repos/${repo}/pulls/${ref.number}`
  const string = (value: unknown) => {
    if (typeof value !== 'string') throw new Error('invalid_response')
    return value
  }
  const pages = async (path: string) => {
    const result = []
    for (let page = 1; page <= 10; page++) {
      const rows = await api(
        r.host,
        `${path}${path.includes('?') ? '&' : '?'}per_page=100&limit=100&page=${page}`,
        signal
      )
      if (!Array.isArray(rows)) throw new Error('invalid_response')
      result.push(...rows)
      if (JSON.stringify(result).length > 2_097_152) throw new Error('too_large')
      if (rows.length < 100) return result
    }
    throw new Error('incomplete_response')
  }
  const row = await api(r.host, base, signal)
  if ((r.forge === 'gitlab' ? row.iid : row.number) !== ref.number) throw new Error('invalid_identity')
  const comments = await pages(
    r.forge === 'gitlab' ? `${base}/notes?sort=asc` : `repos/${repo}/issues/${ref.number}/comments`
  )
  const reviews: Array<{ user?: { login?: string }; body?: string }> =
    r.forge === 'gitlab'
      ? (await api(r.host, `${base}/approvals`, signal)).approved_by.map((entry: { user: { username: string } }) => ({
          user: { login: entry.user.username },
          body: '',
        }))
      : await pages(`${base}/reviews`)
  return {
    body: string((r.forge === 'gitlab' ? row.description : row.body) ?? ''),
    entries: [
      ...comments
        .filter((entry) => !entry.system)
        .map((entry) => ({
          author: string(entry.author?.username ?? entry.user?.login ?? ''),
          body: string(entry.body),
          kind: 'comment' as const,
        })),
      ...reviews.map((entry) => ({
        author: string(entry.user?.login ?? ''),
        body: string(entry.body ?? ''),
        kind: 'review' as const,
      })),
    ],
  }
}
