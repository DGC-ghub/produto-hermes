import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../../lib/ui'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-deep',
  secondary: 'border border-border bg-surface text-ink hover:bg-bg',
  ghost: 'text-ink-soft hover:bg-bg hover:text-ink',
}

type ButtonSize = 'sm' | 'md'

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  )
}
