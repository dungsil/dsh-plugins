### Prototype

**Own a cheap design decision. The artifact is throwaway, not production-ready.**

1. Name the decision: layout, interaction, density, behavior, timing, or technical approach. If there is no uncertain decision, use `feature.md` instead.
2. Read repository policy before creating scratch artifacts. Gather references when the visual direction is open, summarize themes and tradeoffs, and ask for a preference only when evidence cannot choose it.
3. Build the smallest authorized isolated experiment, outside production source. Use a minimal local fixture or light rendering stack; do not add production abstractions or dependencies just for the experiment. External dependencies or network access are not assumed.
4. For alternatives, provide a labeled switcher or equivalent repeatable inputs so the comparison uses the same conditions. Spend rigor on the observation, not polish.
5. Drive the matching surface with tools actually available. Capture screenshots and interactions for visual choices, or outputs and timing for behavioral choices. Track any server as a managed job and verify its URL; never replace the running DSH GUI implicitly. If runtime access is unavailable, report what remains unobserved.
6. Present alternatives, observed tradeoffs, and a recommendation. Preserve or remove only authorized scratch work. Hand the chosen direction to `feature.md` for a real implementation and regression coverage.

**Reply:** decision, variants, observations, evidence locations, tradeoffs, recommendation, and a clear throwaway warning.
