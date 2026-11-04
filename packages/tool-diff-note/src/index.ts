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
      'After changing code, use diff_note for important, non-obvious decisions: why an approach was chosen, ' +
      'a compatibility constraint, or an edge case. Do not annotate every edit or merely paraphrase the diff. ' +
      'Use the conversation language for the note. Supply exact before/after fragments from changes you actually made, ' +
      'with enough shared context to identify the change. Never invent code or include secrets. ' +
      'Keep each fragment focused on one decision: the note appears after its first contiguous changed block. ' +
      'These are historical, agent-supplied snapshots, not verification of the current file. ' +
      'The tool does not read or modify files and does not replace testing or the final response.',
    interpolate: false,
  })

  ctx.tools.register(
    defineTool({
      name: 'diff_note',
      description:
        'Attach a short explanation of WHY a code change was made to a before/after diff card in the conversation. ' +
        'Use after making a meaningful change, not for routine edits. Does not read, verify, or modify files. ' +
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
