export const styles = `
.dsh-codex-picker { display: flex; align-items: center; min-width: 0; border-radius: 16px; color: var(--dsw-alias-label-primary, #252525); font: 13px/20px system-ui, sans-serif; }
.dsh-codex-picker button { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; height: 28px; padding: 0 6px; border-radius: 14px; min-width: 0; }
.dsh-codex-picker:hover { background: var(--dsw-alias-interactive-bg-hover, #8881); }
.dsh-codex-picker .dsh-codex-model { display: flex; gap: 5px; align-items: center; }
.dsh-codex-name { display: var(--dsh-composer-model-text-display, block); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: min(220px, 32vw); }
.dsh-codex-icon { flex: none; }
.dsh-codex-picker .dsh-codex-effort { display: var(--dsh-composer-model-text-display, block); color: var(--dsw-alias-label-tertiary, #777); white-space: nowrap; }
.dsh-codex-popover { position: fixed; inset: auto; margin: 0; box-sizing: border-box; width: 280px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow-y: auto; padding: 6px; border: 1px solid var(--dsw-alias-border-l1, #dedede); border-radius: 16px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #252525); box-shadow: 0 8px 30px #0002, 0 1px 3px #0001; font: 13px/20px system-ui, sans-serif; }
.dsh-codex-popover::backdrop { background: transparent; }
.dsh-codex-popover h2, .dsh-codex-provider { margin: 0; padding: 6px 10px; font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-provider { font-size: 11px; padding-top: 10px; }
.dsh-codex-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 30px; padding: 5px 10px; border: 0; border-radius: 9px; color: inherit; background: transparent; text-align: left; font: inherit; cursor: pointer; }
.dsh-codex-option:hover, .dsh-codex-option[aria-checked=true] { background: var(--dsw-alias-interactive-bg-hover, #f4f4f4); }
.dsh-codex-option span:first-child { min-width: 0; overflow-wrap: anywhere; }
.dsh-codex-option small { display: block; color: var(--dsw-alias-label-tertiary, #777); font-size: 11px; }
.dsh-codex-option .dsh-codex-check { flex: 0 0 14px; }
.dsh-codex-slider { padding: 12px 14px 16px; text-align: center; }
.dsh-codex-slider label { display: block; color: var(--dsw-alias-state-business-primary, #3186ce); font-size: 15px; font-weight: 500; }
.dsh-codex-slider p { margin: 4px 0 18px; color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-slider input { width: 100%; margin: 0; accent-color: var(--dsw-alias-state-business-primary, #3186ce); cursor: pointer; }
.dsh-codex-slider footer { display: flex; justify-content: space-between; color: var(--dsw-alias-label-tertiary, #777); font-size: 11px; margin-top: 6px; }
.dsh-codex-notice { padding: 6px 10px; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.dsh-codex-popover [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
.dsh-codex-picker button:focus-visible, .dsh-codex-popover :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #3186ce); outline-offset: 2px; }
.dsh-codex-picker button:disabled, .dsh-codex-popover :disabled { opacity: .5; cursor: default; }
`
