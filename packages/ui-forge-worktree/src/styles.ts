import { composerStyles } from '@dungsil/dsh-ui/composer'

export const styles = `${composerStyles}
.dsh-forge-worktree { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary); font: inherit; }
.dsh-forge-worktree-picker { display: inline-flex; min-width: 0; max-width: 100%; }
.dsh-forge-worktree-menu { overscroll-behavior: contain; }
.dsh-forge-worktree-trigger { max-width: 220px; font-weight: 500; }
.dsh-forge-worktree-trigger .dsh-plugin-composer-icon svg { width: 14px; height: 14px; }
.dsh-forge-worktree-option { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-forge-worktree-option > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-forge-worktree-option > svg { flex: none; width: 14px; height: 14px; margin-inline-start: auto; color: var(--dsw-alias-label-primary); }
.dsh-forge-worktree-badge { flex: none; padding: 1px 5px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px; font-weight: 400; }
.dsh-forge-worktree-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.dsh-forge-worktree-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; overflow-wrap: anywhere; }
.dsh-forge-worktree-refresh { border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; padding: 3px 6px; font: inherit; cursor: pointer; }
.dsh-forge-worktree-trigger:focus-visible, .dsh-forge-worktree-refresh:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
@media (hover: hover) { .dsh-forge-worktree-refresh:hover { background: var(--dsw-alias-bg-layer-2); } }
`
