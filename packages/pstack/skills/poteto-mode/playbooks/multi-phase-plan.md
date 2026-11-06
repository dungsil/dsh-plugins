### Multi-phase or multi-PR plan

**The plan is the deliverable. Do not start implementation.**

1. For an obvious one- or two-file change, explain that a multi-phase plan adds little value and give a short approach instead.
2. Read repository rules and affected contracts. Resolve empirical questions with an authorized prototype using `prototype.md`; do not silently turn a planning-only request into production edits. Record the evidence and unresolved product choices.
3. Delegate bounded read-only exploration with `subagent_codex` when useful. Ask for entry points, conventions, affected callers, and real check commands, not source dumps. Model selection is allowed only when the actual tool supports it; otherwise inherit.
4. Write the plan in chat unless the user explicitly requests a document or the task names one as a deliverable. When authorized, update an existing plan first. Do not create a private plan or progress log to bypass repository policy.
5. Use the compact structure below. Each unit must be independently verifiable, with its dependency, owner scope, acceptance predicate, and approval gates. A checklist box is complete only when its evidence exists.

```markdown
# <Program> plan

## Outcome and execution boundary
<User-visible result, non-goals, execution playbook, and who may publish or merge.>
Execution begins only on the user's go.

## Dependencies and ownership
<Ordered units and dependency graph. Independent units may run in parallel.>
<Allowed and forbidden paths for each owner; shared writes serialize.>

## <Unit: action and observable result>
- [ ] Build: <specific contract and affected symbols or files>
- [ ] Observe: <user-visible acceptance predicate>
- [ ] Unit checks: <command, expected result, and relevant regression>
- [ ] Live checks: <actual surface, available driver, scenarios, evidence, pass rule>
- [ ] Performance: <metric, comparable baseline, probe, budget; or justified n/a>
- [ ] Independent review: <reviewer scope and required receipts>
- [ ] Publication gate: <commit, push, PR, handoff, or merge authorization>

## Completion and handoff
<Required evidence, remaining user decisions, and stop condition.>

## Evidence, alternatives, and risks
<Prototype findings, rejected alternatives, runtime access gaps, and reading pointers.>
```

6. Make verification proportional but real. Tests alone do not prove changed runtime behavior. Name the actual DSH or repository driver instead of assuming a browser tool exists. If unavailable, mark live verification blocked and identify the access needed. For changed interactions, include user review evidence before any gated merge.
7. Compare base and head on the same load-bearing scenario. If the base lacks the feature, report that and measure the added work and end-to-end outcome with absolute budgets; do not invent a ratio between unlike scenarios. Freeze performance probes and interleave comparable runs.
8. Review the plan manually for missing dependencies, vague boxes, unresolved placeholders, nonexistent tools or paths, and unsupported approval claims. Report that review; do not invoke a removed validator.
9. Choose `autopilot-full.md` only for an authorized merge program, `autopilot-stack.md` for verified handoff, or `orchestrate.md` for durable team coordination. Goals support long execution; schedules, workflows, and fresh-agent iteration retain their explicit-request gates.

**Reply:** plan, dependency order, review gates, prototype findings, unproven assumptions, and validation performed. Stop for execution approval.
