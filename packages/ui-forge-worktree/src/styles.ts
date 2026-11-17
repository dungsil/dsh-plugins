import { composerStyles } from '@dungsil/dsh-ui/composer'

export const styles = `${composerStyles}
.dsh-forge-worktree { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary); font: inherit; }
.dsh-forge-worktree-picker { display: inline-flex; min-width: 0; max-width: 100%; }
.dsh-forge-worktree-menu { overscroll-behavior: contain; --dsh-anchored-max-height: 320px; }
.dsh-forge-worktree-trigger { max-width: 100%; font-weight: 500; }
.dsh-forge-worktree-trigger:disabled { color: var(--dsw-alias-label-secondary); opacity: 1; }
.dsh-forge-worktree-trigger:disabled .dsh-plugin-composer-chevron { visibility: hidden; }
.dsh-forge-worktree-trigger .dsh-plugin-composer-icon svg { width: 14px; height: 14px; }
.dsh-forge-worktree-option { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-forge-worktree-option > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-forge-worktree-option > svg { flex: none; width: 14px; height: 14px; margin-inline-start: auto; color: var(--dsw-alias-label-primary); }
.dsh-forge-worktree-badge { flex: none; padding: 1px 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font-size: var(--dsw-font-xxs-12-font-size); line-height: 16px; font-weight: 400; }
.dsh-forge-worktree-more { color: var(--dsw-alias-label-tertiary); font-size: var(--dsw-font-xxs-12-font-size); line-height: 14px; }
.dsh-forge-worktree-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.dsh-forge-worktree-warning { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 20px; height: 20px; margin-inline-start: -2px; padding: 0; border: 0; border-radius: var(--dsw-radius-xs); background: transparent; color: var(--dsw-alias-state-warn-primary); cursor: help; }
.dsh-forge-worktree-warning svg { width: 14px; height: 14px; }
.dsh-forge-worktree:has(> .dsh-forge-worktree-warning) .dsh-plugin-composer-chevron { display: none; }
.dsh-forge-worktree-trigger:focus-visible, .dsh-forge-worktree-warning:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
`
