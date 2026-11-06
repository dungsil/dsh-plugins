---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

## DSH execution

Read `../../DSH.md` for DSH execution, permissions, and delegation rules before starting. Pass its absolute path to delegates.


# Arena

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Use the `reviewers` seats in `.dsh/pstack-models.json`, or two inherited-model seats when absent. Give each a distinct design angle. Select models only when supported by the actual delegation schema. Multiple seats do not imply different models.
4. Give each candidate its own output location: an explicitly prepared git worktree when permitted, otherwise a per-candidate directory under a platform-appropriate scratch root. Follow DSH.md for native Windows and POSIX path handling. Name the exact path in its brief and prohibit writes to other candidates, per the **separate-before-serializing-shared-state** principle skill. Delegation does not automatically create an isolated checkout.

## Phase B: Fan out

Start independent `subagent_codex` delegations together, each with the task, grounding paths, its isolated output path, and a short rationale naming alternatives considered and rejected. Track every returned identifier and collect results before synthesis.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all candidates stop writing, launch one independent judge with `subagent_codex`. Use the `reviewers` preference only when the actual schema supports selection; otherwise inherit and disclose that the review is not cross-model. Give it the rubric and candidate paths. It scores each criterion and recommends a base while you read the candidates.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
