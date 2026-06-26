import type { InputHTMLAttributes } from 'react'
import { cx } from '../../lib/ui'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label?: string
}

export function TextField({ label, className, ...props }: TextFieldProps) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs text-ink-soft">{label}</span>}
      <input
        className={cx(
          'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
          className,
        )}
        {...props}
      />
    </label>
  )
}
