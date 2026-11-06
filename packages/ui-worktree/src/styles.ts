import { settingsStyles } from '@dungsil/dsh-ui'

export const styles = `${settingsStyles}
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
