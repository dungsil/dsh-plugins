### Visual parity

**The frozen baseline is the specification. An image diff, not visual confidence, proves parity.**

1. Before migration, capture the current component across relevant states and viewport sizes with a repeatable visual harness. Pin fonts, scale, data, timing, and rendering environment. No baseline means no parity claim.
2. Freeze the harness and baseline. Do not alter either, mask new differences, or restructure the component merely to hide a failing diff. If the baseline is wrong or inherently nondeterministic, stop and resolve that separately with the user.
3. Migrate shared primitives first. Then give each component one owner. Use disjoint Agent Teams task scopes or isolated worktrees for parallel edits; shared writes serialize.
4. Capture the same states on the actual target surface using an available driver, and run the image diff. A nonzero diff fails a zero-difference target. Investigate the exact pixel delta rather than weakening the threshold. Record missing runtime access as an unverified gate.
5. Iterate within the authorized scope until the target holds. Use DSH goals for a long objective, not an implicit timer or fresh-agent loop. Verify each component before the next and follow `opening-a-pr.md` only within publication authorization.

**Reply:** migrated components, per-state diff results, baseline and harness locations, environment, and remaining gaps.
