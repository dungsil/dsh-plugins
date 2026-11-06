### Hillclimb

**Own the metric and experiment integrity. One change, one measurement, keep or remove.** For sustained measurable improvement; a one-off defect belongs in `bug-fix.md` or `perf-issue.md`.

1. Read the architecture and select a realistic workload that reproduces the complaint. Name dimensions such as size, history, concurrency, and state. If the workload does not reproduce it, repair the reproduction first.
2. Fix the metric, better direction, target, attempt budget, and stop predicate before changing code. Use the user's numbers; clarify material missing targets. Do not lower the target after seeing results.
3. Prove the measurement can distinguish contrasting realistic workloads, then freeze it. Report work completed and errors alongside the metric. Sample enough to exceed noise, using distributions or repeated medians rather than one lucky run. Record a baseline and green regression gate.
4. Keep a concise attempt table in conversation or existing task state: hypothesis, change, before, after, noise, checks, and kept or removed. Do not create a decision-log file unless requested and allowed by repository policy.
5. Ground each hypothesis in a specific mechanism. For performance, try eliminating work, reusing results, reducing frequency, deferring, moving off the critical path, concurrency, then cheaper execution. Delegate bounded attempts with `subagent_codex`; isolate competing writes in separate worktrees. Inherit models unless selection is supported.
6. Measure each attempt with the frozen harness and run the regression gate before starting the next. Accept only a reproducible improvement beyond noise without correctness loss. Remove only that attempt's unsuccessful edits. Stage only owned files when commits are authorized.
7. At a plateau, revisit the source and hypothesis category before stopping. Prefer correctness and simplicity to a flattering number. Report exhausted useful ideas or a concrete blocker honestly; never claim the target was met when it was not.
8. Use DSH goals for a long-running objective, following `autonomous-run.md`. Publication follows `opening-a-pr.md` within authorization.

**Reply:** metric and target, baseline and final with units and percent delta, attempt counts, accepted fixes, regression evidence, and the best next hypothesis.
