export const styles = `
.dsh-worktree { display: inline-flex; flex-wrap: wrap; align-items: center; min-width: 0; max-width: 100%; color: var(--dsw-alias-label-secondary, #626873); font: 12px/1.5 var(--dsw-font-family, system-ui); }
.dsh-worktree-picker { position: relative; min-width: 0; width: 320px; max-width: calc(100% - 28px); }
.dsh-worktree-select { box-sizing: border-box; appearance: none; width: 100%; min-width: 0; height: 28px; padding: 0 25px 0 25px; border: 0; border-radius: 7px; color: inherit; background: transparent; font: inherit; cursor: pointer; text-overflow: ellipsis; }
.dsh-worktree-select:hover:not(:disabled), .dsh-worktree-refresh:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f1f2f4); }
.dsh-worktree-select option { background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #20242c); }
.dsh-worktree-branch, .dsh-worktree-chevron { position: absolute; top: 7px; width: 14px; height: 14px; pointer-events: none; }
.dsh-worktree-branch { left: 6px; }
.dsh-worktree-chevron { right: 6px; opacity: .55; }
.dsh-worktree-refresh { flex: 0 0 auto; height: 28px; width: 28px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; font-size: 17px; cursor: pointer; }
.dsh-worktree-error { flex-basis: 100%; max-width: 320px; margin: 4px 0; color: var(--dsw-alias-state-error-primary, #b42318); }
.dsh-worktree-dialog { box-sizing: border-box; position: fixed; margin: 0; width: 360px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow: auto; padding: 16px; border: 1px solid var(--dsw-alias-border-l4, #e3e5e8); border-radius: 14px; background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #20242c); box-shadow: 0 8px 32px #0002; font: 13px/1.55 var(--dsw-font-family, system-ui); }
.dsh-worktree-dialog::backdrop { background: transparent; }
.dsh-worktree-dialog header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.dsh-worktree-dialog h2 { font-size: 15px; margin: 0; font-weight: 600; }
.dsh-worktree-dialog p { margin: 10px 0; color: var(--dsw-alias-label-secondary, #626873); }
.dsh-worktree-dialog button { border: 1px solid var(--dsw-alias-border-l4, #e3e5e8); border-radius: 8px; background: transparent; color: inherit; padding: 7px 10px; cursor: pointer; font: inherit; }
.dsh-worktree-dialog header button { padding: 0; width: 28px; height: 28px; border: 0; font-size: 20px; }
.dsh-worktree-dialog button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1, #f3f4f6); }
.dsh-worktree-dialog form > label { display: block; font-weight: 500; margin: 14px 0 6px; }
.dsh-worktree-dialog input[type=text] { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l4, #dfe2e8); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #f7f8fa); color: inherit; font: inherit; }
.dsh-worktree-dialog .dsh-worktree-hint { font-size: 12px; }
.dsh-worktree-dialog footer { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dsh-worktree-dialog .dsh-worktree-primary, .dsh-worktree-dialog .dsh-worktree-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-fill, #4d6bfe); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, white); }
.dsh-worktree-dialog [role=alert] { color: var(--dsw-alias-state-error-primary, #b42318); }
.dsh-worktree button:disabled, .dsh-worktree select:disabled, .dsh-worktree-dialog button:disabled { opacity: .45; cursor: not-allowed; }
.dsh-worktree button:focus-visible, .dsh-worktree select:focus-visible, .dsh-worktree-dialog input:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
.dsh-worktree-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
`
