export const styles = `
.dsh-codex-picker { display: flex; align-items: center; min-width: 0; border-radius: 16px; color: var(--dsw-alias-label-primary, #252525); font: 13px/20px system-ui, sans-serif; }
.dsh-codex-picker button { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; height: 28px; padding: 0 6px; border-radius: 14px; min-width: 0; }
.dsh-codex-picker:hover { background: var(--dsw-alias-interactive-bg-hover, #8881); }
.dsh-codex-picker .dsh-codex-trigger { display: flex; gap: 5px; align-items: center; }
.dsh-codex-chevron { display: inline-block; flex: 0 0 14px; vertical-align: middle; }
.dsh-codex-name { display: var(--dsh-composer-model-text-display, block); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: min(220px, 32vw); }
.dsh-codex-effort { color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-popover { position: fixed; inset: auto; margin: 0; box-sizing: border-box; width: 256px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow-y: auto; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, #e8e8e8); border-radius: 16px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #252525); box-shadow: 0 5px 12px #0000000d, 0 2px 4px #00000005; font: 13px/20px system-ui, sans-serif; }
.dsh-codex-popover::backdrop { background: transparent; }
.dsh-codex-header { display: grid; grid-template-columns: 24px minmax(0, 1fr) 24px; align-items: start; gap: 4px; }
.dsh-codex-model, .dsh-codex-reset, .dsh-codex-back { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; border-radius: 6px; }
.dsh-codex-model { grid-column: 2; justify-self: center; min-width: 0; max-width: 100%; padding: 2px 10px 3px; text-align: center; }
.dsh-codex-model strong { display: block; color: #3983ff; font-size: 14px; line-height: 20px; font-weight: 600; }
.dsh-codex-model > span { display: block; color: var(--dsw-alias-label-tertiary, #777); font-size: 12px; line-height: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-codex-model:hover, .dsh-codex-reset:hover, .dsh-codex-back:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f2f2); }
.dsh-codex-reset { display: grid; place-items: center; width: 24px; height: 24px; color: var(--dsw-alias-label-tertiary, #999); }
.dsh-codex-back { padding: 4px 8px; color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-popover h2, .dsh-codex-provider { margin: 0; padding: 6px 10px; font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-provider { font-size: 11px; padding-top: 10px; }
.dsh-codex-option { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 30px; padding: 5px 10px; border: 0; border-radius: 9px; color: inherit; background: transparent; text-align: left; font: inherit; cursor: pointer; }
.dsh-codex-option:hover, .dsh-codex-option[aria-checked=true] { background: var(--dsw-alias-interactive-bg-hover, #f4f4f4); }
.dsh-codex-option span:first-child { min-width: 0; overflow-wrap: anywhere; }
.dsh-codex-option small { display: block; color: var(--dsw-alias-label-tertiary, #777); font-size: 11px; }
.dsh-codex-option .dsh-codex-check { flex: 0 0 14px; }
.dsh-codex-slider { padding: 10px 2px 3px; }
.dsh-codex-rail { position: relative; height: 28px; }
.dsh-codex-track { position: absolute; inset: 3px 0; border-radius: 20px; background: linear-gradient(to right, #3983ff var(--dsh-codex-progress), var(--dsw-alias-interactive-bg-hover, #e8e8e8) var(--dsh-codex-progress)); display: flex; align-items: center; justify-content: space-between; padding: 0 12px; }
.dsh-codex-track span { width: 4px; height: 4px; border-radius: 50%; background: #b8b8b8; }
.dsh-codex-track span[data-filled=true] { background: #ffffff80; }
.dsh-codex-slider input { appearance: none; -webkit-appearance: none; position: relative; display: block; width: 100%; height: 28px; padding: 0; margin: 0; background: transparent; cursor: pointer; }
.dsh-codex-slider input::-webkit-slider-runnable-track { height: 28px; background: transparent; }
.dsh-codex-slider input::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 28px; height: 28px; border: 1px solid #0000000a; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0002; }
.dsh-codex-slider input::-moz-range-track { height: 28px; background: transparent; }
.dsh-codex-slider input::-moz-range-thumb { width: 26px; height: 26px; border: 1px solid #0000000a; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0002; }
.dsh-codex-notice { padding: 6px 10px; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.dsh-codex-popover [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
.dsh-codex-picker button:focus-visible, .dsh-codex-popover :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, #3186ce); outline-offset: 2px; }
.dsh-codex-picker button:disabled, .dsh-codex-popover :disabled { opacity: .5; cursor: default; }
`
