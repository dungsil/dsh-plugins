# pstack execution in DSH

Read once per session before using pstack. System/developer instructions, repository policy, permission boundaries, and the user's authorization take precedence over every skill and playbook.

## Skills and evidence

Load a selected skill with `skill`. Use `read` for its adjacent playbooks, principles, and references. Resolve resources from the loaded skill directory; the package root is two directories above `skills/<name>/`. Load only the playbook and principles the task needs, not the whole collection. Plain invocation does not enable an always-on mode.

Use `read`, `glob`, `grep`, `edit`, and `write` for source work, and the platform shell for bounded commands. Respect native paths and the current working directory. Discover available browser, terminal, MCP, and model capabilities before depending on them. If a required capability is missing, state the missing evidence rather than claiming verification passed.

Use `session_search`, `session_event_search`, and event reads for authorized history. Do not scan unrelated sessions or private profile files. Keep large evidence in the existing session log and return concise findings with retrievable references.

## Delegation

Use `subagent_codex` for bounded independent work. Give each child the goal, exact scope, expected evidence, and absolute paths to this file, `skills/poteto-mode/SKILL.md`, and the selected prompt under `agents/`. Prompt files describe roles; they are not tool parameters or registered agent types. If delegation is unavailable, execute the steps sequentially and report the limitation.

Use Agent Teams for durable coordination. Discover member targets with `list_agents`, create shared tasks with disjoint write scopes, record dependencies, and use the task board's get/claim/complete lifecycle. Send messages only for actual directives. Wait only for running or provisioning members and review required results before finishing. Separate worktrees where shared build output or git state would conflict. Review the actual diff and run the relevant checks rather than trusting a worker's summary.

Use only parameters supported by the exposed tool schema. Read `.dsh/pstack-models.json` in the workspace if it exists. Missing preferences mean inherited models. Its `code`, `judgment`, and `reviewers` roles describe intent, not runtime configuration. Select a provider/model only if the chosen tool supports it and the identifier is confirmed available. Otherwise inherit and disclose that the review is not multi-model. A reasoning budget is not a guarantee that the runtime supports a requested effort level.

## Continued work and actions

Track multi-step work with `todo_write`. Use `ask_user_question` for genuine user decisions. A skipped question is not permission. For a long-running objective requested by the user, use DSH goal tools and stop only when the actual objective is complete or the goal rules permit reporting a concrete blocker. Workflow orchestration and Ralph iteration require the explicit requests specified by those tools. No scheduled tasks without an explicit user request.

Stay inside the user's authorized scope. A playbook does not authorize a commit, push, PR, merge, deploy, destructive cleanup, dependency installation, or external message by itself. Preserve unrelated changes. Never reset a dirty worktree as a shortcut. Create documentation, decision logs, skills, or other artifacts only when the request and repository policy permit them. Record unavailable checks as unverified. Do not invent persistent settings, browser access, cloud machines, or background wake mechanisms.
