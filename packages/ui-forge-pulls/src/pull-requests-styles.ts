export const styles = `
.dsh-forge-pulls-panel{height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px}
.dsh-forge-pulls-panel>header{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-forge-pulls-panel>header>div{min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;flex:1}
.dsh-forge-pulls-panel>header strong{font-weight:500;font-size:12px}
.dsh-forge-pulls-repository,.dsh-forge-pulls-branch,.dsh-forge-pulls-meta,.dsh-forge-pulls-refs,.dsh-forge-pulls-panel footer{color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
.dsh-forge-pulls-repository{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-forge-pulls-branch{display:flex;align-items:center;gap:6px;flex-basis:100%}
.dsh-forge-pulls-branch svg{width:14px;height:14px;flex-shrink:0}
.dsh-forge-pulls-refresh{width:28px;padding:0;flex-shrink:0}
.dsh-forge-pulls-refresh svg{width:16px;height:16px}
.dsh-forge-pulls-loading{display:inline-flex;flex-shrink:0;width:16px;height:16px;vertical-align:middle;color:var(--dsw-alias-label-secondary)}
.dsh-forge-pulls-loading svg{width:100%;height:100%;animation:dsh-forge-pulls-spin .8s linear infinite}
.dsh-forge-pulls-initial-loading{display:flex;justify-content:center;padding:24px 16px}
.dsh-forge-pulls-session-request svg{width:100%;height:100%}
.dsh-forge-pulls-check-status{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;vertical-align:middle;color:var(--dsw-alias-label-tertiary)}
.dsh-forge-pulls-check-status>span{display:inline-flex;width:100%;height:100%;align-items:center;justify-content:center}
.dsh-forge-pulls-check-status svg{display:block;flex:none;width:100%;height:100%;transform-origin:center}
.dsh-forge-pulls-check-status[data-state=done]{color:var(--dsw-alias-state-success-primary)}
.dsh-forge-pulls-check-status[data-state=error]{color:var(--dsw-alias-state-error-primary)}
.dsh-forge-pulls-check-status:is([data-state=ongoing],[data-state=warning]){color:var(--dsw-alias-state-warn-primary)}
.dsh-forge-pulls-check-status[data-state=ongoing] svg{animation:dsh-forge-pulls-spin 1.5s linear infinite}
@keyframes dsh-forge-pulls-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.dsh-forge-pulls-loading svg,.dsh-forge-pulls-check-status[data-state=ongoing] svg{animation:none}.dsh-forge-pulls-ci-trigger>svg,.dsh-forge-pulls-heading>summary>svg{transition:none}}
.dsh-forge-pulls-panel :is(a,textarea,summary,[role=tabpanel]):focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:-2px}
.dsh-forge-pulls-content{overflow:auto;overscroll-behavior:contain;flex:1;min-height:0}
.dsh-forge-pulls-content>p{padding:20px 16px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.dsh-forge-pulls-title a,.dsh-forge-pulls-check-name>a{color:inherit;text-decoration:none}
@media(hover:hover){.dsh-forge-pulls-title a:hover,.dsh-forge-pulls-check-name>a:hover{text-decoration:underline;text-underline-offset:3px}}
.dsh-forge-pulls-summary{display:flex;flex-direction:column;gap:12px;padding:20px 16px 16px}
.dsh-forge-pulls-title{margin:0;overflow-wrap:anywhere;line-height:1.45;font-size:16px;font-weight:600;letter-spacing:-.2px}
.dsh-forge-pulls-number{color:var(--dsw-alias-label-tertiary);font-weight:400;white-space:nowrap}
.dsh-forge-pulls-title svg{display:inline-block;width:14px;height:14px;margin-left:6px;color:var(--dsw-alias-label-tertiary);vertical-align:baseline}
.dsh-forge-pulls-meta{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px}
.dsh-forge-pulls-refs{display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;white-space:nowrap}
.dsh-forge-pulls-refs>svg{width:14px;height:14px;flex-shrink:0}
.dsh-forge-pulls-refs code{min-width:0;overflow:hidden;text-overflow:ellipsis;padding:2px 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);font-size:11px;line-height:1.5}
.dsh-forge-pulls-refs code:last-child{flex-shrink:0;max-width:35%}
.dsh-forge-pulls-ci-trigger{gap:5px;padding:2px 0 2px 6px;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-forge-pulls-ci-trigger .dsh-forge-pulls-loading{width:12px;height:12px}
.dsh-forge-pulls-ci-trigger>svg{width:12px;height:12px;transition:transform .15s}
.dsh-forge-pulls-ci-trigger[aria-expanded=true]>svg{transform:rotate(180deg)}
.dsh-forge-pulls-ci-results{font-size:12px;max-height:40vh;overflow:auto;overscroll-behavior:contain}
.dsh-forge-pulls-ci-results>p{color:var(--dsw-alias-label-secondary)}
.dsh-forge-pulls-panel footer{padding:10px 16px;border-top:.5px solid var(--dsw-alias-border-l2);line-height:1.5}
.dsh-forge-pulls-panel footer p{margin:4px 0}
.dsh-forge-pulls-tabs{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1);padding:0 16px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-forge-pulls-section{padding:20px 16px;min-width:0;overflow-wrap:anywhere;line-height:1.6}
.dsh-forge-pulls-section>h3,.dsh-forge-pulls-section form>h3{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;margin:0 0 12px;color:var(--dsw-alias-label-secondary)}
.dsh-forge-pulls-section>p,.dsh-forge-pulls-section form>p{font-size:12px;color:var(--dsw-alias-label-secondary);margin:8px 0;line-height:1.6}
.dsh-forge-pulls-section img{max-width:100%}
.dsh-forge-pulls-section table{display:block;overflow-x:auto;max-width:100%}
.dsh-forge-pulls-section pre{max-width:100%;overflow:auto}
.dsh-forge-pulls-checks,.dsh-forge-pulls-files{list-style:none;margin:0;padding:0}
.dsh-forge-pulls-heading{margin:0 0 12px}
.dsh-forge-pulls-heading>summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;padding:4px 0}
.dsh-forge-pulls-heading>summary::-webkit-details-marker{display:none}
@media(hover:hover){.dsh-forge-pulls-heading>summary:hover{color:var(--dsw-alias-label-primary)}}
.dsh-forge-pulls-heading>summary>svg{width:14px;height:14px;flex-shrink:0;color:var(--dsw-alias-label-tertiary);transform:rotate(-90deg);transition:transform .15s}
.dsh-forge-pulls-heading[open]>summary>svg{transform:rotate(0)}
.dsh-forge-pulls-heading>summary>div{min-width:0;flex:1}
.dsh-forge-pulls-heading>summary :is(h1,h2,h3,h4,h5,h6){margin:0;font-size:13px;line-height:1.6}
.dsh-forge-pulls-heading-content{margin:4px 0 0 6px;padding-left:15px;border-left:.5px solid var(--dsw-alias-border-l2)}
.dsh-forge-pulls-heading-content>.dsh-forge-pulls-heading{margin-top:12px}
.dsh-forge-pulls-panel .dsh-forge-pulls-merge-footer{flex-shrink:0;padding:12px 16px;background:var(--dsw-alias-bg-layer-1)}
.dsh-forge-pulls-merge-menu{display:block;width:100%}
.dsh-forge-pulls-merge-button{display:flex;align-items:stretch}
.dsh-forge-pulls-merge-button>button:first-child{flex:1;min-width:0;border-radius:var(--dsw-radius-md) 0 0 var(--dsw-radius-md)}
.dsh-forge-pulls-merge-button>button:last-child{flex-shrink:0;width:36px;padding:0;border-left:.5px solid var(--dsw-alias-border-l4);border-radius:0 var(--dsw-radius-md) var(--dsw-radius-md) 0}
.dsh-forge-pulls-merge-button svg{width:16px;height:16px}
.dsh-forge-pulls-checks li{display:flex;align-items:center;gap:8px;padding:8px 12px;border-top:.5px solid var(--dsw-alias-border-l2)}
.dsh-forge-pulls-check-name{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex:1;min-width:0;overflow-wrap:anywhere}
.dsh-forge-pulls-check-name>a{min-width:0}
.dsh-forge-pulls-check-name small{flex-shrink:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsh-forge-pulls-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.dsh-forge-pulls-choice{flex:1;min-width:0}
.dsh-forge-pulls-picker{width:100%;justify-content:space-between;background:var(--dsw-alias-bg-module-platform)}
.dsh-forge-pulls-picker>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-forge-pulls-picker>svg{width:14px;height:14px;flex-shrink:0}
.dsh-forge-pulls-panel label{display:flex;flex-direction:column;gap:6px;font-size:12px}
.dsh-forge-pulls-panel textarea{width:100%;box-sizing:border-box;min-height:110px;resize:vertical;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:inherit;font:inherit;padding:10px 12px;line-height:1.5}
.dsh-forge-pulls-panel textarea:focus{border-color:var(--dsw-alias-state-business-primary)}
.dsh-forge-pulls-panel textarea:disabled{color:var(--dsw-alias-label-tertiary)}
.dsh-forge-pulls-panel .dsh-forge-pulls-warning{padding:10px 16px;color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:1.6}
.dsh-forge-pulls-files{border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);overflow:hidden}
.dsh-forge-pulls-files:empty{display:none}
.dsh-forge-pulls-files li{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px}
.dsh-forge-pulls-files li:last-child{border-bottom:0}
.dsh-forge-pulls-files code{overflow-wrap:anywhere;min-width:0}
.dsh-forge-pulls-directory{color:var(--dsw-alias-label-tertiary)}
.dsh-forge-pulls-file-count{display:flex;gap:8px;white-space:nowrap;font-variant-numeric:tabular-nums}
.dsh-forge-pulls-additions{color:var(--dsw-alias-state-success-primary)}
.dsh-forge-pulls-deletions{color:var(--dsw-alias-state-error-primary)}
.dsh-forge-pulls-diff{margin-top:20px}
.dsh-forge-pulls-diff summary{cursor:pointer;padding:6px 0}
.dsh-forge-pulls-diff pre{max-height:60vh}
.dsh-forge-pulls-comment{padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);margin-bottom:12px}
.dsh-forge-pulls-comment>strong{font-size:12px;font-weight:500}
`
