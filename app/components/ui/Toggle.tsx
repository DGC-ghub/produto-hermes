import { cx } from '../../lib/ui'

type ToggleProps = {
  checked: boolean
  onChange?: (next: boolean) => void
  label?: string
  className?: string
}

export function Toggle({ checked, onChange, label, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ?? 'Alternar'}
      onClick={() => onChange?.(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-border',
        className,
      )}
    >
      <span
        className={cx(
          'inline-block size-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
