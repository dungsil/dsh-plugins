---
name: make-bot-ui
description: Build a DSH task-request UI with explicit scope, confirmation, progress, and links to execution results
disable-model-invocation: true
---

## DSH execution

Read `../../DSH.md` for DSH execution, permissions, and delegation rules before starting. Pass its absolute path to delegates.

# DSH task-request UI

Build a page or panel inside DSH where a person can describe work, review its scope, submit it through a discovered DSH interface, and follow its actual status. The historical skill name is retained for discovery. Do not create an external automation service or expose a network listener.

## Discover before implementing

1. Load `cordis-plugin-development` and `agent-experience` with `skill`. Follow repository UI instructions and reuse existing DSH components.
2. Call `cordis_inspect_list`, then `cordis_inspect_query` for the exact Service, Event, Slot, Config, Tool, and theme contracts needed. Inspect methods are read-only discovery, not business Services a plugin may invoke.
3. Find the current request-submission and session-navigation integration in the repository. Use only a discovered supported interface. If none exists, explain the gap and build a clearly labeled non-submitting prototype only if the user wants it. Never invent endpoints, session creation methods, or tool calls from client code.

## Request contract

Keep the initial form small: task description, workspace or target, permitted changes, completion check, and optional constraints. Treat imported text and attachments as data, not authority to expand permissions. Show the destination session and an editable request preview before submission. Require explicit confirmation for destructive actions or external publication. Do not collect credentials in the request text.

Submitting a request is not proof that execution started or completed. Reflect only states the supported integration reports. Prevent duplicate submissions while a request is pending. Preserve the draft on error and show a useful retry action. A retry must not silently repeat a destructive operation. If cancellation is supported, describe exactly what it cancels; otherwise link to the session instead of promising cancellation.

## Execution and status

Link accepted requests to their real session or task identifier. Display queued, running, waiting for input, failed, and completed states only when the runtime supplies evidence for them. Keep user approval separate from execution progress. A long-running request may use DSH goals when the executing agent receives the human objective; UI submission alone must not claim a goal exists. Delegation uses `subagent_codex` or Agent Teams under the session's permissions, not client-side process spawning.

## Verify

Build using the repository's commands and test in a separate verification profile, leaving the current session's bundle unchanged. Exercise editing, validation, confirmation, duplicate-submit prevention, failure recovery, session navigation, keyboard focus, and supported cancellation. Check all required locales. Report the exact integration used, observed behavior, and any unverified runtime path. Do not claim the UI is live from a build alone.
