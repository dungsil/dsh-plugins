export const STYLES = `
[data-answer-translation="action"] {
  display: inline-flex;
  vertical-align: -3px;
  margin-inline-start: 4px;
  user-select: none;
}

.dsh-answer-translation-trigger {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--ds-transition-duration, 0.15s) var(--ds-ease-in-out, ease);
}

.dsh-answer-translation-trigger svg {
  width: 14px;
  height: 14px;
}

/* Hidden until the paragraph is pointed at, the action is focused, or a translation is open. */
:is(p, li):hover > [data-answer-translation="action"] > .dsh-answer-translation-trigger,
.dsh-answer-translation-trigger:focus-visible,
.dsh-answer-translation-trigger[data-active],
.dsh-answer-translation-trigger[aria-busy] {
  opacity: 1;
}

/* Touch screens cannot hover, so the action stays visible there. */
@media (hover: none) {
  .dsh-answer-translation-trigger {
    opacity: 1;
  }
}

@media (hover: hover) {
  .dsh-answer-translation-trigger:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}

.dsh-answer-translation-trigger:active {
  background: var(--dsw-alias-interactive-bg-active);
}

.dsh-answer-translation-trigger:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
}

@keyframes dsh-answer-translation-spin {
  to {
    transform: rotate(360deg);
  }
}

.dsh-answer-translation-spin {
  animation: dsh-answer-translation-spin 1s linear infinite;
}

/* Sits under the paragraph it translates; the negative margin halves the paragraph gap. */
[data-answer-translation="panel"] {
  margin: -8px 0 16px;
  min-width: 0;
}

li > [data-answer-translation="panel"] {
  margin: 4px 0 0;
}

.dsh-answer-translation-panel {
  padding: 2px 0 2px 12px;
  border-inline-start: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.dsh-answer-translation-panel p {
  margin: 0 !important;
}

.dsh-answer-translation-source {
  margin-top: 2px !important;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-secondary));
}

.dsh-answer-translation-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.dsh-answer-translation-atom {
  display: contents;
}
`
