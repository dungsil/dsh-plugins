export const styles = `
.dsh-worktree { display: inline-flex; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary); font: inherit; }
.dsh-worktree-controls { display: inline-flex; flex-wrap: nowrap; align-items: center; min-width: 0; max-width: 100%; }
.dsh-worktree-picker { display: inline-flex; min-width: 0; max-width: calc(100% - 28px); }
.dsh-worktree-trigger { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 220px; height: 28px; padding: 0 4px 0 8px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; cursor: pointer; }
.dsh-worktree-icon, .dsh-worktree-chevron { display: inline-flex; flex: none; }
.dsh-worktree-icon svg { width: 14px; height: 14px; }
.dsh-worktree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-worktree-chevron { color: var(--dsw-alias-label-caption); }
.dsh-worktree-trigger[aria-expanded=true] .dsh-worktree-chevron { transform: rotate(180deg); }
.dsh-worktree-refresh { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; height: 28px; width: 28px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.dsh-worktree-refresh svg { width: 14px; height: 14px; }
.dsh-worktree-trigger:disabled, .dsh-worktree-refresh:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-worktree-trigger:focus-visible, .dsh-worktree-refresh:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
@container (width <= 460px) {
  .dsh-worktree-name { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .dsh-worktree-chevron { transition: transform .12s; }
}
@media (hover: hover) {
  .dsh-worktree-trigger:hover:not(:disabled), .dsh-worktree-refresh:hover:not(:disabled), .dsh-worktree-dialog button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
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
.dsh-worktree-settings { max-width: 680px; color: var(--dsw-alias-label-primary); font: 14px/1.6 var(--dsw-font-family, system-ui); }
.dsh-worktree-settings h2 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.dsh-worktree-settings p { margin: 12px 0 24px; color: var(--dsw-alias-label-secondary); }
.dsh-worktree-settings fieldset { min-width: 0; padding: 0; margin: 0; border: 0; }
.dsh-worktree-settings label { display: block; margin-bottom: 8px; font-weight: 600; }
.dsh-worktree-settings input[type=text], .dsh-worktree-settings select { box-sizing: border-box; width: 100%; min-height: 40px; padding: 8px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; }
.dsh-worktree-settings .dsh-worktree-settings-check { display: flex; align-items: center; gap: 8px; }
.dsh-worktree-settings input[type=checkbox] { accent-color: var(--dsw-alias-button-primary-fill); }
.dsh-worktree-settings small { display: block; margin: 8px 0 24px; color: var(--dsw-alias-label-secondary); font-size: 13px; }
.dsh-worktree-settings footer { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.dsh-worktree-settings button { min-height: 36px; padding: 6px 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: inherit; background: transparent; font: inherit; cursor: pointer; }
.dsh-worktree-settings button[type=submit] { color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-primary-fill); border-color: transparent; }
.dsh-worktree-settings button:hover:not(:disabled) { filter: brightness(.85); }
.dsh-worktree-settings :disabled { opacity: .5; cursor: default; }
.dsh-worktree-settings :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 3px; }
.dsh-worktree-settings [role=alert] { color: var(--dsw-alias-state-error-primary); }
`
