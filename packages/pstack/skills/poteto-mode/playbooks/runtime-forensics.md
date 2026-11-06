### Runtime forensics

**Diagnose the live mechanism. The deliverable is evidence, not a fix.**

1. Identify the affected process and available capture tool. Collect a CPU profile for spinning, a heap snapshot for retention, or a rendering trace for a visual fault. Record process, build, workload, and capture interval. Do not infer a live signal from source alone.
2. Reduce the artifact to a hot path, a retainer chain to a GC root, or an unexpected scheduling loop. Delegate large-artifact parsing with `subagent_codex` when useful; ask for bounded findings and exact sample, node, or time references.
3. Confirm the mechanism with a controlled observation or minimally invasive instrumentation, only within runtime authorization. Read-only diagnosis does not authorize hot-patching a production process. Disclose instrumentation effects and remove authorized temporary probes when finished.
4. Map the finding to source file, symbol, and allocating or scheduling line. Separate observed facts, causal proof, and hypotheses. Missing symbols or inaccessible runtime tools are limitations, not permission to guess.
5. Keep the throughput checkpoint `n/a, diagnostic forensics`. Create no fix, PR, or new report file unless requested. Route confirmed defects to `bug-fix.md` or `perf-issue.md`.

**Reply:** captured signal, reduced finding, mechanism proof, source location, artifact locations, and remaining uncertainty.
