import type { ReactNode } from 'react'
import { cx } from '../lib/ui'

// Estado vazio on-brand: uma das ilustrações de public/brand/empty-*.svg + uma frase curta.
// Substitui os "Cards de texto" crus por algo que passa cuidado de produto.
export function EmptyState({
  image,
  className,
  children,
}: {
  image: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
      <img src={image} alt="" className="h-24 w-auto" />
      <p className="max-w-xs text-sm text-ink-soft">{children}</p>
    </div>
  )
}
