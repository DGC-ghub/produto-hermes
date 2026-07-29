import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { formatLegalDate, isPlaceholder, LEGAL_UPDATED_AT } from '../../lib/legal'
import { WingMark } from '../brand/BrandMark'
import { PublicHeader } from '../layout/PublicHeader'

// Moldura compartilhada pelos Termos de Uso e pela Política de Privacidade. Os dois
// documentos têm a mesma cara e o mesmo rodapé; separar a casca evita que um saia
// diferente do outro quando um deles for editado.

type LegalDocumentProps = {
  title: string
  /** Resumo de uma linha, para quem não vai ler tudo. */
  intro: ReactNode
  children: ReactNode
}

export function LegalDocument({ title, intro, children }: LegalDocumentProps) {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <PublicHeader />

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 text-xs text-ink-soft">
          Última atualização: {formatLegalDate(LEGAL_UPDATED_AT)}
        </p>
        <p className="mt-5 text-base leading-relaxed text-ink-soft">{intro}</p>

        <div className="mt-9 flex flex-col gap-8">{children}</div>

        <nav className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-5 text-sm">
          <Link to="/termos" className="text-brand underline">
            Termos de Uso
          </Link>
          <Link to="/privacidade" className="text-brand underline">
            Política de Privacidade
          </Link>
          <Link to="/" className="text-ink-soft underline">
            Voltar para o início
          </Link>
        </nav>
      </main>

      <footer className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-6 text-xs text-ink-soft">
        <WingMark className="size-4 text-brand" />
        Hermes · um produto DGC Hub · 2026
      </footer>
    </div>
  )
}

type LegalSectionProps = {
  title: string
  children: ReactNode
}

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section>
      <h2 className="font-display text-xl font-bold text-ink">{title}</h2>
      <div className="mt-2.5 flex flex-col gap-3 text-sm leading-relaxed text-ink-soft">
        {children}
      </div>
    </section>
  )
}

/** Lista de itens dentro de uma seção. */
export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-brand">{children}</ul>
}

/**
 * Mostra um dado de identificação do fornecedor. Enquanto o campo for um marcador
 * `[PREENCHER: ...]`, sai realçado — é a trava visual para ninguém deixar o
 * documento no ar sem o CNPJ e o endereço reais.
 */
export function LegalValue({ value }: { value: string }) {
  if (!isPlaceholder(value)) {
    return <span className="font-medium text-ink">{value}</span>
  }
  return (
    <mark
      className="rounded bg-waiting/25 px-1 font-medium text-ink"
      title="Campo pendente — preencha em app/lib/legal.ts"
    >
      {value}
    </mark>
  )
}
