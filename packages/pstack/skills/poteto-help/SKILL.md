---
name: poteto-help
description: Explain DSH pstack setup, execution, skill selection, verification, and recovery without starting work for a help question
disable-model-invocation: true
---

## DSH execution

Read `../../DSH.md` for DSH execution, permissions, and delegation rules before starting. Pass its absolute path to delegates.

# Pstack help for DSH

Answer the question first. A help request is not permission to launch a large run, change a profile, install a bundle, or start delegates. Give at most one example request and a link to the existing skill that owns the details. Read that skill before quoting it. If the user asks to do the work, load the matching skill and proceed within their scope.

## Start

Pstack is a collection of DSH skills. Use `skill` with an available skill name. When a bundled skill is not in the active catalog, locate and `read` its existing SKILL.md rather than inventing a slash command or installation flow. For package installation or activation questions, use DSH's plugin discovery and management instructions; do not change the active profile merely to answer help.

Use `setup-pstack` to discuss optional workspace preferences in `.dsh/pstack-models.json`. The roles are `code`, `judgment`, and `reviewers`. These are preferences, not runtime routing. If the exposed delegation schema does not support model selection, delegates inherit the session model. Several reviewer seats are independent perspectives, not evidence of multiple models.

A useful request states the goal, allowed scope, and an observable completion check. For example:

```text
Use poteto-mode to fix the failing save flow in this workspace. Stay within the editor package, reproduce the failure first, and verify the real user flow after the fix. Do not publish or merge.
```

Loading a skill does not establish an always-on mode. Include the relevant instructions in a new task and pass the absolute DSH.md path to delegates. Use `todo_write` for the steps of a multi-step task. DSH goals can keep a long-running human objective working across continuation rounds; a todo list alone does not provide that continuation. Scheduling requires an explicit human request.

## Pick the smallest useful skill

| Need | Skill |
|---|---|
| Execute a non-trivial task using a matching playbook | `poteto-mode` |
| Confirm the goal before work | `in-your-own-words` |
| Improve a request without doing the task | `sharpen` |
| Understand runtime flow and ownership | `how` |
| Investigate decisions with cited evidence | `why` |
| Learn a subsystem plainly | `teach` |
| Recover workspace-scoped prior work | `recall` |
| Summarize this session and pending human decisions | `ketchup` or `ketchup-video` |
| Check effects outside a diff | `blast-radius` |
| Compare design shapes before implementation | `architect` |
| Compare candidate artifacts and synthesize one | `arena` |
| Partition independent work and consolidate results | `swarm` |
| Try to break a change with executable evidence | `interrogate` |
| Fix a bug with a practical failing-before check | `tdd` |
| Review comments with an independent reader | `no-comments` |
| Improve prose or technical documentation | `unslop` or `technical-writing` |
| Create or maintain real-app verification instructions | `create-verification-skill` or `maintain-verification-skill` |
| Verify invariants and concurrency properties | `create-formal-verification-skill` or `maintain-formal-verification-skill` |
| Explain a checked state model visually | `statechart` |
| Validate performance claims | `benchmark-checklist` |
| Design an auditable multi-part run | `figure-it-out` and `show-me-your-work` |
| Capture working preferences or approved lessons | `automate-me` or `reflect` |
| Prevent repeated repository mistakes structurally | `correct` |
| Build a DSH task-request page or panel | `make-bot-ui` |

For a skill not listed here, read its sibling directory's frontmatter. The `principle-*` skills supply focused design and verification rules. Playbooks are files within `poteto-mode`, not independent commands.

## Delegation and recovery

Use `subagent_codex` for bounded independent tasks and Agent Teams for durable coordination when available. Teammates share the filesystem. Assign disjoint write scopes and order dependent changes; separate branches alone do not isolate working files. Give each delegate its goal, scope, evidence requirements, and DSH.md path. Wait for required results before claiming completion.

Use `session_search` to find prior workspace sessions, then `session_trace`, `session_event_read`, or `session_event_trace` for exact evidence and lineage. Use `session_event_search` for the current session. Do not read private history files or cross workspace boundaries. Missing history or integrations are evidence gaps, not permission to guess.

A green build is not a live verification result. Ask for the real command or user flow, its output, and remaining gaps. If a run stops early, compare the current artifact with its completion predicate and inspect the active goal before resuming. Never label unavailable model selection, unperformed UI checks, or unfinished delegate work as completed.

For prompt examples and focused steers, read `references/prompting.md` and `references/recipes.md` only when needed.
