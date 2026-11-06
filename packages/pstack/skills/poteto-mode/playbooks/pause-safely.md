### Pause safely

**Leave a recoverable checkpoint, not surprise publication.** Use only for an explicit pause or stop. A request to keep going is not a pause.

1. Start nothing new. Stop at an atomic boundary, or safely back out only your incomplete operation. Tell teammates to begin no new writes and collect their states before transferring ownership. Cancel no-longer-needed background jobs and close unneeded terminals.
2. Preserve edits on disk. Do not reset, delete, push, or open a PR merely to pause. Commit only if authorized, staging owned files and following repository conventions; otherwise report the dirty state precisely.
3. Put the resume checkpoint in the conversation: intent, branch and worktree, completed and verified work, pending changes, active jobs or teammates, exact next action, and risks. Update existing task state. Create a resume document only when explicitly requested and permitted.
4. If a goal is active, read it with `get_goal` and use `update_goal` with `pause` in response to the user's pause request. Do not mark unfinished work complete. On a later human request to continue, resume the goal before continuing.

**Reply:** checkpoint, on-disk state, checks and gaps, any commits made, and the first resume action. This is a pause, not a completion claim.
