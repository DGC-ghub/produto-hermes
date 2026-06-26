import type { HTMLAttributes } from 'react'
import { cx } from '../../lib/ui'

type CardProps = HTMLAttributes<HTMLDivElement>

export function Card({ className, ...props }: CardProps) {
  return <div className={cx('rounded-xl border border-border bg-surface', className)} {...props} />
}
