### Autopilot-stack

**Verify the stack, then hand it back. Do not merge.**

Follow `autopilot-full.md` with these overrides:

1. Stop when each PR is verified and its required checks pass at the recorded head. Report outstanding reviews or unavailable live checks honestly. After handoff, make no further pushes without the user's go.
2. Stack only genuinely dependent changes. A child targets its parent's branch; the root targets trunk. Record the dependency on the shared taskboard. Independent changes stay off trunk in separate branches.
3. A changed parent requires the owner to restack its children within authorization. Compare patches and affected runtime dependencies before reusing verdicts, following `shipping.md`; a matching patch alone does not prove the new base safe.
4. Carry the no-merge rule into every owner brief and continuation checkpoint. Neither a goal continuation nor green CI overrides it.

**Reply:** bottom-to-top PR list, dependencies, exact heads, verdicts, evidence, and the user's next action.
