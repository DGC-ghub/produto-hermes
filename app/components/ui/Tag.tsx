import type { ReactNode } from 'react'
import { cx } from '../../lib/ui'

type TagProps = {
  children: ReactNode
  icon?: ReactNode
  className?: string
}

export function Tag({ children, icon, className }: TagProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-ink-soft',
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
