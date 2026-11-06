import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DisclosureRow } from '@dungsil/dsh-ui'
import type { ConversationNodeDefinitionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useLocaleSnapshot } from '@dungsil/dsh-ui/client'
import {
  IconBranchOutlineRegular,
  IconCheckCircleOutlineRegular,
  IconCloseOutlineRegular,
  IconStopFillRegular,
  IconLoadingOutlineRegular,
  IconClockOutlineRegular,
} from '@dungsil/dsh-ui/icons'
import { isWorktreeProgress, progressRecord, type WorktreeProgress } from './protocol.js'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'dungsil-worktree-progress': WorktreeProgress
  }
}

const labels = {
  ko: {
    running: '워크트리 준비 중…',
    completed: '워크트리 준비 완료',
    failed: '워크트리 생성 실패',
    cancelled: '워크트리 준비 중단',
    steps: ['브랜치 이름 정하기', '기준 커밋 및 경로 확인', '파일 체크아웃', '작업 경로 전환'],
    failure: '작업을 시작하지 않았습니다. 워크트리를 선택한 뒤 프롬프트를 다시 전송하세요.',
  },
  en: {
    running: 'Setting up worktree…',
    completed: 'Worktree ready',
    failed: 'Worktree creation failed',
    cancelled: 'Worktree setup stopped',
    steps: ['Name branch', 'Check base commit and path', 'Check out files', 'Switch working directory'],
    failure: 'Work did not start. Select a worktree, then resend your prompt.',
  },
  zh: {
    running: '正在准备工作树…',
    completed: '工作树已就绪',
    failed: '工作树创建失败',
    cancelled: '工作树准备已停止',
    steps: ['生成分支名称', '检查基准提交和路径', '检出文件', '切换工作目录'],
    failure: '尚未开始任务。请选择工作树，然后重新发送提示。',
  },
}

// Display-only records never enter the model-visible message history.
export const progressDefinition: ConversationNodeDefinitionInput<{
  progress: WorktreeProgress
  anchorSeq: number
}> = {
  kind: 'dungsil-worktree-progress',
  target: 'chat',
  match: (event) => {
    // The controller's public union omits ignorable plugin records.
    const record: { type: string; data: unknown } = event
    if (record.type === progressRecord && isWorktreeProgress(record.data)) return { id: record.data.id, role: 'start' }
    if (event.type === 'user/message') return { id: event.data.id, role: 'update' }
    return null
  },
  start: (_context, match) => ({ progress: match.event.data as WorktreeProgress, anchorSeq: match.event.seq }),
  update: (context, match) =>
    match.event.type === 'user/message'
      ? { ...context.state, anchorSeq: match.event.seq + 0.1 }
      : { ...context.state, progress: match.event.data as WorktreeProgress },
  buildViewNode: (context) => {
    if (!context.state || !context.start) return null
    return {
      key: context.key,
      id: context.id,
      kind: 'dungsil-worktree-progress',
      target: 'chat',
      anchorSeq: context.state.anchorSeq,
      location: context.start.location,
      visibility: 'visible',
      groupTree: 'turn',
      data: context.state.progress,
    }
  },
}

export function installProgress(ctx: Context) {
  const settings = ctx.configForms.get<{ collapseTiming?: 'completion' | 'next-input' }>('ui-chat')
  const subscribe = (listener: () => void) => settings.subscribe(listener)
  const getCollapseTiming = () => settings.getSnapshot().value?.collapseTiming ?? 'completion'
  ctx.uiConversation.events.register(progressDefinition)
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register(
      { name: 'conversation.chat.node', key: 'dungsil-worktree-progress', inject: () => ({}) },
      function Progress({ node, useChat }: PropsRuntime<'conversation.chat.node', 'dungsil-worktree-progress'>) {
        const collapseTiming = useSyncExternalStore(subscribe, getCollapseTiming)
        const turn =
          node.location.kind === 'turn' || node.location.kind === 'step' ? node.location.turn.turn : undefined
        const hasNextInput = useChat((chat) => {
          const latestTurn = chat.navigation.items().at(-1)?.turn
          return turn !== undefined && latestTurn !== undefined && latestTurn > turn
        })
        const { active: language } = useLocaleSnapshot(ctx.locale)
        const text = labels[language.startsWith('ko') ? 'ko' : language.startsWith('zh') ? 'zh' : 'en']
        const progress = node.data
        const ended =
          node.location.kind === 'turn' || node.location.kind === 'step'
            ? node.location.turn.status === 'closed'
            : false
        const status = progress.status === 'running' && ended ? 'cancelled' : progress.status
        // A new automatic phase resets a manual choice; unrelated progress ticks do not.
        const automaticOpen = status !== 'completed' || (collapseTiming === 'next-input' && !hasNextInput)
        const [disclosure, setDisclosure] = useState({ automaticOpen, open: automaticOpen })
        const open = disclosure.automaticOpen === automaticOpen ? disclosure.open : automaticOpen
        if (disclosure.automaticOpen !== automaticOpen) setDisclosure({ automaticOpen, open: automaticOpen })
        const [now, setNow] = useState(Date.now)
        useEffect(() => {
          if (status !== 'running') return
          const timer = window.setInterval(() => setNow(Date.now()), 100)
          return () => window.clearInterval(timer)
        }, [status])
        return (
          <section className="dsh-worktree-progress" aria-label={text[status]} aria-busy={status === 'running'}>
            <span className="dsh-worktree-sr" role="status">
              {text[status]}
            </span>
            <DisclosureRow
              icon={<IconBranchOutlineRegular size={14} />}
              title={`${text[status]}${status === 'completed' && progress.branch ? ` · ${progress.branch}` : ''}`}
              open={open}
              expandable
              expandOnRowClick
              onToggle={() => setDisclosure({ automaticOpen, open: !open })}
              running={status === 'running'}
            >
              <ol>
                {text.steps.map((label, index) => {
                  const state =
                    index < progress.step || status === 'completed'
                      ? 'completed'
                      : index === progress.step
                        ? status
                        : 'pending'
                  const duration =
                    progress.durations[index]! + (state === 'running' ? Math.max(0, now - progress.updatedAt) : 0)
                  const Icon =
                    state === 'completed'
                      ? IconCheckCircleOutlineRegular
                      : state === 'failed'
                        ? IconCloseOutlineRegular
                        : state === 'cancelled'
                          ? IconStopFillRegular
                          : state === 'running'
                            ? IconLoadingOutlineRegular
                            : IconClockOutlineRegular
                  return (
                    <li key={label} data-state={state} aria-current={state === 'running' ? 'step' : undefined}>
                      <span className="dsh-worktree-progress-mark" aria-hidden="true">
                        <Icon size={14} />
                      </span>
                      <span>{label}</span>
                      {state !== 'pending' && (
                        <span className="dsh-worktree-progress-time">
                          {duration < 1000 ? `${Math.floor(duration)}ms` : `${(duration / 1000).toFixed(1)}s`}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ol>
            </DisclosureRow>
            {(status === 'failed' || status === 'cancelled') && <p role="alert">{text.failure}</p>}
          </section>
        )
      }
    )
  )
}
