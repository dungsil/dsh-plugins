import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDownOutlineRegular } from './icons.js'
import { installStyles } from './client.js'

/** The rc.5 settings shell has no icon slot, so decorate only the matching navigation rows. */
export function installSettingsIcon(id: string, labels: readonly string[], artwork: string) {
  const attribute = 'data-dsh-settings-icon'
  const selector = `[${attribute}="${id}"]`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="black" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${artwork}</svg>`
  const removeStyles = installStyles(`
${selector} > svg { display: none; }
${selector}::before { content: ''; display: block; flex: none; width: 16px; height: 16px; background: currentColor; mask: url("data:image/svg+xml,${encodeURIComponent(svg)}") center / contain no-repeat; }
`)
  const marked = new Set<HTMLElement>()
  const refresh = () => {
    const rows = new Set(document.querySelectorAll<HTMLElement>('[data-shortcut-modal="settings"] nav button'))
    for (const row of marked) {
      if (!rows.has(row) || !labels.includes(row.textContent?.trim() ?? '')) {
        row.removeAttribute(attribute)
        marked.delete(row)
      }
    }
    for (const row of rows) {
      if (labels.includes(row.textContent?.trim() ?? '')) {
        row.setAttribute(attribute, id)
        marked.add(row)
      }
    }
  }
  const observer = new MutationObserver(refresh)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  refresh()
  return () => {
    observer.disconnect()
    for (const row of marked) row.removeAttribute(attribute)
    removeStyles()
  }
}

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
