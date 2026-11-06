import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isDiffNote } from './protocol.js'

export const name = 'dungsil-tool-diff-note'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx: Context) {
  ctx.systemPrompt.section({
    name: 'dungsil:diff-note',
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text:
      'Use diff_note only after completing the requested implementation or fixes and all feasible validation, ' +
      'immediately before the final response. Never call it while work is in progress. ' +
      'Explain important decisions in code you actually changed during this task: design tradeoffs, compatibility constraints, ' +
      'or edge cases. Do not annotate every edit or merely paraphrase the diff; skip the tool when no such decision needs explanation. ' +
      'For questions about unchanged code, use file-and-line links and code quotations instead of inventing a change. ' +
      'Supply exact before/after fragments with enough shared context, focused on one decision per card; ' +
      'the note appears immediately below the shared DSH diff block and remains visible when its rows are folded. ' +
      'These are historical snapshots, not verification of the current file. ' +
      'Report validation limits in the final response; diff_note does not replace testing or that response.',
    interpolate: false,
  })

  ctx.tools.register(
    defineTool({
      name: 'diff_note',
      description:
        'Attach a short explanation of WHY a code change was made to a before/after diff card in the conversation. ' +
        'Use only immediately before the final response, after requested changes and feasible validation are complete; never during work. ' +
        'Does not read, verify, or modify files. ' +
        'Snapshots are supplied by you and retained in this tool call, not attached to live file lines. Never include secrets.',
      parameters: {
        path: {
          type: 'string',
          required: true,
          description: 'Changed file path, preferably workspace-relative; max 4096 characters.',
        },
        old_text: {
          type: 'string',
          required: true,
          description: 'Exact before-change fragment with shared context, max 20000 characters. Empty for an addition.',
        },
        new_text: {
          type: 'string',
          required: true,
          description: 'Exact after-change fragment with the same context, max 20000 characters. Empty for a deletion.',
        },
        note: {
          type: 'string',
          required: true,
          description:
            'Explain the decision, tradeoff, or edge case in the conversation language; max 2000 characters. Plain text.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            old_text: { type: 'string', required: true },
            new_text: { type: 'string', required: true },
            note: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: `Diff note recorded for ${value.path}: ${value.note}` }],
        // The durable result owns the snapshot; no file lookup or in-memory side store is needed on replay.
        presentationMeta: (_args, value) => value,
      },
      isConcurrencySafe: () => true,
      async execute(args) {
        if (!isDiffNote(args))
          throw new Error(
            'Provide a file path, different before/after fragments, and a non-empty note within the documented limits.'
          )
        return { path: args.path, old_text: args.old_text, new_text: args.new_text, note: args.note }
      },
    })
  )
}
