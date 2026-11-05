import { useEffect, useState, type ComponentProps } from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { IconChevronDownOutlineRegular } from './icons.js'

export function ButtonPicker<Value extends string>({
  label,
  value,
  items,
  onChange,
  disabled = false,
  menuClassName,
  compact,
  ...buttonProps
}: Omit<
  ComponentProps<typeof Button>,
  'children' | 'onClick' | 'aria-label' | 'aria-haspopup' | 'aria-expanded' | 'value' | 'onChange'
> & {
  label: string
  value: Value
  items: readonly { id: Value; label: string; disabled?: boolean }[]
  onChange: (value: Value) => void
  menuClassName?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])
  return (
    <Menu
      open={open && !disabled}
      portal
      compact={compact}
      className={menuClassName}
      selectedId={value}
      items={items}
      onClose={() => setOpen(false)}
      onSelect={(id) => {
        setOpen(false)
        const item = items.find((item) => item.id === id && !item.disabled)
        if (!disabled && item) onChange(item.id)
      }}
      anchor={
        <Button
          {...buttonProps}
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open && !disabled}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <span>{items.find((item) => item.id === value)?.label}</span>
          <IconChevronDownOutlineRegular aria-hidden="true" />
        </Button>
      }
    />
  )
}
