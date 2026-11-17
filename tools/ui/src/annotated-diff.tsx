import { DiffBlock, type DiffBlockProps } from '@deepseek-ai/dsh-client-ui-primitives'

export const annotatedDiffStyles = `
.dsh-annotated-diff { min-width: 0; margin: 0; border: 1px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-markdown-code-block); }
.dsh-annotated-diff-code { margin: 0; border-radius: var(--dsw-radius-md) var(--dsw-radius-md) 0 0; }
.dsh-annotated-diff-note { position: relative; min-width: 0; padding: 12px 20px 16px; border-top: 1px solid var(--dsw-alias-border-l4); border-radius: 0 0 var(--dsw-radius-md) var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); }
.dsh-annotated-diff-label { display: block; margin-bottom: 6px; color: var(--dsw-alias-label-secondary); font-size: var(--dsw-font-xxs-12-font-size); font-weight: 500; line-height: 18px; }
.dsh-annotated-diff-text { margin: 0; color: var(--dsw-alias-label-primary); font-size: var(--dsw-font-s-14-font-size); line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; }
`

export function AnnotatedDiffBlock({
  annotation,
  annotationLabel,
  className = '',
  ...props
}: DiffBlockProps & { annotation: string; annotationLabel: string }) {
  return (
    <figure className="dsh-annotated-diff">
      <DiffBlock {...props} className={`dsh-annotated-diff-code ${className}`} />
      <figcaption className="dsh-annotated-diff-note">
        <span className="dsh-annotated-diff-label">{annotationLabel}</span>
        <p className="dsh-annotated-diff-text">{annotation}</p>
      </figcaption>
    </figure>
  )
}
