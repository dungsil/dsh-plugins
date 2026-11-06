---
name: no-comments
description: Independently review comments, remove proven redundancy, and offer structural enforcement for constraints
disable-model-invocation: true
---

## DSH execution

Read `../../DSH.md` for DSH execution, permissions, and delegation rules before starting. Pass its absolute path to delegates.

# Review comments independently

Use the caller's files or diff. Otherwise establish the base branch and inspect the branch diff plus relevant working-tree changes. Do not widen the scope to unrelated code.

## Review

Delegate with `subagent_codex` for a fresh reader, or perform the review sequentially when delegation is unavailable. Pass the scope, the absolute DSH.md path, and these criteria. The reviewer returns findings without modifying files:

- Identify comments that merely restate the next statement, describe removed behavior, or justify a workaround whose root cause can be fixed in scope.
- For each finding, cite the exact comment, surrounding code, evidence, and proposed action. Separate safe deletion from a behavior-changing fix.
- Preserve copyright, license, generated-code, security, protocol, and externally required notices. Do not remove a warning because its purpose is not immediately obvious.
- Treat suppressions and constraint comments as investigation targets, not automatic deletions. Explain what fails without them and whether a type, test, runtime check, or scoped lint can enforce the constraint.

Read `.dsh/pstack-models.json` for `reviewers` preferences. Apply a model preference only if the actual delegation schema supports selection. Otherwise inherit the session model and do not claim model diversity.

## Reconcile and act

Read each cited region yourself. Reject scope escapes and unsupported findings. Use `how` or `why` to investigate ambiguous constraints before deleting them. A fresh perspective is evidence to check, not authority to override correctness or required notices.

Delete only comments proven redundant or obsolete. For a root-cause fix, use the smallest authorized change and verify behavior. If the fix needs a new design, use `architect` within the caller's scope before implementation. An out-of-scope cause remains a reported gap, not permission to fix every instance.

Offer structural enforcement for durable constraints before removing their only explanation. Obtain approval when the enforcement changes behavior or expands scope. If approval is withheld or unavailable, preserve the necessary warning and report the unenforced constraint. Never silence a diagnostic or delete a safety constraint merely to reduce comment count.

## Verify and report

Inspect the final diff for unintended code or notice changes. Run scoped lint, type checks, and relevant behavior tests for accepted fixes. Report deletions, retained constraints, structural encodings, rejected findings, and remaining gaps with evidence. A comment count alone is not a quality result.
