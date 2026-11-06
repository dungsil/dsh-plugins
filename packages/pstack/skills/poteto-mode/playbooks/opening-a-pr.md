### Opening a PR

**Publication is a permission boundary, not an automatic final step.** If the user has not authorized push or PR creation, stop with the local diff and verification report.

1. Inspect the current branch, worktree, and dirty state. Preserve unrelated edits. Use `create_worktree` from a known local ref when isolation is needed; it does not fetch or move uncommitted work. Never reset or delete existing work as a cleanup shortcut.
2. Review the diff for scope, needless complexity, misleading comments, and missing caller migrations. Run the repository's checks for touched paths with hooks enabled. Report checks not run and why.
3. When authorized, create small ordered commits that each tell one coherent story. Stage explicit owned paths. Follow repository conventions over generic guidance, including required language and CI-owned versioning.
4. Use the repository PR template and title convention. Explain why, the scoped change and exclusions, meaningful tradeoffs, blast radius, and actual verification. Keep the body a brief review aid, not a transcript. Link supporting screenshots, measurements, and exact-head evidence where available and permitted.
5. Inspect the actual tools available. Use a provided PR tool when applicable, or a supported forge CLI such as `gh`; do not assume an integrated PR tool exists. Verify the resulting URL, base, head, and draft state before reporting them. Respect the user's requested readiness state.
6. Prefer narrow PRs. Stack only dependent changes: root targets trunk; each child targets its parent branch. Independent work branches from trunk. Record dependencies and ownership so two agents never rewrite the same branch.
7. Push only the approved branches. Rewriting published history needs authorization, a verified expected remote SHA, and a lease; stop on unexpected remote movement. Do not bypass hooks, reviews, or protected-branch rules.
8. Opening a PR does not authorize babysitting or merging. Return the URL and keep to the assigned phase. Run `babysit.md` on request, or when an explicitly authorized owner lifecycle includes it. Shipping still follows its separate merge gate.

**Reply:** local or published state, scoped changes, checks, PR link when created, and remaining approval gates.
