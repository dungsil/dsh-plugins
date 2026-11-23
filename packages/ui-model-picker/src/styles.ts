// The official model menu owns the surface; these rules style only the rows this plugin adds to it.
// `.dsh-picker-cell` mirrors the official root-menu cell so added rows keep the same rhythm.
export const styles = `
.dsh-effort { --dsh-effort-thumb: 28px; --dsh-effort-track: 24px; --dsh-effort-accent: var(--dsw-alias-state-business-primary); padding: 6px 2px 10px; color: var(--dsw-alias-label-primary); }
.dsh-effort-header { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 2px 0 6px; font-size: 13px; line-height: 20px; }
.dsh-effort-label { flex: 1 1 auto; min-width: 0; white-space: nowrap; }
.dsh-effort-value { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); }
.dsh-effort-track { position: relative; height: var(--dsh-effort-track); margin-top: 8px; border-radius: 999px; }
.dsh-effort-rail { position: absolute; inset: 0 calc((var(--dsh-effort-thumb) - var(--dsh-effort-track)) / 2); overflow: hidden; border-radius: inherit; background: var(--dsw-alias-border-l2); pointer-events: none; }
.dsh-effort-fill { position: absolute; inset: 0 auto 0 0; background: var(--dsh-effort-accent); }
.dsh-effort-dots { position: absolute; inset: 0 calc(var(--dsh-effort-thumb) / 2); pointer-events: none; }
.dsh-effort-dot { position: absolute; top: 50%; width: 4px; height: 4px; border-radius: 50%; background: color-mix(in srgb, var(--dsh-effort-accent) 30%, transparent); transform: translate(-50%, -50%); }
.dsh-effort-dot[data-filled=true] { background: color-mix(in srgb, var(--dsw-alias-label-primary-foreground) 40%, transparent); }
.dsh-effort-input { position: absolute; inset: 0; box-sizing: border-box; width: 100%; min-width: 0; height: var(--dsh-effort-track); margin: 0; padding: 0; border: 0; appearance: none; -webkit-appearance: none; background: transparent; cursor: pointer; }
.dsh-effort-input::-webkit-slider-runnable-track { height: var(--dsh-effort-track); background: transparent; }
.dsh-effort-input::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; box-sizing: border-box; width: var(--dsh-effort-thumb); height: var(--dsh-effort-thumb); margin-top: calc((var(--dsh-effort-track) - var(--dsh-effort-thumb)) / 2); border: 1px solid var(--dsw-alias-border-l1); border-radius: 50%; background: var(--dsw-alias-label-primary-foreground); box-shadow: var(--dsw-shadow-lv1); }
.dsh-effort-input::-moz-range-track { height: var(--dsh-effort-track); background: transparent; }
.dsh-effort-input::-moz-range-thumb { box-sizing: border-box; width: var(--dsh-effort-thumb); height: var(--dsh-effort-thumb); border: 1px solid var(--dsw-alias-border-l1); border-radius: 50%; background: var(--dsw-alias-label-primary-foreground); box-shadow: var(--dsw-shadow-lv1); }
.dsh-effort-input:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; border-radius: 999px; }
.dsh-effort-input:disabled, .dsh-effort-input[aria-disabled=true] { cursor: default; }
.dsh-effort:has(.dsh-effort-input:disabled) .dsh-effort-track { opacity: .5; }
.dsh-picker-star { display: grid; place-items: center; flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; outline: none; }
.dsh-picker-star svg { width: 14px; height: 14px; }
.dsh-picker-star[aria-checked=true] { color: var(--dsw-alias-state-business-primary); }
.dsh-picker-star[aria-checked=true] svg { fill: currentColor; }
.dsh-picker-star:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-picker-cell { box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: auto; min-width: 100%; min-height: 34px; padding: 0 8px; border: none; border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; outline: none; }
.dsh-picker-cell:focus-visible { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-picker-cell:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-picker-cell-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-picker-cell-value { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: right; color: var(--dsw-alias-label-tertiary); }
.dsh-picker-cell-label small { display: block; overflow: hidden; text-overflow: ellipsis; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; }
.dsh-picker-cell svg { flex: 0 0 auto; width: 12px; height: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-picker-cell .dsh-picker-check svg { width: 14px; height: 14px; color: var(--dsw-alias-label-primary); }
.dsh-picker-favorites-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 2px 2px 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dsh-picker-favorite { display: flex; align-items: center; gap: 2px; }
.dsh-picker-favorite .dsh-picker-cell { flex: 1; min-width: 0; }
.dsh-picker-empty { margin: 0; padding: 8px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
@media (hover: hover) {
  .dsh-picker-cell:hover:not(:disabled), .dsh-picker-star:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
`
