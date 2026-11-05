import type { ReactNode } from 'react'

export function PluginPage({
  children,
  className = '',
  contentClassName = '',
}: {
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <div className={`dsh-plugin-page ${className}`}>
      <div className={`dsh-plugin-page-content ${contentClassName}`}>{children}</div>
    </div>
  )
}
