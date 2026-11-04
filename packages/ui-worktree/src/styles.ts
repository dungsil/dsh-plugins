export const styles = `
.dsh-worktree-sidebar-name { flex: 0 1 auto; min-width: 0; max-width: 88px; margin-inline: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-caption); font-size: 10px; line-height: 16px; }
.dsh-worktree { display: inline-flex; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary); font: inherit; }
.dsh-worktree-controls { display: inline-flex; flex-wrap: nowrap; align-items: center; min-width: 0; max-width: 100%; }
.dsh-worktree-picker { display: inline-flex; min-width: 0; max-width: 100%; }
.dsh-worktree-trigger { display: inline-flex; align-items: center; gap: 4px; min-width: 0; max-width: 220px; height: 28px; padding: 0 4px 0 8px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; font-weight: 500; line-height: 20px; cursor: pointer; }
.dsh-worktree-icon, .dsh-worktree-chevron { display: inline-flex; flex: none; }
.dsh-worktree-icon svg { width: 14px; height: 14px; }
.dsh-worktree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-worktree-chevron { color: var(--dsw-alias-label-caption); }
.dsh-worktree-trigger[aria-expanded=true] .dsh-worktree-chevron { transform: rotate(180deg); }
.dsh-worktree-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-worktree-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
@container (width <= 460px) {
  .dsh-worktree-name { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .dsh-worktree-chevron { transition: transform .12s; }
}
@media (hover: hover) {
  .dsh-worktree-trigger:hover:not(:disabled), .dsh-worktree-error-trigger:hover, .dsh-worktree-dialog button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
.dsh-worktree-error-trigger { flex: 0 0 auto; min-height: 28px; padding: 2px 6px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 20px; white-space: nowrap; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.dsh-worktree-error-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
.dsh-worktree-dialog.dsh-worktree-error-dialog { inset: 0; margin: auto; }
.dsh-worktree-error-dialog dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 12px; }
.dsh-worktree-error-dialog dt { color: var(--dsw-alias-label-secondary); }
.dsh-worktree-error-dialog dd { margin: 0; overflow-wrap: anywhere; }
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
.dsh-worktree-settings { width: 100%; color: var(--dsw-alias-label-primary); font: inherit; }
.dsh-worktree-settings fieldset { min-width: 0; padding: 0; margin: 0; border: 0; }
.dsh-worktree-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-worktree-settings-row:last-child { border-bottom: 0; }
.dsh-worktree-settings-text { flex: 1; min-width: 0; }
.dsh-worktree-settings label, .dsh-worktree-settings-title { display: block; font-size: 14px; font-weight: 400; line-height: 20px; }
.dsh-worktree-settings-text p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsh-worktree-settings-input { box-sizing: border-box; width: 220px; max-width: 100%; flex: 0 1 220px; min-width: 0; }
.dsh-worktree-settings-selector { display: inline-flex; align-items: center; gap: 12px; max-width: 220px; height: 36px; padding: 0 14px; border: 0; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.dsh-worktree-settings-selector span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-worktree-settings-selector svg { flex: none; }
.dsh-worktree-settings-selector:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-worktree-settings-selector:disabled { opacity: .5; cursor: default; }
.dsh-worktree-settings-selector:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-worktree-settings [role=status], .dsh-worktree-settings [role=alert] { margin: 12px 0; font-size: 12px; line-height: 18px; }
.dsh-worktree-settings [role=status]:empty { margin: 0; }
.dsh-worktree-settings footer { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; margin-top: 16px; }
.dsh-worktree-settings [role=alert] { color: var(--dsw-alias-state-error-primary); }
@media (max-width: 600px) {
  .dsh-worktree-settings-row { flex-wrap: wrap; gap: 12px; }
  .dsh-worktree-settings-text { flex-basis: 160px; }
  .dsh-worktree-settings-input { flex-grow: 1; }
}
`
