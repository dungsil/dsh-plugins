import { composerStyles } from '@dungsil/dsh-ui/composer'

export const styles = `${composerStyles}
.dsh-codex-picker { display: flex; align-items: center; min-width: 0; }
.dsh-codex-trigger { max-width: min(360px, 45cqw); font-weight: 400; outline: none; }
.dsh-codex-trigger:focus-visible:not([data-dsh-automatic-focus]) { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.dsh-codex-trigger .dsh-plugin-composer-icon { display: var(--dsh-composer-model-icon-display, none); }
.dsh-codex-trigger .dsh-plugin-composer-chevron { transition: transform .12s; }
.dsh-codex-trigger .dsh-plugin-composer-label, .dsh-codex-trigger .dsh-plugin-composer-detail { display: var(--dsh-composer-model-text-display, block); }
.dsh-codex-trigger .dsh-plugin-composer-detail { flex-shrink: 1000; }
.dsh-codex-popover { position: fixed; z-index: 1100; display: flex; flex-direction: column; inset: auto; margin: 0; box-sizing: border-box; width: 256px; max-width: calc(100vw - 32px); max-height: min(360px, calc(100dvh - 96px)); overflow: hidden; padding: 4px; border: 0; --dsw-elevation-stroke-color: var(--dsw-alias-border-l1); --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); background: transparent; color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-prominent); font: 13px/1.5385 var(--dsw-font-family, system-ui); }
@media (prefers-reduced-motion: reduce) {
  .dsh-codex-trigger .dsh-plugin-composer-chevron { transition: none; }
}
.dsh-codex-popover > :not(.dsh-codex-models) { flex-shrink: 0; }
.dsh-codex-models { min-height: 0; overflow-y: auto; }
.dsh-codex-header { display: grid; grid-template-columns: 24px minmax(0, 1fr) 24px; align-items: start; gap: 4px; }
.dsh-codex-model, .dsh-codex-reset, .dsh-codex-back { border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; border-radius: var(--dsw-radius-md); }
.dsh-codex-popover svg { flex: none; vertical-align: middle; }
.dsh-codex-model { grid-column: 2; justify-self: center; min-width: 0; max-width: 100%; padding: 2px 10px 3px; text-align: center; }
.dsh-codex-model strong { display: block; color: var(--dsw-alias-state-business-primary); font-size: 14px; line-height: 1.4286; font-weight: 600; }
.dsh-codex-model > span { display: block; color: var(--dsw-alias-label-tertiary, #777); font-size: 12px; line-height: 1.4167; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-codex-reset { display: grid; place-items: center; width: 24px; height: 24px; color: var(--dsw-alias-label-tertiary, #999); }
.dsh-codex-reset svg { width: 16px; height: 16px; }
.dsh-codex-back { padding: 4px 8px; color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-popover h2, .dsh-codex-provider { margin: 0; padding: 6px 10px; font-size: 12px; font-weight: 400; color: var(--dsw-alias-label-tertiary, #777); }
.dsh-codex-provider { font-size: 11px; padding-top: 10px; }
.dsh-codex-option { box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; min-height: 34px; padding: 5px 7px; border: 0; border-radius: var(--dsw-radius-md); color: inherit; background: transparent; text-align: left; font: inherit; cursor: pointer; }
.dsh-codex-option:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
@media (hover: hover) {
  .dsh-codex-trigger:hover:not(:disabled), .dsh-codex-option:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
  .dsh-codex-model:hover, .dsh-codex-reset:hover, .dsh-codex-back:hover { background: var(--dsw-alias-interactive-bg-hover, #f2f2f2); }
}
.dsh-codex-option span:first-child { min-width: 0; overflow-wrap: anywhere; }
.dsh-codex-option small { display: block; color: var(--dsw-alias-label-tertiary, #777); font-size: 11px; }
.dsh-codex-option .dsh-codex-check { display: grid; place-items: center; flex: 0 0 14px; }
.dsh-codex-slider { padding: 10px 2px 3px; }
.dsh-codex-apply { justify-content: center; margin-top: 4px; color: var(--dsw-alias-state-business-primary); }
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
.dsh-codex-status { position: absolute; width: 1px; height: 1px; padding: 0; margin: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.dsh-codex-popover [role=alert] { color: var(--dsw-alias-state-error-primary, #b54424); }
.dsh-codex-popover :focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.dsh-codex-popover :disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
`
