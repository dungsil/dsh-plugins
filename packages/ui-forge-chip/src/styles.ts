export const styles = `
.dsh-forge-chip { box-sizing: border-box; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; width: calc(100% - 2 * var(--dsh-composer-side-clearance) - 4 * var(--dsh-composer-dock-inset)); max-width: calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset)); margin: 0 auto; padding-bottom: 8px; }
.dsh-forge-chip-actions { display: inline-flex; align-items: center; max-width: 100%; min-width: 0; }
.dsh-forge-chip-actions > .dsh-forge-chip-trigger { border-radius: 14px 0 0 14px; }
.dsh-forge-chip-actions .dsh-forge-chip-menu { flex: none; border-radius: 0 14px 14px 0; border-left: 0; padding: 0 7px; }
.dsh-forge-chip-trigger { min-height: 28px; height: auto; max-width: 100%; padding: 4px 10px; border: 1px solid var(--dsw-alias-border-l2); font: inherit; font-size: 12px; line-height: 18px; white-space: normal; overflow-wrap: anywhere; }
.dsh-forge-chip-trigger svg { flex: none; width: 14px; height: 14px; }
.dsh-forge-chip-trigger:disabled { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-forge-chip-trigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 0; }
@media (pointer: coarse) { .dsh-forge-chip-trigger { min-height: 44px; } .dsh-forge-chip-actions .dsh-forge-chip-menu { min-width: 44px; } }
`
