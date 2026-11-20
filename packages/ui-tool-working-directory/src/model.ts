import type { ToolCallPhaseProps } from '@deepseek-ai/dsh-client-ui-tool/client'

export type DirectoryState = 'preparing' | 'running' | 'ok' | 'error' | 'stopped'

export interface DirectoryModel {
  readonly path: string | null
  readonly input: string | null
  readonly output: string | null
  readonly state: DirectoryState
}

/** 경로의 공백은 실행 인수이므로 빈 값 판정에만 trim을 쓴다. */
export const directoryPath = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null

/** 정상 입력은 경로만 표시하되 잘못된 인수는 숨기지 않아 원인을 확인할 수 있게 한다. */
export const directoryInput = (input: string): string | null => {
  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return input
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return input
  }
  const record = value as Record<string, unknown>
  if (!('cd' in record)) {
    return null
  }
  return typeof record.cd === 'string' ? directoryPath(record.cd) : input
}

/** 준비 중 인수는 같은 객체 안에서 자라므로 렌더마다 읽는다. */
export const directoryModel = ({ phase, block }: ToolCallPhaseProps): DirectoryModel => {
  const path = directoryPath(block.args.text('cd'))
  if (phase === 'preparing') {
    return { input: null, output: null, path, state: 'preparing' }
  }
  if (phase === 'start') {
    return { input: block.argsRaw, output: null, path, state: 'running' }
  }
  const parts = block.content.map((part) => (part.type === 'text' ? part.text : JSON.stringify(part, null, 2)))
  if (block.error) {
    parts.push(JSON.stringify(block.error, null, 2))
  }
  const meta =
    typeof block.meta === 'object' && block.meta !== null && !Array.isArray(block.meta)
      ? (block.meta as Record<string, unknown>)
      : null
  const stopped = meta?.stopped === true
  let state: DirectoryState = block.isError ? 'error' : 'ok'
  if (block.error?.code === 'interrupted' || stopped) {
    state = 'stopped'
  }
  return { input: block.call?.argsRaw ?? null, output: parts.join('\n') || null, path, state }
}
