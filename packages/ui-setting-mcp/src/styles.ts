export const styles = `
.dsh-mcp-settings{max-width:100%;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.dsh-mcp-settings h2{font-size:var(--dsw-font-s-14-font-size);margin:12px 0}
.dsh-mcp-help,.dsh-mcp-settings small{color:var(--dsw-alias-label-secondary);line-height:1.6}
.dsh-mcp-toolbar,.dsh-mcp-card-header,.dsh-mcp-details,.dsh-mcp-activation,.dsh-mcp-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dsh-mcp-toolbar{margin:16px 0}.dsh-mcp-toolbar input{flex:1 1 180px;min-width:0}
.dsh-mcp-card{padding:16px 2px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-mcp-card-header strong{overflow-wrap:anywhere}.dsh-mcp-card-header{gap:8px}
.dsh-mcp-tag{font-size:12px;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);padding:2px 6px}
.dsh-mcp-status{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-mcp-status[data-state=connected]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-label-primary))}
.dsh-mcp-status[data-state=failed]{color:var(--dsw-alias-state-error-primary)}
.dsh-mcp-details{margin:6px 0 10px;color:var(--dsw-alias-label-secondary)}
.dsh-mcp-activation,.dsh-mcp-actions{margin-top:10px}.dsh-mcp-settings [role=alert]{color:var(--dsw-alias-state-error-primary)}
.dsh-mcp-modal{min-width:min(430px,85vw);max-height:70vh;overflow:auto}
.dsh-mcp-field{margin:14px 0;display:flex;flex-direction:column;gap:6px}
.dsh-mcp-field input,.dsh-mcp-field select{width:100%;box-sizing:border-box}
.dsh-mcp-field select{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);padding:8px;color:inherit}
.dsh-mcp-field small{overflow-wrap:anywhere;font-size:12px}
`
