export const styles = `
.dsh-worktree { display: inline-flex; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; }
.dsh-worktree-picker { position: relative; min-width: 0; width: 220px; max-width: calc(100% - 28px); }
.dsh-worktree-select { box-sizing: border-box; appearance: none; width: 100%; min-width: 0; height: 28px; padding: 0 24px 0 26px; border: 0; border-radius: var(--dsw-radius-sm); color: inherit; background: transparent; font: inherit; cursor: pointer; text-overflow: ellipsis; white-space: nowrap; }
.dsh-worktree-select option { background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsh-worktree-branch, .dsh-worktree-chevron { position: absolute; pointer-events: none; }
.dsh-worktree-branch { top: 7px; left: 8px; width: 14px; height: 14px; }
.dsh-worktree-chevron { top: 6px; right: 4px; width: 16px; height: 16px; color: var(--dsw-alias-label-caption); }
.dsh-worktree-refresh { flex: 0 0 auto; height: 28px; width: 28px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; font-size: 17px; cursor: pointer; }
.dsh-worktree-select:disabled, .dsh-worktree-refresh:disabled, .dsh-worktree-picker:has(select:disabled) > svg { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-worktree-select:focus-visible, .dsh-worktree-refresh:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
@container (width <= 460px) {
  .dsh-worktree-picker { width: 44px; }
  .dsh-worktree-select { font-size: 0; }
}
@media (hover: hover) {
  .dsh-worktree-select:hover:not(:disabled), .dsh-worktree-refresh:hover:not(:disabled), .dsh-worktree-dialog button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-worktree-error { flex-basis: 100%; max-width: 320px; margin: 4px 0; color: var(--dsw-alias-state-error-primary); }
.dsh-worktree-dialog { box-sizing: border-box; position: fixed; margin: 0; width: 360px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow: auto; overscroll-behavior: contain; padding: 16px; border: 1px solid transparent; border-radius: var(--dsw-radius-lg); background: var(--dsw-specific-menu); backdrop-filter: var(--dsw-menu-backdrop-filter); color: var(--dsw-alias-label-primary); --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); box-shadow: var(--dsw-elevation-prominent); font: inherit; font-size: 13px; font-weight: 400; line-height: 1.55; }
.dsh-worktree-dialog::backdrop { background: transparent; }
.dsh-worktree-dialog header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.dsh-worktree-dialog h2 { font-size: 15px; margin: 0; font-weight: 600; }
.dsh-worktree-dialog p { margin: 10px 0; color: var(--dsw-alias-label-secondary); }
.dsh-worktree-dialog button { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; padding: 7px 10px; cursor: pointer; font: inherit; }
.dsh-worktree-dialog header button { display: inline-flex; align-items: center; justify-content: center; padding: 0; width: 28px; height: 28px; border: 0; }
.dsh-worktree-dialog form > label { display: block; font-weight: 500; margin: 14px 0 6px; }
.dsh-worktree-dialog input[type=text] { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; }
.dsh-worktree-dialog .dsh-worktree-hint { font-size: 12px; }
.dsh-worktree-dialog footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dsh-worktree-dialog .dsh-worktree-primary, .dsh-worktree-dialog .dsh-worktree-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-fill); border-color: transparent; color: var(--dsw-alias-label-primary-foreground); }
.dsh-worktree-dialog [role=alert] { color: var(--dsw-alias-state-error-primary); }
.dsh-worktree-dialog button:disabled { opacity: .45; cursor: not-allowed; }
.dsh-worktree-dialog button:focus-visible, .dsh-worktree-dialog input:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-worktree-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
`
