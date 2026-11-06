---
name: setup-pstack
description: Configure DSH pstack role preferences and reasoning budget without changing profile model settings
---

# Setup pstack for DSH

## DSH execution

Read `../../DSH.md` for DSH execution, permissions, and delegation rules before starting. Pass its absolute path to delegates.

1. Inspect the available delegation tool schemas and any discoverable model catalog. Use only models discoverable from the active DSH tool contracts. If the active tool cannot choose a model, explain that delegates inherit DSH's configured model. Do not change profile configuration or install a model provider.
2. Read `.dsh/pstack-models.json` in the workspace if it exists. Treat it as preferences, not executable configuration. Invalid JSON or an unsupported formatVersion requires reporting the issue before replacement.
3. Ask the user for a reasoning budget (`small`, `medium`, `large`, `unlimited`) and role preferences with `ask_user_question`. Budget is an effort preference, not a guarantee of supported runtime settings. Default each role to `inherit-parent`; include actual discovered model IDs only when the chosen delegate tool supports them. If a question is skipped, retain the existing value; do not treat a skip as permission to write.
4. Show the proposed JSON and obtain confirmation before saving it. Save only the confirmed preferences, preserving unrelated existing fields. Do not edit the active DSH profile.

Format:

```json
{
  "formatVersion": 1,
  "budget": "large",
  "roles": {
    "code": "inherit-parent",
    "judgment": "inherit-parent",
    "reviewers": ["inherit-parent", "inherit-parent"]
  }
}
```

Map feature/refactoring/bug-fix/perf/hillclimb and explorer/worker roles to `code`; prose/hardest/explainer/synthesizer roles to `judgment`; arena/architect/interrogate panels to `reviewers`. A panel entry is a seat, not proof of a different model. Use a per-role model only when the actual exposed delegate tool supports selecting it. If it cannot be honored, disclose the fallback rather than claiming it was applied. No unavailable model, reasoning effort, or persistent routing changes may be reported as active.

Confirm the saved path and which choices the current tools can actually honor. Read this project file when starting later pstack work. Setup does not enable an always-on mode or change DSH's selected chat model.
