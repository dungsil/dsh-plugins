# Review triage

Use with `../playbooks/babysit.md`. A review comment is a hypothesis, not a required edit. Check it against the current head, nearby contracts, callers, and executable evidence before deciding.

## Decisions

- **Fix** a confirmed correctness, security, privacy, authorization, data-loss, migration, idempotency, or concurrency defect at its owning boundary. Reproduce it when possible, implement the smallest coherent correction, and rerun the affected checks. Reply to external threads only when authorized.
- **Dismiss** only when the actual current code or a reproducible check disproves the finding. State the enforced invariant, relevant caller, or test result. A prior dismissal is not evidence for this instance.
- **Ask** when the remaining choice is a genuine product decision, requires additional authorization, or carries unresolved security/data risk that cannot be safely settled with available evidence. Use `ask_user_question` and preserve the uncertainty if the question is skipped.

## Checks that prevent churn

1. Pin the finding to the reviewed SHA and compare it with the current head. A later fix can make an old comment stale, but the current guard must still precede the effect and cover the principal or input in question.
2. Verify claimed unused code against real callers, including dependent branches when available. Do not assume that an upper-stack caller exists.
3. Intentional visual changes do not excuse accessibility regressions. Test keyboard focus, accessible names, interaction, and contrast with the actual available controls.
4. Run a claimed failing contract test before editing prose or assertions. A prose-pinning check can itself drift; distinguish the contract from its wording.
5. Preserve failure distinctions. A missing dependency, a denied operation, and a command that ran and failed are different outcomes. Do not broaden a fallback until evidence shows those outcomes share a safe recovery path.
6. Treat cross-system, data, permission, and async-state concerns as live risks until disproved. A reviewer name, severity label, or repeated comment alone proves nothing.

Report each finding with the current SHA, decision, evidence, and remaining uncertainty. Do not create a new report file unless the task and repository policy authorize it.
