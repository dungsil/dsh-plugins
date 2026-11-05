import type { Context } from '@deepseek-ai/cordis'
import type { LocalizedText, ModelSelection, Route } from './protocol.js'

export type { LocalizedText, ModelSelection, Route } from './protocol.js'

export interface TaskSettings {
  selection: ModelSelection
  instructions: string | null
}

export interface TaskDefinition {
  key: string
  label: LocalizedText
  description: LocalizedText
  automaticReasoningLabel: LocalizedText
  instructionsHint?: LocalizedText
  read(config: Readonly<Record<string, unknown>>): TaskSettings
  write(config: Readonly<Record<string, unknown>>, settings: TaskSettings): Record<string, unknown>
  defaultInstructions(config: Readonly<Record<string, unknown>>): string
}

export interface ResolvedTaskSettings {
  route: Route
  reasoningEffort: string | null
  instructions: string
  additionalInstructions: string
}

export interface TaskRegistration {
  resolve(conversationRoute: Route): ResolvedTaskSettings
  dispose(): void
}

export interface ModelSettingsService {
  register(owner: Context, definition: TaskDefinition): TaskRegistration
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dungsilModelSettings: ModelSettingsService
  }
}
