export const styles = `
.dsh-codex-picker { display: flex; align-items: center; min-width: 0; }
.dsh-codex-trigger { display: flex; align-items: center; gap: 4px; min-width: 0; max-width: min(360px, 45cqw); height: 28px; padding: 0 4px 0 8px; border: none; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font-family: inherit; font-size: 13px; font-weight: 400; line-height: 20px; cursor: pointer; outline: none; }
.dsh-codex-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-codex-trigger:focus-visible { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.dsh-codex-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-codex-trigger-icon { display: var(--dsh-composer-model-icon-display, none); flex: none; }
.dsh-codex-chevron { color: var(--dsw-alias-label-caption); flex: none; transition: transform .12s; }
.dsh-codex-trigger[aria-expanded=true] .dsh-codex-chevron { transform: rotate(180deg); }
.dsh-codex-name, .dsh-codex-effort { display: var(--dsh-composer-model-text-display, block); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-codex-effort { color: var(--dsw-alias-label-caption); flex-shrink: 1000; }
.dsh-codex-popover { position: fixed; inset: auto; margin: 0; box-sizing: border-box; width: 256px; max-width: calc(100vw - 32px); max-height: min(360px, calc(100dvh - 96px)); overflow: hidden; padding: 4px; border: 0; --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-prominent); font: 13px/20px var(--dsw-font-family, system-ui); }
.dsh-codex-popover:popover-open { display: flex; flex-direction: column; }
.dsh-codex-popover > :not([role=radiogroup]) { flex-shrink: 0; }
.dsh-codex-popover [role=radiogroup] { min-height: 0; overflow-y: auto; }
.dsh-codex-popover::backdrop { background: transparent; }
.dsh-codex-header { display: grid; grid-template-columns: 24px minmax(0, 1fr) 24px; align-items: start; gap: 4px; }
.dsh-codex-model, .dsh-codex-reset, .dsh-codex-back { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; border-radius: var(--dsw-radius-md); }
.dsh-codex-popover svg { flex: none; vertical-align: middle; }
.dsh-codex-model { grid-column: 2; justify-self: center; min-width: 0; max-width: 100%; padding: 2px 10px 3px; text-align: center; }
.dsh-codex-model strong { display: block; color: var(--dsw-alias-state-business-primary); font-size: 14px; line-height: 20px; font-weight: 600; }
.dsh-codex-model > span { display: block; color: var(--dsw-alias-label-tertiary, #777); font-size: 12px; line-height: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-codex-model:hover, .dsh-codex-reset:hover, .dsh-codex-back:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f2f2); }
.dsh-codex-reset { display: grid; place-items: center; width: 24px; height: 24px; color: var(--dsw-alias-label-tertiary, #999); }
.dsh-codex-back { padding: 4px 8px; color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-popover h2, .dsh-codex-provider { margin: 0; padding: 6px 10px; font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-provider { font-size: 11px; padding-top: 10px; }
.dsh-codex-option { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; min-height: 34px; padding: 5px 7px; border: 0; border-radius: var(--dsw-radius-md); color: inherit; background: transparent; text-align: left; font: inherit; cursor: pointer; }
.dsh-codex-option:hover:not(:disabled), .dsh-codex-option:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-codex-option span:first-child { min-width: 0; overflow-wrap: anywhere; }
.dsh-codex-option small { display: block; color: var(--dsw-alias-label-tertiary, #777); font-size: 11px; }
.dsh-codex-option .dsh-codex-check { display: grid; place-items: center; flex: 0 0 14px; }
.dsh-codex-slider { padding: 10px 2px 3px; }
.dsh-codex-rail { position: relative; height: 28px; }
.dsh-codex-track { position: absolute; inset: 3px 0; border-radius: 20px; background: linear-gradient(to right, var(--dsw-alias-state-business-primary) var(--dsh-codex-progress), var(--dsw-alias-interactive-bg-hover) var(--dsh-codex-progress)); display: flex; align-items: center; justify-content: space-between; padding: 0 12px; }
.dsh-codex-track span { width: 4px; height: 4px; border-radius: 50%; background: #b8b8b8; }
.dsh-codex-track span[data-filled=true] { background: #ffffff80; }
.dsh-codex-slider input { appearance: none; -webkit-appearance: none; position: relative; display: block; width: 100%; height: 28px; padding: 0; margin: 0; background: transparent; cursor: pointer; }
.dsh-codex-slider input::-webkit-slider-runnable-track { height: 28px; background: transparent; }
.dsh-codex-slider input::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 28px; height: 28px; border: 1px solid #0000000a; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0002; }
.dsh-codex-slider input::-moz-range-track { height: 28px; background: transparent; }
.dsh-codex-slider input::-moz-range-thumb { width: 26px; height: 26px; border: 1px solid #0000000a; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0002; }
.dsh-codex-notice { padding: 6px 10px; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.dsh-codex-popover [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
.dsh-codex-popover :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.dsh-codex-popover :disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
`
