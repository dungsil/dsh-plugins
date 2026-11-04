import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Menu, IconChevronDownOutlineRegular, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'

export const settingsStyles = `
.dsh-plugin-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 0; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dsh-plugin-settings-text { flex: 1; min-width: 0; }
.dsh-plugin-settings-picker { min-width: 0; }
.dsh-plugin-settings-selector { box-sizing: border-box; display: inline-flex; align-items: center; gap: 12px; max-width: 100%; height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); color: inherit; font: inherit; cursor: pointer; }
.dsh-plugin-settings-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-plugin-settings-selector svg { flex: none; }
.dsh-plugin-settings-selector:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-plugin-settings-selector:disabled { opacity: .5; cursor: default; }
.dsh-plugin-settings-selector:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset: 2px; }
`

export function SettingsRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="dsh-plugin-settings-row">
      <div className="dsh-plugin-settings-text">{label}</div>
      {children}
    </div>
  )
}

export function SettingsPicker({
  className = '',
  value,
  selectedId,
  items,
  onSelect,
  disabled = false,
  ...buttonProps
}: Pick<ComponentProps<'button'>, 'id' | 'aria-label' | 'aria-labelledby' | 'title' | 'disabled'> & {
  className?: string
  value: string
  selectedId: string
  items: MenuEntry[]
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  return (
    <Menu
      className={`dsh-plugin-settings-picker ${className}`}
      open={open && !disabled}
      onClose={() => setOpen(false)}
      items={items}
      selectedId={selectedId}
      onSelect={(id) => {
        setOpen(false)
        if (!disabled) onSelect(id)
      }}
      align="end"
      portal
      anchor={
        <button
          {...buttonProps}
          type="button"
          className="dsh-plugin-settings-selector"
          aria-haspopup="menu"
          aria-expanded={open && !disabled}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <span className="dsh-plugin-settings-value">{value}</span>
          <IconChevronDownOutlineRegular size={16} aria-hidden="true" />
        </button>
      }
    />
  )
}
