export const styles = `
.dsh-pr-panel{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-pr-panel>header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-pr-panel>header>div{min-width:0;display:flex;flex-direction:column;gap:6px}
.dsh-pr-panel strong{font-weight:500}
.dsh-pr-repository,.dsh-pr-branch,.dsh-pr-meta,.dsh-pr-refs,.dsh-pr-panel footer{color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
.dsh-pr-branch{display:flex;align-items:center;gap:6px}
.dsh-pr-branch svg{width:14px;height:14px;flex-shrink:0}
.dsh-pr-panel button{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;border-radius:6px;min-height:30px;padding:4px 10px;cursor:pointer;font:inherit}
.dsh-pr-panel>header>button{border:0;width:28px;height:28px;padding:0;flex-shrink:0;font-size:20px}
.dsh-pr-panel button:hover,.dsh-pr-panel a:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-pr-panel button:disabled{opacity:.4;cursor:default}
.dsh-pr-panel :is(a,button,select,textarea,summary,pre):focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.dsh-pr-content{overflow:auto;flex:1;min-height:0}
.dsh-pr-content>p{padding:20px 16px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.dsh-pr-request{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-pr-panel a{color:inherit;text-decoration:none}
.dsh-pr-panel a:not(.dsh-pr-summary){text-decoration:underline;text-underline-offset:3px}
.dsh-pr-summary{display:flex;flex-direction:column;gap:7px;padding:14px 16px}
.dsh-pr-title{display:flex;justify-content:space-between;gap:12px;overflow-wrap:anywhere;line-height:1.5}
.dsh-pr-title>span{color:var(--dsw-alias-label-secondary);flex-shrink:0}
.dsh-pr-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-pr-status{margin-left:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:1px 5px}
.dsh-pr-panel footer{padding:10px 16px;border-top:1px solid var(--dsw-alias-border-l2);line-height:1.5}
.dsh-pr-panel footer p{margin:4px 0}
.dsh-pr-tabs{display:flex;position:sticky;top:0;z-index:1;border-block:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);padding:0 10px}
.dsh-pr-tabs button{flex:1;border:0;border-radius:0;padding:10px 4px;font-size:12px;white-space:nowrap;border-bottom:2px solid transparent}
.dsh-pr-tabs button[aria-pressed=true]{border-bottom-color:var(--dsw-alias-state-business-primary);font-weight:600}
.dsh-pr-section{padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l2);min-width:0;overflow-wrap:anywhere;line-height:1.6}
.dsh-pr-panel h3{font-size:13px;font-weight:600;margin:0 0 10px}
.dsh-pr-section h3>span{font-size:12px;color:var(--dsw-alias-label-secondary);font-weight:400;margin-left:5px}
.dsh-pr-section>p,.dsh-pr-section form>p,.dsh-pr-confirm>p{font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0;line-height:1.6}
.dsh-pr-section img{max-width:100%}
.dsh-pr-section table{display:block;overflow-x:auto;max-width:100%}
.dsh-pr-section pre{max-width:100%;overflow:auto}
.dsh-pr-description{max-height:280px;overflow:auto}
.dsh-pr-checks,.dsh-pr-files{list-style:none;margin:0;padding:0}
.dsh-pr-checks li{display:flex;align-items:flex-start;gap:8px;padding:6px 0}
.dsh-pr-check-icon{font-size:15px;flex-shrink:0}
.dsh-pr-check-icon.success{color:var(--dsw-alias-state-success-primary,#6eae80)}
.dsh-pr-check-icon.failure{color:var(--dsw-alias-state-error-primary,#df7f7f)}
.dsh-pr-check-icon.pending{color:var(--dsw-alias-state-warning-primary,#c9b273)}
.dsh-pr-check-name{min-width:0;overflow-wrap:anywhere}
.dsh-pr-check-name small{display:block;font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsh-pr-facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;font-size:12px;margin:8px 0}
.dsh-pr-facts dt{color:var(--dsw-alias-label-secondary)}
.dsh-pr-facts dd{margin:0;overflow-wrap:anywhere}
.dsh-pr-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.dsh-pr-actions select{flex:1;min-width:0}
.dsh-pr-panel select,.dsh-pr-panel textarea{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;padding:6px 8px}
.dsh-pr-panel select:disabled,.dsh-pr-panel textarea:disabled{opacity:.5}
.dsh-pr-panel label{display:flex;flex-direction:column;gap:6px;font-size:12px}
.dsh-pr-panel textarea{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;line-height:1.6}
.dsh-pr-panel .dsh-pr-warning{padding:10px 16px;color:var(--dsw-alias-state-warning-primary,#c9b273);font-size:12px;line-height:1.6}
.dsh-pr-files li{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:11px}
.dsh-pr-files code{overflow-wrap:anywhere;min-width:0}
.dsh-pr-files li>span{white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.dsh-pr-diff{margin-top:14px}
.dsh-pr-diff summary{cursor:pointer;padding:6px 0}
.dsh-pr-diff pre{font-size:11px;line-height:1.6;padding:10px;background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;white-space:pre;overflow:auto;max-height:60vh}
.dsh-pr-comment{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:12px}
.dsh-pr-comment>strong{font-size:12px}
.dsh-pr-confirm{margin:16px;padding:14px;border:1px solid var(--dsw-alias-state-business-primary);border-radius:8px;overflow-wrap:anywhere}
.dsh-pr-confirm>code{font-size:11px;word-break:break-all}
.dsh-pr-confirm pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font:inherit}
`
