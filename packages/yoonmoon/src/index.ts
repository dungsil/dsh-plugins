import { readFileSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { BlockAssembler, ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { BUNDLED_SKILL_RANK, type SkillCandidate, type SkillProvider } from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TaskDefinition, TaskRegistration } from '@dungsil/dsh-plugin-model-settings/contract'
import { renderYoonmoonInstructions, yoonmoonInstructions } from '@dungsil/dsh-task-prompts'
import { parse } from 'yaml'

export const name = 'yoonmoon'
export const inject = ['skills', 'tools', 'llm']

export const Config = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  modelSettings: z.object({
    inherit: z.union(['auxiliary', 'conversation']).default('auxiliary'),
    instructions: z.string(),
  }),
})

export interface Config {
  provider?: string
  model?: string
  reasoningEffort?: string
  modelSettings?: { inherit: 'auxiliary' | 'conversation'; instructions?: string }
}

export const modelSettingsDefinition: TaskDefinition = {
  key: 'writing',
  label: { en: 'Yoonmoon writing', ko: '윤문 글쓰기', zh: '韩语润色写作' },
  description: {
    en: 'Model and instructions for the Yoonmoon writing tool.',
    ko: '윤문 글쓰기 도구의 모델과 지침입니다.',
    zh: '韩语润色写作工具的模型和指令。',
  },
  automaticReasoningLabel: { en: 'Model default', ko: '모델 기본값', zh: '模型默认值' },
  instructionsHint: {
    en: 'Use {{skill}} for the skill name and {{resources}} for bundled skill instructions and references.',
    ko: '{{skill}}은 스킬 이름, {{resources}}는 번들 스킬 지침과 참조 자료로 바뀝니다.',
    zh: '{{skill}} 会替换为技能名称，{{resources}} 会替换为内置技能指令和参考资料。',
  },
  read(config) {
    const local = config.modelSettings as Config['modelSettings']
    return {
      selection:
        typeof config.provider === 'string' && config.provider && typeof config.model === 'string' && config.model
          ? {
              mode: 'model',
              route: { provider: config.provider, model: config.model },
              reasoningEffort: typeof config.reasoningEffort === 'string' ? config.reasoningEffort : null,
            }
          : { mode: local?.inherit === 'conversation' ? 'conversation' : 'auxiliary' },
      instructions: local?.instructions ?? null,
    }
  },
  write(config, settings) {
    const { provider: _provider, model: _model, reasoningEffort: _effort, modelSettings: _settings, ...rest } = config
    return {
      ...rest,
      ...(settings.selection.mode === 'model'
        ? {
            ...settings.selection.route,
            ...(settings.selection.reasoningEffort ? { reasoningEffort: settings.selection.reasoningEffort } : {}),
          }
        : {}),
      modelSettings: {
        inherit: settings.selection.mode === 'conversation' ? 'conversation' : 'auxiliary',
        ...(settings.instructions !== null ? { instructions: settings.instructions } : {}),
      },
    }
  },
  defaultInstructions: () => yoonmoonInstructions,
}

const skillNames = [
  'polishing-korean',
  'humanizing-korean',
  'polishing-korean-translations',
  'proofreading-korean',
  'restyling-korean',
  'detecting-korean-ai',
] as const

function parseSkill(raw: string, skillName: string) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
  if (!frontmatter) throw new Error(`yoonmoon: missing frontmatter in ${skillName}`)
  const metadata = parse(frontmatter[1]) as { name: string; description: string }
  if (metadata.name !== skillName || !metadata.description?.trim()) {
    throw new Error(`yoonmoon: invalid metadata in ${skillName}`)
  }
  return { description: metadata.description, content: raw.slice(frontmatter[0].length).trim() }
}

export function apply(ctx: Context, config: Config = {}): void {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), 'yoonmoon: cancel disposed operations')
  let registration: TaskRegistration | undefined
  ctx.inject(['dungsilModelSettings'], (child) => {
    const current = child.dungsilModelSettings.register(ctx, modelSettingsDefinition)
    registration = current
    child.effect(() => () => {
      current.dispose()
      if (registration === current) registration = undefined
    })
  })
  const candidates: SkillCandidate[] = skillNames.map((skillName) => {
    const directory = new URL(`../skills/${skillName}/`, import.meta.url)
    const path = fileURLToPath(new URL('SKILL.md', directory))
    const { description } = parseSkill(readFileSync(path, 'utf8'), skillName)
    return {
      name: skillName,
      description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dungsil-yoonmoon',
      source: 'bundled',
      rank: BUNDLED_SKILL_RANK,
      resourceBase: { kind: 'directory', path: fileURLToPath(directory).split(sep).join('/') },
      path,
      locator: path,
    }
  })
  const provider: SkillProvider = {
    name: 'dungsil-yoonmoon',
    list: () => Promise.resolve(candidates),
    async get(candidate, options) {
      const { rank: _rank, locator, ...summary } = candidate
      const raw = await readFile(locator as string, { encoding: 'utf8', signal: options.signal })
      return {
        ...summary,
        content:
          `Delegate this task to the yoonmoon tool with skill="${candidate.name}", the complete input text, ` +
          'and any user-requested style or constraints in instructions. Read input files first if needed. ' +
          'The tool runs these instructions using the configured writing model; do not perform the writing task yourself. ' +
          'Return its result to the user without rewriting it. The tool cannot read or write user files; ' +
          'save its result yourself only when the user asks.\n\n' +
          parseSkill(raw, candidate.name).content,
      }
    },
  }
  ctx.skills.registerProvider(() => provider)
  ctx.tools.register(
    defineTool({
      name: 'yoonmoon',
      description:
        'Run a bundled Korean writing or diagnosis skill using the configured Yoonmoon model, without changing ' +
        'the conversation model. Pass the full input text, not a file path. Returns the writing model output; ' +
        'does not access user files or conversation history. Use for Yoonmoon skills instead of rewriting text yourself.',
      parameters: {
        skill: { type: 'string', required: true, description: `One of: ${skillNames.join(', ')}.` },
        text: {
          type: 'string',
          required: true,
          description: 'Complete Korean text to process, including any source text for comparison.',
        },
        instructions: {
          type: 'string',
          description: 'User-requested tone, target style, constraints or follow-up requirements.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (!skillNames.some((skill) => skill === args.skill) || !args.text.trim())
          throw new Error('Provide a bundled Yoonmoon skill name and non-empty input text.')
        const signal = AbortSignal.any([exec.signal, lifetime.signal, AbortSignal.timeout(300_000)])
        signal.throwIfAborted()
        const conversation = exec.agent?.session.requestHeader()?.config ?? exec.agent?.options
        const resolved = registration?.resolve({
          provider: conversation?.provider ?? '',
          model: conversation?.model ?? '',
        })
        const route = resolved?.route ?? (config.provider && config.model ? config : conversation)
        if (!route?.provider || !route.model) throw new Error('No model selected for Yoonmoon.')
        const effort = resolved
          ? resolved.reasoningEffort
          : config.provider && config.model
            ? config.reasoningEffort
            : undefined
        // Resolve only bundled paths. The writing model has no tools, so provide its local references upfront.
        const selected = args.skill === 'polishing-korean' ? skillNames : [args.skill]
        const resources = await Promise.all(
          selected.map(async (skill) => {
            const directory = new URL(`../skills/${skill}/`, import.meta.url)
            const body = parseSkill(
              await readFile(new URL('SKILL.md', directory), { encoding: 'utf8', signal }),
              skill
            ).content
            const references = await readdir(new URL('references/', directory))
            const files = await Promise.all(
              references
                .filter((file) => file.endsWith('.md'))
                .map(
                  async (file) =>
                    `\n\n# ${skill}/references/${file}\n${await readFile(new URL(`references/${file}`, directory), { encoding: 'utf8', signal })}`
                )
            )
            return `# ${skill}\n${body}${files.join('')}`
          })
        )
        const call = await ctx.llm.prepareCall(
          {
            provider: route.provider,
            model: route.model,
            reasoningEffort: effort ? ReasoningEffortId(effort) : undefined,
          },
          signal,
          (controls, model) => ({
            ...controls,
            reasoningEffort:
              controls.reasoningEffort ??
              model.reasoning?.defaultEffort ??
              model.reasoning?.efforts.find((effort) => effort.id !== 'off')?.id,
          })
        )
        const assembler = new BlockAssembler()
        for await (const chunk of call.stream({
          ...call.config,
          system: [
            renderYoonmoonInstructions(
              resolved?.instructions ?? config.modelSettings?.instructions ?? yoonmoonInstructions,
              args.skill,
              resources.join('\n\n')
            ),
            resolved?.additionalInstructions,
          ]
            .filter(Boolean)
            .join('\n\n'),
          messages: [
            createUserMessage({
              content: [
                { type: 'text', text: JSON.stringify({ text: args.text, instructions: args.instructions ?? '' }) },
              ],
              source: { kind: 'user' },
            }),
          ],
          sessionId: exec.agent?.id,
          signal,
        })) {
          signal.throwIfAborted()
          assembler.push(chunk)
        }
        signal.throwIfAborted()
        const result = assembler
          .blocks()
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('')
          .trim()
        if (assembler.finish.kind !== 'stop' || !result)
          throw new Error('Yoonmoon did not return a complete text result.')
        return result
      },
    })
  )
}
