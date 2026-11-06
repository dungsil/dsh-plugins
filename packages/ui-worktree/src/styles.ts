import { settingsStyles } from '@dungsil/dsh-ui'
import { composerStyles } from '@dungsil/dsh-ui/composer'

export const styles = `${settingsStyles}${composerStyles}
.dsh-worktree-hover { min-width: 0; overflow-wrap: anywhere; white-space: normal; }
.dsh-worktree-sidebar-name { flex: 0 1 auto; min-width: 0; max-width: 88px; margin-inline: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-caption); font-size: 10px; line-height: 16px; }
[data-row-key]:has(.dsh-vcs-session-request) > .dsh-worktree-sidebar-name { display: none; }
.dsh-worktree { display: inline-flex; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary); font: inherit; }
.dsh-worktree-picker { display: inline-flex; min-width: 0; max-width: 100%; }
.dsh-worktree-pinned { position: sticky; top: 0; z-index: 1; background: var(--dsw-alias-bg-layer-1); }
.dsh-worktree-option { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-worktree-option > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-worktree-option > svg { flex: none; width: 14px; height: 14px; margin-inline-start: auto; color: var(--dsw-alias-label-primary); }
.dsh-worktree-badge { flex: none; padding: 1px 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; font-weight: 400; }
.dsh-worktree-trigger { display: inline-flex; max-width: 220px; font-weight: 500; }
.dsh-worktree-trigger .dsh-plugin-composer-icon svg { width: 14px; height: 14px; }
.dsh-worktree-trigger:not([aria-haspopup]) .dsh-plugin-composer-chevron { display: none; }
.dsh-worktree-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
@container (width <= 460px) {
  .dsh-worktree-trigger .dsh-plugin-composer-label { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .dsh-worktree-trigger .dsh-plugin-composer-chevron { transition: transform .12s; }
}
@media (hover: hover) {
  .dsh-worktree-trigger:hover:not(:disabled), .dsh-worktree-dialog button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
}
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
.dsh-worktree-dialog footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dsh-worktree-dialog button:disabled { opacity: .45; cursor: not-allowed; }
.dsh-worktree-dialog button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsh-worktree-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.dsh-worktree-progress { margin: 12px 0 20px; color: var(--dsw-alias-label-secondary); font: inherit; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px)); }
.dsh-worktree-progress > p { margin: 0 0 8px; overflow-wrap: anywhere; }
.dsh-worktree-progress ol { list-style: none; margin: 0; padding: 8px 0 0; border-top: 1px solid var(--dsw-alias-border-l2); }
.dsh-worktree-progress li { display: flex; align-items: center; gap: 10px; padding: 3px 4px; }
.dsh-worktree-progress li[data-state=pending] { opacity: .4; }
.dsh-worktree-progress-mark { display: inline-flex; flex: none; align-items: center; justify-content: center; width: calc(16px + var(--dsh-content-font-delta, 0px)); height: calc(16px + var(--dsh-content-font-delta, 0px)); }
.dsh-worktree-progress-mark svg { width: calc(14px + var(--dsh-content-font-delta, 0px)); height: calc(14px + var(--dsh-content-font-delta, 0px)); }
.dsh-worktree-progress li[data-state=failed], .dsh-worktree-progress [role=alert] { color: var(--dsw-alias-state-error-primary); }
.dsh-worktree-progress [role=alert] { margin-top: 10px; font: inherit; }
.dsh-worktree-progress-time { margin-inline-start: auto; padding-inline-start: 8px; font-size: calc(var(--dsh-content-font-size-secondary, 13px) - 1px); font-variant-numeric: tabular-nums; }
@keyframes dsh-worktree-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: no-preference) {
  .dsh-worktree-progress li[data-state=running] .dsh-worktree-progress-mark { animation: dsh-worktree-spin .8s linear infinite; }
}
.dsh-worktree-settings { width: 100%; color: var(--dsw-alias-label-primary); font: inherit; }
.dsh-worktree-settings fieldset { min-width: 0; padding: 0; margin: 0; border: 0; }
.dsh-worktree-settings .dsh-plugin-settings-row { gap: 24px; }
.dsh-worktree-settings .dsh-plugin-settings-row:last-child { border-bottom: 0; }
.dsh-worktree-settings label, .dsh-worktree-settings-title { display: block; font-size: 14px; font-weight: 400; line-height: 20px; }
.dsh-worktree-settings .dsh-plugin-settings-text p { margin: 4px 0 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
.dsh-worktree-settings-input { box-sizing: border-box; width: 220px; max-width: 100%; flex: 0 1 220px; min-width: 0; }
.dsh-worktree-settings-picker .dsh-plugin-settings-selector { max-width: 220px; color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 22px; }
.dsh-worktree-settings-picker .dsh-plugin-settings-selector:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.dsh-worktree-settings [role=status], .dsh-worktree-settings [role=alert] { margin: 12px 0; font-size: 12px; line-height: 18px; }
.dsh-worktree-settings [role=status]:empty { margin: 0; }
.dsh-worktree-settings [role=alert] { color: var(--dsw-alias-state-error-primary); }
@media (max-width: 600px) {
  .dsh-worktree-settings .dsh-plugin-settings-row { flex-wrap: wrap; gap: 12px; }
  .dsh-worktree-settings .dsh-plugin-settings-text { flex-basis: 160px; }
  .dsh-worktree-settings-input { flex-grow: 1; }
}
`
