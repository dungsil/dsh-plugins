### Refactoring

**Change structure while holding behavior fixed.** Features and defect corrections are separate work.

1. Read the affected contract, callers, and tests. Pin current behavior with a characterization test, snapshot, recorded replay, or equivalence harness before moving structure. Type checking alone is not a behavior pin.
2. Name the missing structure and target module, type, and call-graph shape. Prefer explicit valid states and fewer branches over extra indirection. Compare alternatives before cross-boundary moves.
3. Subtract dead code, one-caller wrappers, redundant validation, and orphan references before adding a new shape. Keep only evidence-backed cleanup that lowers reader load.
4. Move in small steps with the pin green at each step. Migrate all callers before removing an old API; do not leave accidental parallel implementations. Search strings, documentation, and back-references as well as typed usages.
5. Delegate mechanical edits with `subagent_codex` when useful, naming files, moved symbols, behavior constraints, and checks. Use Agent Teams tasks and disjoint scopes for coordinated writers. Inherit models unless selection is supported.
6. Prove equivalence on the real artifact: compare outputs, replay the baseline, or drive a smoke scenario with an available runtime driver. Report inaccessible surfaces as unverified. If a real bug or feature gap appears, separate it rather than silently altering the pinned contract.
7. Inspect whether the result actually reduces reader load. Remove your speculative changes when it does not. Keep ordered, behavior-preserving commits when authorized, then follow `opening-a-pr.md` within publication permission.

**Reply:** structure changed, behavior pin, equivalence evidence, reader-load improvement, discarded work, and any separate defects. No new behavior claimed.
