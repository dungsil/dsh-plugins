### Perf issue

**Own the measurement story. Every fix needs comparable before-and-after evidence.**

1. Capture a baseline on the affected surface using an available profiler or repository driver. Record workload, environment, warmup, repetitions, completed work, and errors. A fast failed run is not an improvement.
2. Read the architecture and trace to ground hypotheses. Do not claim a performance ceiling without measuring it. Try mechanisms in this order, cheapest first:
   1. Eliminate work whose result is unused.
   2. Reuse work already done.
   3. Do it less often.
   4. Do it later.
   5. Move it off the user-visible critical path.
   6. Do it concurrently.
   7. Make the remaining operation cheaper.
3. Stop when a simple option meets the target. Compare boundary-crossing designs before implementing. Delegate a tight scope with `subagent_codex` when useful; inherit its model unless the tool supports selection. Review the actual diff.
4. Change one mechanism at a time. Capture the post-fix trace and run correctness checks before the next attempt. Remove unsuccessful owned edits; do not accumulate speculative optimizations.
5. Parse large artifacts into queryable data or delegate bounded analysis. Compare equivalent scenarios with repeated, preferably interleaved runs. Include units, distributions or noise estimates, error counts, and work counts. Wrong-surface and inconclusive results are not passes.
6. Cite the measurement and artifact in the completion report and any authorized PR. Use `opening-a-pr.md` within publication permission. For sustained metric-driven exploration, use `hillclimb.md` instead.

**Reply:** workload, baseline, post-fix value, delta, correctness checks, artifact locations, and limitations.
