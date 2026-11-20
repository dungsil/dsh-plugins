export const styles = `
.dsh-working-directory {
  min-width: 0;
}
.dsh-working-directory-details {
  margin: 4px 0 4px 22px;
  padding: 12px 16px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-markdown-code-block);
  color: var(--dsw-alias-label-secondary);
  font-size: var(--dsh-content-font-size-secondary, 13px);
}
.dsh-working-directory-details section + section {
  margin-top: 12px;
}
.dsh-working-directory-label,
.dsh-working-directory-state {
  color: var(--dsw-alias-label-caption);
}
.dsh-working-directory-state {
  font-size: var(--dsh-content-font-size-secondary, 13px);
}
.dsh-working-directory-inline-state {
  margin-inline-start: 8px;
}
.dsh-working-directory-details > .dsh-working-directory-state {
  display: block;
  margin-bottom: 8px;
}
.dsh-working-directory pre {
  margin: 4px 0 0;
  max-height: 224px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: var(--dsw-font-markdown-code-block-small);
}
.dsh-working-directory[data-state="error"] .dsh-working-directory-state {
  color: var(--dsw-alias-state-error-primary);
}
.dsh-working-directory[data-state="stopped"] .dsh-working-directory-state {
  color: var(--dsw-alias-state-warn-label);
}
.dsh-working-directory-details button {
  margin-top: 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  padding: 4px 8px;
  background: var(--dsw-alias-bg-base);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.dsh-working-directory-details button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
`
