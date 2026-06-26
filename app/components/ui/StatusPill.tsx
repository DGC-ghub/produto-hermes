import { type AttendStatus, cx, statusMeta } from '../../lib/ui'

type StatusPillProps = {
  status: AttendStatus
  className?: string
}

export function StatusPill({ status, className }: StatusPillProps) {
  const { label, dot } = statusMeta(status)
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs text-ink-soft', className)}>
      <span className={cx('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}
