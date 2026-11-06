### Trace forensics

**Diagnose an existing artifact. Do not replace the dataset with a new run.** For live instrumentation, use `runtime-forensics.md`.

1. Identify the format and provenance: CPU profile, compressed trace, heap snapshot, or thread dump. Use an available parser suited to it. Preserve the original artifact; create derived data only within repository and user permission.
2. Reduce large captures into queryable samples, frames, nodes, or intervals, such as an in-memory table or SQLite dataset. Delegate bounded parsing with `subagent_codex` when useful, returning only findings and retrieval pointers.
3. Narrow by evidence. For CPU, aggregate time and walk the call tree. For retention, follow the object-to-root chain. For thread dumps, identify the on-CPU or blocked thread and its wait reason. Check sampling gaps and capture boundaries before attributing total cost.
4. Resolve source file, symbol, and line using the artifact's own symbols or matching maps. An unresolved frame is not a source diagnosis; report absent mappings explicitly.
5. Compare paired captures when present, controlling for workload and capture length. Without confirming evidence, call the result the strongest supported hypothesis rather than a proven cause.
6. Keep the throughput checkpoint `n/a, read-only forensics`. Return a cited diagnosis, not a fix. Route actionable causes to `bug-fix.md` or `perf-issue.md` when implementation is requested.

**Reply:** artifact and format, reduced finding, source mapping, sample or interval references, artifact locations, and confirmation strength.
