### Orchestrate

**Own coordination and acceptance, not every edit.** Use for a durable program with multiple owners. A single long objective belongs in `autonomous-run.md`.

1. Confirm the outcome, queue, publication permissions, and stop conditions. Pilot one representative unit through ownership and verification before expanding a repeated pattern.
2. As Team Lead, create shared tasks with `team_task_create`, explicit write scopes, dependencies, and acceptance evidence. Workers list/get the latest task, claim with its revision, perform it, and complete it. Overlap warnings are advisory: actively serialize shared writes or split scopes.
3. Spawn durable owners with `spawn_teammate`. Give each the goal, allowed and forbidden paths, dependencies, available runtime, evidence requirements, and approval limits. Teams share the working directory and filesystem; do not assume private copies. Use `create_worktree` for actual isolation. For a focused independent read-only task, `subagent_codex` may be simpler.
4. Keep one writer per branch or code-coupled unit. The owner alone rebases or publishes that branch within permission. Independent units can run in parallel; downstream units wait for prerequisites or explicitly use a parent branch. Only the Team Lead spawns teammates.
5. Use `list_agents`, the shared taskboard, and `send_message` for coordination. An inactive member is not necessarily done; a message can resume it. Before `wait_agent`, ensure a required member is running or provisioning. Re-list after waking; never busy-poll.
6. Review actual diffs, commands, artifacts, and live PR state rather than summaries alone. Assign independent verification for load-bearing behavior at the exact head. Inherit models unless selection is exposed by the tool, and disclose when verification is not multi-model.
7. Diagnose stalls from concrete progress and errors. Narrow scope for context failures, retry transient connectivity, or transfer work after preserving the current state. Interrupt before handing overlapping writes to a replacement; reconcile late results against current files. Do not let two owners race.
8. Keep concise state in shared tasks and conversation. Use DSH goals for long-running execution. Use `workflow` only when the user explicitly asks for a workflow or large multi-agent orchestration, `ralph` only for explicit fresh-agent iteration, and schedules only for explicit scheduling.
9. Send scope drift back to the owner. Ask the user for real product decisions, missing authority, or unresolved access. On stop, tell every owner to begin no new writes, collect checkpoints, and account for all active work before reporting completion.

**Reply:** progress against the goal, each unit's owner and verdict, actual PR states, dropped work and reasons, and decisions awaiting the user.
