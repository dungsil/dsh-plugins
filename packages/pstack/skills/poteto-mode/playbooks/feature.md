### Feature

**Own the design, scope, and acceptance evidence.**

1. Read the subsystem, repository rules, callers, and existing tests. Load applicable available skills with `skill`; do not assume an external command exists.
2. State the user-visible contract and compare meaningful design alternatives. Choose the organizing data model before writing logic: explicit states instead of scattered booleans, or a typed table instead of repeated branching when appropriate.
3. Record a throughput checkpoint with `todo_write`: blocking prerequisites, independent workstreams, shared mutable state, and smallest safe decomposition. Keep an inapplicable dimension with its reason. Shared writes serialize; independent scopes can run in parallel.
4. Give one owner code-coupled work. Delegate a focused implementation with `subagent_codex`, or use Agent Teams and shared tasks for durable coordinated work. Briefs include allowed paths, contract, tests, and approval limits. Only the Lead spawns teammates. Use inherited models unless the tool explicitly supports selection.
5. Review the actual diff for scope, complexity, caller migrations, and shared-primitive effects across consumers. Independent design experiments are useful when alternatives are real, but do not multiply agents merely to satisfy a quota.
6. Build and verify each small unit before the next. Run repository checks and the real acceptance scenario on the matching surface. Report unavailable runtime access as unverified, not as success.
7. Revisit contested choices with independent review. Keep ordered, landable commits if commits are authorized; follow `opening-a-pr.md` only within publication permission.

**Reply:** behavior built, design choice and alternatives, throughput checkpoint, verification evidence, and open decisions.
