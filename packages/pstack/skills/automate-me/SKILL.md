---
name: automate-me
description: "Use for \"automate me\", \"create/update/refresh my -mode skill\", \"turn/capture my preferences or working style into a skill\", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill with DSH skill-authoring and prose review, optionally pulling fresh evidence from recent transcripts."
disable-model-invocation: true
---

## DSH execution

Read `../../DSH.md` for DSH execution, permissions, and delegation rules before starting. Pass its absolute path to delegates.


# Automate me

A guided flow for turning the user's working conventions into a skill agents will follow. The output is one `-mode` skill tailored to them (e.g. `jay-mode`, `priya-mode`).

Load `agent-experience` with `skill` for authoring, use DSH session history for evidence, and apply `unslop` to the draft.

## Flow

### 0. Check for an existing skill

Discover existing authored skill roots from the active DSH loader configuration and workspace conventions. Use `glob` for existing `*-mode/SKILL.md` files within those roots, not private profile storage. If a matching skill exists, confirm update versus replacement with `ask_user_question`, unless the user already asked to update it:

- Update the existing skill (default for repeat runs)
- Start fresh (rare, ask why before doing it)

Update mode changes the rest of the flow:
- Step 1 mines only history since the skill was last edited (`git log -1 --format=%cI <path>`).
- Step 2 asks what's changed or missing, not what to capture from zero.
- Step 4 edits the existing file in place. Preserve sections the user hasn't contradicted. Revise ones with new evidence. Add new sections only for genuinely new rules.

### 1. Mine their history

Use `session_search` within the active workspace and requested date range. Follow useful hits with `session_event_read` or `session_event_trace`. Do not inspect private storage files or unrelated workspaces.

Survey recent workspace conversations, normally the last 2–4 weeks. Search topic and correction phrases first, then retrieve exact matching events. Delegate independent topic slices with `subagent_codex` only when useful; pass session IDs and evidence pointers rather than raw private history. Default signals worth hunting:

- Response preferences (length, tone, format, "dumb it down" corrections)
- Delegation habits (subagents, models, specialized workflows, parallelism)
- Verification posture (what "done" means, unit tests vs live repro, reviewers)
- Code and prose discipline (style, principles cited, lint/format tools)
- Process conventions (worktrees, commits, PRs, review/merge tooling)
- Meta preferences (fixing skills mid-task, proposing new ones)

Cross-check across slices before elevating a signal. Patterns seen in 2+ slices are high-confidence. Lone signals are weak and usually get dropped.

### 2. Ask the user directly

Mining misses intent that hasn't come up yet. Use the `ask_user_question` tool (structured multi-choice) rather than asking the user to type from scratch.

Shape: one or two questions with 4-6 options each, `multi_select: true` for category questions. Start broad ("Which areas matter most?"), then follow up on selected areas with specific options. After the structured rounds, one free-form chat question catches anything the options missed.

Don't dump 20 questions.

### 3. Cluster findings

Group the combined signals into sections. Common ones (use only what applies):

- **Response style**: length, tone, format.
- **Autonomy**: how much to do without asking, MCP tool use.
- **Understand first**: which skills to reach for when scoping or investigating a change.
- **Subagents**: default, parallelism, model-to-task, specialized workflows.
- **Prose / code discipline**: principles, lint tools, style guides.
- **Review and verify**: repro posture, verification skills, live-testing tools.
- **Process**: git worktrees, commits, PRs, review/merge tooling.
- **Skills**: skill-authoring habits, fix-the-skill-first, proposing new skills.

The **poteto-mode** skill shows the shape. Read it for granularity. Don't copy its content. The user's rules are not the same as poteto-mode's.

### 4. Draft the skill

Use `agent-experience` to author the skill. Discover the workspace skill-loading conventions before choosing placement:

- Path: preserve the existing authored skill destination. For a new skill, confirm a writable source directory that the DSH loader actually reads; do not assume a particular hidden directory registers skills.
- Handle: the user's first name or chosen identifier.
- Frontmatter `description`: trigger on their name + `/<handle>-mode` + "work in their style", not on generic keywords like "write code" or "review PR".
- Frontmatter: keep `name` and one scalar `description` with concrete triggers. Validate against the actual DSH loader rather than assuming metadata enables persistence.
- Do not promise always-on behavior. Explain how the user loads the skill in DSH and test discovery in a real session.

### 5. Iterate on prose

Apply the **unslop** skill and `agent-experience`'s writing guidelines to every line.

Show the draft to the user and take feedback. Expect multiple iterations. Cut ruthlessly. A mode skill is not a manual.

### 6. Land it

Follow the repository delivery policy and the user-authorized scope. Commit or open a PR only when requested; otherwise leave the reviewed source edits for the user.

## Guardrails

- **Don't overfit to one conversation.** A preference stated once and contradicted another time is noise. Require multiple instances before codifying it.
- **Don't be clever.** Restating other skills' contents, inventing metaphors, or writing "poetic" prose for an agent reader is cost without benefit. Keep it operational.
- **Reference, don't inline.** Other skills the user relies on should appear as path references, not pasted excerpts. Same for any principle docs they maintain elsewhere.
- **Keep sections minimal.** Only add a section if the user has a specific, non-default rule there. "Communicate clearly" is not a section. "Short paragraphs. Tables when comparing options. Bullets only when items are genuinely parallel." is.
- **Name conventions generic.** Use "the user" or "the human" in imperatives, not the author's first name.
- **Don't force symmetry.** If a user has no process rules worth writing down, skip the Process section entirely.

## Evaluation

A `-mode` skill is subjective output. A generic benchmark loop isn't useful here. Vibe-check with the user: does it read like them? Did it miss anything? Then ship.

Run a description-optimization loop only if the skill's trigger accuracy turns out to be a problem in practice.

## When not to use

- User wants a task-specific skill (not working conventions): DSH skill authoring with `agent-experience`, no mining required.
- User wants to capture one narrow workflow (e.g. "how I write commit messages"). That's a regular skill, not a mode skill.
