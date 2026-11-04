export const styles = `
.dsh-worktree { display: inline-flex; align-items: center; min-width: 0; }
.dsh-worktree-name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.dsh-worktree-trigger { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 6px; border: 0; border-radius: 7px; color: var(--dsw-alias-label-secondary, #626873); background: transparent; font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.dsh-worktree-trigger:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, #f1f2f4); }
.dsh-worktree-chevron { opacity: .55; }
.dsh-worktree-dialog { box-sizing: border-box; position: fixed; margin: 0; width: 360px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow: auto; padding: 16px; border: 1px solid var(--dsw-alias-border-l4, #e3e5e8); border-radius: 14px; background: var(--dsw-alias-bg-layer-2, #fff); color: var(--dsw-alias-label-primary, #20242c); box-shadow: 0 8px 32px #0002; font: 13px/1.55 var(--dsw-font-family, system-ui); }
.dsh-worktree-dialog::backdrop { background: transparent; }
.dsh-worktree-dialog header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.dsh-worktree-dialog h2 { font-size: 15px; margin: 0; font-weight: 600; }
.dsh-worktree-dialog p { margin: 10px 0; color: var(--dsw-alias-label-secondary, #626873); }
.dsh-worktree-dialog button { border: 1px solid var(--dsw-alias-border-l4, #e3e5e8); border-radius: 8px; background: transparent; color: inherit; padding: 7px 10px; cursor: pointer; font: inherit; }
.dsh-worktree-dialog header button { padding: 0; width: 28px; height: 28px; border: 0; font-size: 20px; }
.dsh-worktree-dialog button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1, #f3f4f6); }
.dsh-worktree-dialog fieldset { display: flex; flex-wrap: wrap; gap: 12px; border: 0; padding: 0; margin: 14px 0; }
.dsh-worktree-dialog fieldset label { display: flex; align-items: center; gap: 5px; cursor: pointer; }
.dsh-worktree-dialog input[type=radio] { accent-color: #4d6bfe; margin: 0; }
.dsh-worktree-dialog form > label { display: block; font-weight: 500; margin-bottom: 6px; }
.dsh-worktree-dialog input[type=text] { box-sizing: border-box; width: 100%; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l4, #dfe2e8); border-radius: 8px; background: var(--dsw-alias-bg-layer-1, #f7f8fa); color: inherit; font: inherit; }
.dsh-worktree-dialog .dsh-worktree-hint { font-size: 12px; }
.dsh-worktree-dialog footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.dsh-worktree-dialog .dsh-worktree-primary, .dsh-worktree-dialog .dsh-worktree-primary:hover:not(:disabled) { background: #4d6bfe; border-color: transparent; color: white; }
.dsh-worktree-dialog [role=alert] { color: var(--dsw-alias-state-error-primary, #b42318); }
.dsh-worktree button:disabled, .dsh-worktree-dialog button:disabled { opacity: .45; cursor: not-allowed; }
.dsh-worktree button:focus-visible, .dsh-worktree-dialog input:focus-visible { outline: 2px solid #4d6bfe; outline-offset: 2px; }
.dsh-worktree-sr { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
`
