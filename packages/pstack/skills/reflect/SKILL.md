---
name: reflect
description: Review the current DSH session for durable lessons and propose approved edits to existing skills
disable-model-invocation: true
---

## DSH execution

Read `../../DSH.md` for DSH execution, permissions, and delegation rules before starting. Pass its absolute path to delegates.

# Reflect

Mine the current conversation for durable lessons. Skip trivial, one-off, or already-covered findings. Propose changes before applying them.

## Gather evidence

Use `session_event_search` for the active session, then `session_event_read` for the exact decisions, corrections, and outcomes. Use `session_event_trace` when later events supersede an earlier claim. Share authorized session IDs and sequence numbers with reviewers, or a bounded digest with evidence references when they cannot access history. Do not inspect private history storage or unrelated workspaces.

## Independent review

Start three independent `subagent_codex` calls together with the templates below. Pass the absolute DSH.md path, evidence pointers, and instructions not to modify files or publish anything. Read `.dsh/pstack-models.json`: reviewer seats use `reviewers`, synthesis uses `judgment`. Apply preferences only if the actual tool supports selection. Otherwise all inherit the session model; distinct lenses do not imply distinct models.

- Judgment: `references/judgment-reviewer.md` identifies durable decision lessons.
- Tooling: `references/tooling-reviewer.md` identifies discoverability and execution gaps.
- Divergent: `references/divergent-reviewer.md` challenges obvious conclusions and missing alternatives.

Collect all results. Use `references/synthesizer.md` for one synthesis delegation, with the findings and evidence pointers. It returns Accepted, Rejected, and Backlog. Spot-check accepted evidence and read each destination skill. Move findings enforceable with types, lint, tests, or runtime checks to Backlog rather than adding repeated prose.

## Approval and application

Show the complete Accepted, Rejected, and Backlog lists with exact intended destinations. Wait for explicit approval before editing skills. Do not automatically file issues or publish findings. A skipped question is not approval. Never edit installed package caches or the active profile; locate the authored source or ask for the intended destination.

For approved changes, load `agent-experience` and `unslop` with `skill`. Prefer targeted edits to existing skills. Creating a new skill requires explicit user authorization and a genuinely separate recurring workflow. Preserve supported frontmatter, make triggers concrete, and evaluate one representative invocation plus a non-triggering case. Run an existing validator when available and report discovery tests you could not perform.

## Report

List applied destinations and one-line reasons, proposed structural backlog work, and rejected findings with reasons. Do not claim edits, issue filing, or runtime validation that did not occur.
