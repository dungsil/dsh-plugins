### Bug fix

**Own the causal proof. A plausible defensive change is not a fix.**

1. Reproduce on the affected surface using tools actually available in DSH or the repository. State the exact trigger and failing observation. If access is unavailable, explain the specific limitation rather than claiming a live reproduction.
2. Read the subsystem and regression history. Use `glob`, `grep`, and `read` for source; use authorized session search for prior decisions. Form competing hypotheses and choose experiments that eliminate the most possibilities. Add bounded instrumentation when state is unclear.
3. Confirm the surviving mechanism with runtime evidence before planning the patch. If the fix crosses boundaries, compare designs and their caller impact first.
4. Delegate a bounded investigation or implementation with `subagent_codex` when useful, or use Agent Teams for coordinated writers with disjoint task scopes. Provide files, contract, success criteria, and prohibited actions. Inherit the model unless the exposed tool supports selection; do not claim multi-model verification otherwise.
5. Capture a failing regression test before the fix when a cheap, meaningful test exists. Keep failure evidence even when the repository requires test and fix in one passing commit. For expensive integration-only cases, explain the chosen reproduction instead of inventing a unit-test guarantee.
6. Apply the smallest evidence-backed patch. Remove your refuted experiments without disturbing other work. Verify the original scenario on the same surface and run relevant regression checks. Wrong-surface or inconclusive results are not passes.
7. Follow `opening-a-pr.md` only within the user's publication authorization.

**Reply:** symptom, root cause, fix, failing-then-passing evidence, regression checks, and unverified conditions.
