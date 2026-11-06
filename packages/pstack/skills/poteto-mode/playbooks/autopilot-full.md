### Autopilot-full

**Own the verdicts. Give each change one owner and independent proof.**

1. Confirm the exact queue and authorization for edits, commits, pushes, PR creation, and merges. A request for a plan is not permission to execute. User-owned items stop at merge-ready unless explicitly included.
2. Use Agent Teams for durable owners. Create shared tasks with disjoint write scopes and dependencies. One owner controls each branch and PR; independent changes branch from trunk, not from each other. Use `create_worktree` for isolated checkouts when needed; shared files remain shared unless explicitly isolated.
3. Each owner builds and runs repository checks, reviews unnecessary complexity and comments, then reports the exact code-ready SHA. Follow `opening-a-pr.md` within authorization. Preserve progress in conversation and task state, not a new private log file.
4. Assign independent verification at the code-ready head: repository gates, real-surface behavior, relevant performance measurements, and diff review. Each lane returns commands or observations and artifact locations, not just a verdict. Select a model only if the exposed tool supports it; otherwise inherit and report that the run is not multi-model.
5. Block on demonstrated user-visible regressions, failed required gates, or newly incorrect shipped documentation. Distinguish failures already present on the base. Do not weaken budgets or disable checks to get green; any justified gate change needs independent evidence and an authorized decision.
6. New behavior or a large redesign needs renewed full verification. Minor fixes need targeted verification; every new head needs applicable checks. Follow the evidence-reuse rules in `shipping.md` after a rebase. Green CI alone does not authorize merging.
7. Before an authorized merge, inspect current trunk for conflicts, changed callers, dependencies, or check configuration. Test the actual merge result when those changes can affect the patch. Hold colliding work rather than endlessly rebasing it.
8. Supervise owners through `list_agents`, shared tasks, and `send_message`. Read actual diffs and results. If the objective spans continuation rounds, use the goal tools; never add scheduled audits without an explicit scheduling request. On stop, send every owner a no-new-writes instruction and collect checkpoints.

**Reply:** each PR's head, evidence and verdict, what merged or awaits authorization, gate decisions, and scoped follow-ups.
