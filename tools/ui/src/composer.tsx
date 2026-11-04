import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'

// Each plugin bundles these defaults. Keep overrides independent of load order.
export const composerStyles = `
:where(.dsh-plugin-composer-trigger) { display: flex; align-items: center; gap: 4px; min-width: 0; height: 28px; padding: 0 4px 0 8px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
:where(.dsh-plugin-composer-trigger):disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.dsh-plugin-composer-icon, .dsh-plugin-composer-chevron { display: inline-flex; flex: none; }
.dsh-plugin-composer-label, .dsh-plugin-composer-detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-plugin-composer-chevron, .dsh-plugin-composer-detail { color: var(--dsw-alias-label-caption); }
.dsh-plugin-composer-trigger[aria-expanded=true] .dsh-plugin-composer-chevron { transform: rotate(180deg); }
`

// The caller owns popup state, accessibility relationships and focus restoration.
export const ComposerTrigger = forwardRef<
  HTMLButtonElement,
  Omit<ComponentPropsWithoutRef<'button'>, 'children'> & { icon: ReactNode; label: ReactNode; detail?: ReactNode }
>(function ComposerTrigger({ className = '', icon, label, detail, ...props }, ref) {
  return (
    <button {...props} ref={ref} type="button" className={`dsh-plugin-composer-trigger ${className}`}>
      <span className="dsh-plugin-composer-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="dsh-plugin-composer-label">{label}</span>
      {detail && <span className="dsh-plugin-composer-detail">{detail}</span>}
      <span className="dsh-plugin-composer-chevron" aria-hidden="true">
        <IconChevronDownOutlineRegular />
      </span>
    </button>
  )
})
