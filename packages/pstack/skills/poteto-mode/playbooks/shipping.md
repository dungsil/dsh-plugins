### Shipping

**Land only explicitly authorized, independently verified code.**

1. Confirm which PRs and merge actions the user authorized. Inspect live base, head, required checks, approvals, and mergeability with available forge tooling. Never infer merge permission from a passing check, a goal, or a request to prepare a PR.
2. Obtain independent verification of each PR's load-bearing scenario against its parent or trunk and head. Record `PASS`, `PASS+NOTES`, or `FAIL`, the exact SHA, conditions, and evidence. A reviewer that did not author the code must inspect the receipts; CI alone is not a runtime verdict. If independent or live verification is unavailable, name the gap and hold the gate.
3. Walk bottom-up and select only the contiguous verified run. Stop at the first unverified PR; that is the ceiling. A higher independent change may move to trunk only through its owner, within authorization, with fresh verification of the new base.
4. Recheck old verdicts after any head or base change. Compare patches with `git patch-id`, but also inspect changed callers, dependencies, and build conditions. An unchanged patch can still behave differently on a new base. Reuse a lane only when its inputs and behavior are demonstrably unchanged; otherwise rerun it. Any changed tests, docs, or configuration still need their own checks and review.
5. Merge the lowest verified PR into the intended trunk using the supported forge path and repository merge policy. Confirm the live result afterward: queued or auto-merge-enabled is not merged. Do not bypass protected-branch rules or approvals.
6. Once a parent actually lands, its owner may retarget and restack the next child if authorized. Inspect the merge result, check for conflicts and changed dependencies, verify expected remote state before any history rewrite, and rerun applicable checks. No other branch churn occurs while the run lands.
7. Use finite managed watch commands when available, tracking and collecting job results. For a long objective, use DSH goals rather than a private polling loop. Enable auto-merge only with explicit permission and controls ensuring the verified head cannot change unnoticed.
8. Stop at the ceiling. Extending the run requires another authorization and evidence check, not silent queue growth.

**Reply:** authorized run and ceiling, each verdict and producer, exact landed state and confirmation, and what the next gap needs.
