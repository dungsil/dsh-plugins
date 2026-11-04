export const styles = `
.dsh-pr-panel{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-pr-panel header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-pr-panel header>div{min-width:0;display:flex;flex-direction:column;gap:6px}
.dsh-pr-panel strong{font-weight:500}
.dsh-pr-repository,.dsh-pr-branch,.dsh-pr-meta,.dsh-pr-refs,.dsh-pr-panel footer{color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
.dsh-pr-branch{display:flex;align-items:center;gap:6px}
.dsh-pr-branch svg{width:14px;height:14px;flex-shrink:0}
.dsh-pr-panel button{border:0;background:transparent;color:inherit;border-radius:6px;width:28px;height:28px;flex-shrink:0;cursor:pointer;font-size:20px}
.dsh-pr-panel button:hover,.dsh-pr-panel a:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-pr-panel button:disabled{opacity:.4;cursor:default}
.dsh-pr-panel :is(a,button):focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dsh-pr-content{overflow:auto;flex:1;min-height:0}
.dsh-pr-content>p{padding:20px 16px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.dsh-pr-request{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-pr-panel a{display:flex;flex-direction:column;gap:7px;padding:14px 16px;color:inherit;text-decoration:none}
.dsh-pr-title{display:flex;justify-content:space-between;gap:12px;overflow-wrap:anywhere;line-height:1.5}
.dsh-pr-title>span{color:var(--dsw-alias-label-secondary);flex-shrink:0}
.dsh-pr-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-pr-status{margin-left:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:1px 5px}
.dsh-pr-panel footer{padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l2);line-height:1.5}
.dsh-pr-panel footer p{margin:4px 0}
`
