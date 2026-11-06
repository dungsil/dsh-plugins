### Authoring or modifying a skill

**Own the skill's decisions and its reading cost.**

1. Load `agent-experience` with `skill`. Read the existing skill and repository instructions with `read` before editing. Create a new document only when explicitly requested or required as a deliverable.
2. State the trigger, intended outcome, permission boundaries, and validation first. Keep detailed resources deferred, with a clear purpose and reliable relative path. Prefer structural sources over duplicated rules.
3. Keep only instructions that change a decision. Explain a rule when its reason prevents misuse. Reference other available skills rather than copying them; load them with `skill` when applicable.
4. Validate required frontmatter, referenced paths, cross-skill links, Markdown fences, and tool names against the current DSH catalog. Do not invent tool parameters or model controls.
5. Exercise structural changes with representative requests, including an out-of-scope request. Report subjective guidance separately from testable behavior. Use `opening-a-pr.md` only within the user's publication authorization.

**Reply:** purpose, key design choices, validation performed, and remaining gaps.
