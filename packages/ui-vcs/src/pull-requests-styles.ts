export const styles = `
.dsh-pr-panel{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-pr-panel>header{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-pr-panel>header>div{min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;flex:1}
.dsh-pr-panel>header strong{font-weight:500;font-size:12px}
.dsh-pr-repository,.dsh-pr-branch,.dsh-pr-meta,.dsh-pr-refs,.dsh-pr-panel footer{color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
.dsh-pr-repository{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pr-branch{display:flex;align-items:center;gap:6px;flex-basis:100%}
.dsh-pr-branch svg{width:14px;height:14px;flex-shrink:0}
.dsh-pr-refresh{width:28px;padding:0;flex-shrink:0}
.dsh-pr-refresh svg{width:16px;height:16px}
.dsh-pr-loading{display:inline-flex;flex-shrink:0;width:16px;height:16px;vertical-align:middle;color:var(--dsw-alias-label-secondary)}
.dsh-pr-loading svg{width:100%;height:100%;animation:dsh-pr-spin .8s linear infinite}
.dsh-pr-initial-loading{display:flex;justify-content:center;padding:24px 16px}
@keyframes dsh-pr-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dsh-pr-loading svg{animation:none}}
.dsh-pr-panel :is(a,textarea,summary,[role=tabpanel]):focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:-2px}
.dsh-pr-content{overflow:auto;flex:1;min-height:0}
.dsh-pr-content>p{padding:20px 16px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.dsh-pr-title a,.dsh-pr-check-name>a{color:inherit;text-decoration:none}
.dsh-pr-title a:hover,.dsh-pr-check-name>a:hover{text-decoration:underline;text-underline-offset:3px}
.dsh-pr-summary{display:flex;flex-direction:column;gap:12px;padding:20px 16px 16px}
.dsh-pr-title{margin:0;overflow-wrap:anywhere;line-height:1.45;font-size:16px;font-weight:600;letter-spacing:-.2px}
.dsh-pr-number{color:var(--dsw-alias-label-tertiary);font-weight:400;white-space:nowrap}
.dsh-pr-title svg{display:inline-block;width:14px;height:14px;margin-left:6px;color:var(--dsw-alias-label-tertiary);vertical-align:baseline}
.dsh-pr-meta{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px}
.dsh-pr-refs{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;white-space:nowrap}
.dsh-pr-refs>svg{width:14px;height:14px;flex-shrink:0}
.dsh-pr-refs code{min-width:0;overflow:hidden;text-overflow:ellipsis;padding:2px 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);font-size:11px;line-height:1.5}
.dsh-pr-refs code:last-child{flex-shrink:0;max-width:35%}
.dsh-pr-ci-trigger{gap:5px;padding:2px 0 2px 6px;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-pr-ci-trigger .dsh-pr-loading{width:12px;height:12px}
.dsh-pr-ci-trigger>svg{width:12px;height:12px;transition:transform .15s}
.dsh-pr-ci-trigger[aria-expanded=true]>svg{transform:rotate(180deg)}
.dsh-pr-ci-results{font-size:12px;max-height:40vh;overflow:auto}
.dsh-pr-ci-results>p{color:var(--dsw-alias-label-secondary)}
.dsh-pr-panel footer{padding:10px 16px;border-top:.5px solid var(--dsw-alias-border-l2);line-height:1.5}
.dsh-pr-panel footer p{margin:4px 0}
.dsh-pr-tabs{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1);padding:0 16px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-pr-section{padding:20px 16px;min-width:0;overflow-wrap:anywhere;line-height:1.6}
.dsh-pr-section>h3,.dsh-pr-section form>h3{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;margin:0 0 12px;color:var(--dsw-alias-label-secondary)}
.dsh-pr-section>p,.dsh-pr-section form>p{font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0;line-height:1.6}
.dsh-pr-section img{max-width:100%}
.dsh-pr-section table{display:block;overflow-x:auto;max-width:100%}
.dsh-pr-section pre{max-width:100%;overflow:auto}
.dsh-pr-checks,.dsh-pr-files{list-style:none;margin:0;padding:0}
.dsh-pr-heading{margin:0 0 12px}
.dsh-pr-heading>summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;padding:4px 0}
.dsh-pr-heading>summary::-webkit-details-marker{display:none}
.dsh-pr-heading>summary:hover{color:var(--dsw-alias-label-primary)}
.dsh-pr-heading>summary>svg{width:14px;height:14px;flex-shrink:0;color:var(--dsw-alias-label-tertiary);transform:rotate(-90deg);transition:transform .15s}
.dsh-pr-heading[open]>summary>svg{transform:rotate(0)}
.dsh-pr-heading>summary>div{min-width:0;flex:1}
.dsh-pr-heading>summary :is(h1,h2,h3,h4,h5,h6){margin:0;font-size:13px;line-height:1.6}
.dsh-pr-heading-content{margin:4px 0 0 6px;padding-left:15px;border-left:.5px solid var(--dsw-alias-border-l2)}
.dsh-pr-heading-content>.dsh-pr-heading{margin-top:12px}
.dsh-pr-panel .dsh-pr-merge-footer{flex-shrink:0;padding:12px 16px;background:var(--dsw-alias-bg-layer-1)}
.dsh-pr-merge-menu{display:block;width:100%}
.dsh-pr-merge-button{display:flex;align-items:stretch}
.dsh-pr-merge-button>button:first-child{flex:1;min-width:0;border-radius:var(--dsw-radius-md) 0 0 var(--dsw-radius-md)}
.dsh-pr-merge-button>button:last-child{flex-shrink:0;width:36px;padding:0;border-left:.5px solid var(--dsw-alias-border-l4);border-radius:0 var(--dsw-radius-md) var(--dsw-radius-md) 0}
.dsh-pr-merge-button svg{width:16px;height:16px}
.dsh-pr-checks li{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsh-pr-check-name{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex:1;min-width:0;overflow-wrap:anywhere}
.dsh-pr-check-name>a{min-width:0}
.dsh-pr-check-name small{flex-shrink:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-pr-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.dsh-pr-choice{flex:1;min-width:0}
.dsh-pr-picker{width:100%;justify-content:space-between;background:var(--dsw-alias-bg-module-platform)}
.dsh-pr-picker>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pr-picker>svg{width:14px;height:14px;flex-shrink:0}
.dsh-pr-panel label{display:flex;flex-direction:column;gap:6px;font-size:12px}
.dsh-pr-panel textarea{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:inherit;font:inherit;padding:10px 12px;line-height:1.5}
.dsh-pr-panel textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.dsh-pr-panel textarea:disabled{color:var(--dsw-alias-label-tertiary)}
.dsh-pr-panel .dsh-pr-warning{padding:10px 16px;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:1.6}
.dsh-pr-files{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);overflow:hidden}
.dsh-pr-files:empty{display:none}
.dsh-pr-files li{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px}
.dsh-pr-files li:last-child{border-bottom:0}
.dsh-pr-files code{overflow-wrap:anywhere;min-width:0}
.dsh-pr-directory{color:var(--dsw-alias-label-tertiary)}
.dsh-pr-file-count{display:flex;gap:8px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dsh-pr-additions{color:var(--dsw-alias-state-success-primary)}
.dsh-pr-deletions{color:var(--dsw-alias-state-error-primary)}
.dsh-pr-diff{margin-top:20px}
.dsh-pr-diff summary{cursor:pointer;padding:6px 0}
.dsh-pr-diff pre{max-height:60vh}
.dsh-pr-comment{padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);margin-bottom:12px}
.dsh-pr-comment>strong{font-size:12px;font-weight:500}
.dsh-pr-confirm-content{max-height:60vh;overflow:auto;overflow-wrap:anywhere;font-size:13px;line-height:1.6}
.dsh-pr-confirm-content>strong{font-weight:500}
.dsh-pr-confirm-content>p{margin:8px 0}
.dsh-pr-confirm-content>code{font-size:12px;word-break:break-all;color:var(--dsw-alias-label-secondary)}
.dsh-pr-confirm-content pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;font:inherit}
`
