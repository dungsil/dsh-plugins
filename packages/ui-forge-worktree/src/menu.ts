import type { copy } from './copy.js'

export interface WorktreeList {
  origin: { directory: string; root: string; branch: string | null }
  current: string
  worktrees: { path: string; branch: string | null }[]
}

export const WORKTREES_PAGE_SIZE = 5

type CopyKey = keyof (typeof copy)['en']
type Translate = (key: CopyKey) => string

/** 메뉴 행 하나. `new` 행은 구분선으로 체크아웃 묶음과 나뉜다. */
export interface MenuRow {
  readonly badge?: string
  readonly current: boolean
  readonly disabled?: boolean
  readonly id: string
  readonly kind: 'more' | 'existing' | 'origin' | 'new' | 'info'
  readonly path?: string
  readonly text: string
}

export interface RowInput {
  readonly blocked: boolean
  readonly list: WorktreeList | undefined
  readonly listError: boolean
  readonly requested: boolean
  readonly t: Translate
  readonly visibleCount: number
}

/**
 * 위쪽으로 열리는 메뉴의 행을 만든다. 자주 고르는 행을 트리거에 가깝게 아래에
 * 둔다: 더 불러오기, 오래된 것부터 최근 것까지의 기존 워크트리, 원래 체크아웃,
 * 구분선 뒤 새 워크트리 순이다. 목록 조회 중·실패는 선택할 수 없는 안내 행이다.
 */
export const rowsOf = ({ blocked, list, listError, requested, t, visibleCount }: RowInput): MenuRow[] => {
  const rows: MenuRow[] = []
  if (list === undefined || listError) {
    rows.push({
      current: false,
      disabled: true,
      id: 'worktrees-status',
      kind: 'info',
      text: t(listError ? 'worktreesUnavailable' : 'worktreesLoading'),
    })
  } else {
    const entries = list.worktrees.filter((entry) => entry.branch !== null || entry.path === list.current)
    const visible = entries.slice(0, visibleCount)
    const attached = entries.find((entry) => entry.path === list.current)
    if (attached !== undefined && !visible.some((entry) => entry.path === attached.path)) {
      visible.push(attached)
    }
    // 최근 항목을 아래(트리거 쪽)에 두고 더 불러온 오래된 항목은 위로 쌓는다.
    rows.push(
      ...visible.toReversed().map((entry): MenuRow => ({
        current: !requested && entry.path === list.current,
        id: `worktree:${entry.path}`,
        kind: 'existing',
        path: entry.path,
        text: entry.branch ?? t('detached'),
      }))
    )
    if (entries.length > visibleCount) {
      rows.unshift({ current: false, id: 'more', kind: 'more', text: t('more') })
    }
  }
  const atOrigin = list === undefined || list.current === list.origin.root
  rows.push(
    {
      badge: atOrigin ? t('current') : t('origin'),
      current: !requested && atOrigin,
      id: 'origin',
      kind: 'origin',
      text: list === undefined ? t('loading') : (list.origin.branch ?? t('detached')),
    },
    { current: requested, disabled: blocked, id: 'new', kind: 'new', text: t('create') }
  )
  return rows
}
