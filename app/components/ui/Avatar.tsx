import { avatarColor, cx, initials } from '../../lib/ui'

type AvatarSize = 'sm' | 'md' | 'lg'

const SIZES: Record<AvatarSize, string> = {
  sm: 'size-7 text-[11px]',
  md: 'size-9 text-xs',
  lg: 'size-11 text-sm',
}

type AvatarProps = {
  name: string
  size?: AvatarSize
  className?: string
}

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white',
        SIZES[size],
        avatarColor(name),
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}
