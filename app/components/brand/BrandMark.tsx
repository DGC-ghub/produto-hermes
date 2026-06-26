import { cx } from '../../lib/ui'

type WingMarkProps = {
  className?: string
  accent?: boolean
}

/**
 * O símbolo da marca: a "asa do mensageiro" — três traços curvos ascendentes.
 * Monocromático via `currentColor`; com `accent`, o traço de cima usa o verde vivo.
 */
export function WingMark({ className, accent = false }: WingMarkProps) {
  return (
    <svg viewBox="0 0 52 52" fill="none" className={className} aria-hidden="true">
      <path
        className={accent ? 'text-brand-vivid' : undefined}
        d="M14 20 Q26 17 39 21"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M14 26 Q24 24 34 26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 32 Q22 31 29 32" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

type LogoProps = {
  withWordmark?: boolean
  className?: string
}

/** Logo completo: o símbolo no squircle + a palavra "Hermes". */
export function Logo({ withWordmark = true, className }: LogoProps) {
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <span className="inline-flex size-8 items-center justify-center rounded-[10px] bg-brand-deep text-white">
        <WingMark accent className="size-5" />
      </span>
      {withWordmark && (
        <span className="font-display text-lg font-bold tracking-tight">Hermes</span>
      )}
    </span>
  )
}
