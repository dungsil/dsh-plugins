### Eval

**Own experiment integrity. Blind candidates and judge outputs, then audit the evidence.**

1. Define the variant, success behavior, and three to six concrete criteria. Keep the rubric from candidates. Use the same organic user request for every candidate; avoid measurement terminology in candidate-visible prompts and environment names.
2. Set up equivalent isolated working directories with only the context a real task needs. Use `create_worktree` for repository isolation where appropriate. Respect the repository's policy before creating fixtures, reports, or documents.
3. Run bounded candidates with `subagent_codex`, or use Agent Teams when durable coordination is needed. Each brief states its working directory and write scope without revealing other candidates. Do not ask for private reasoning or lists of applied principles; inspect behavior and outputs instead.
4. Choose models only when the actual delegation tool exposes model selection. Otherwise inherit the model and label the experiment single-model with independent runs, not multi-model. Do not promise a different-family judge if it cannot be configured.
5. Give an independent judge sanitized labels, outputs, and the rubric. For two variants, score both in one pass on one scale without revealing variant or model identity. Keep candidate and judge context separate.
6. Verify execution using authorized DSH session evidence when available: `session_search`, `session_event_search`, and targeted event reads. Never scan unrelated workspace histories or infer tool use from a candidate's self-report. Mark unavailable execution evidence as a limitation.
7. Read every output yourself and compare it with the judge's findings. Investigate disagreement for ambiguity or bias. Separate observed behavior from inference, and disclose blinding leaks.

Use `workflow` only when explicitly requested as a workflow or large multi-agent orchestration. Evaluation alone does not authorize it.

**Reply:** variant, rubric, sanitized candidate results, judge verdict, evidence limitations, synthesis, and promotion recommendation.
