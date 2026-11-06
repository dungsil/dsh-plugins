### Worktree and simulator cleanup

**Deletion has no code review safety net. Prove ownership, inactivity, and authorization first.**

1. Record available disk space with platform-appropriate tooling. Enumerate actual checkouts with `git worktree list --porcelain`; do not guess paths. Inspect each candidate's absolute path, branch, merge ancestry against the correct target, tracked edits, untracked and ignored files, and active processes.
2. Check usage through current Agent Teams tasks, known jobs and terminals, and authorized DSH session search. A quiet or clean worktree can still belong to active work. Ask the user when ownership or pinned-session status cannot be established; never infer inactivity from a name or age alone.
3. Classify candidates as active, uncommitted, recoverable clean, or uncertain. Untracked and ignored files are not automatically disposable. Show potentially lost work and get a decision before removal. A merged branch does not prove every local artifact is recoverable.
4. Delete only the confirmed, authorized set. Resolve and verify each absolute target immediately before removal. Prefer `git worktree remove <path>` without force; if it refuses, inspect the reason rather than forcing or recursively deleting the directory. Keep branch deletion as a separate authorized action.
5. Prune stale worktree metadata only after confirming the paths and effects. Re-list checkouts and measure disk space afterward. Report failures instead of assuming deletion succeeded.
6. For simulators or caches, enumerate actual platform resources and their users first. Remove only explicitly approved inactive resources with platform-supported commands. Never blanket-delete runtimes, device data, application state, or package caches as an implicit extension of worktree cleanup.

**Reply:** space before and after, removed targets and reasons, preserved branches, and each held candidate with the uncertainty or active owner.
