import { type ReactNode, useState } from 'react'
import { Form, NavLink } from 'react-router'
import { cx, initials } from '../../lib/ui'
import { WingMark } from '../brand/BrandMark'

type Operator = {
  tenantSlug: string
  username: string
}

// O caminho self-service é o QR (/canais). O fluxo oficial (API da Meta) não entra no menu
// para não dividir a decisão do cliente — o link para ele fica dentro da própria tela /canais.
export const NAV = [
  { to: '/atendente', label: 'Central' },
  { to: '/dashboard', label: 'Dashboard' },
  // Primeiro passo de um cliente novo: responder o questionário. Vem antes de
  // Configurações e Conhecimento de propósito — a ordem conta a história (responder →
  // testar → conectar), e é o oposto de largar a pessoa num campo em branco.
  { to: '/preparar-ia', label: 'Preparar minha IA' },
  { to: '/configuracoes', label: 'Configurações' },
  { to: '/conhecimento', label: 'Conhecimento' },
  // Logo depois de Conhecimento: a ordem conta a história — ensine a IA, teste, então ligue
  // no WhatsApp. Testar antes de conectar é o que evita o cliente descobrir os buracos da
  // base no número real da empresa.
  { to: '/testar-ia', label: 'Testar minha IA' },
  { to: '/canais', label: 'Conectar WhatsApp' },
  { to: '/assinar', label: 'Assinatura' },
]

type AppShellProps = {
  operator: Operator
  children: ReactNode
  // Bloco opcional na barra lateral (entre a navegação e o rodapé) — cada tela
  // injeta o seu (ex.: o "pulso" do painel). A casca não conhece os dados.
  sidebarSlot?: ReactNode
}

/**
 * Casca do app interno: barra lateral com a marca, navegação e empresa. No desktop ela é
 * fixa; no mobile vira um drawer (hamburger + overlay) — o produto é sobre WhatsApp, então
 * a maioria do uso é no celular.
 */
export function AppShell({ operator, children, sidebarSlot }: AppShellProps) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <div className="flex min-h-screen bg-bg text-ink">
      {/* Topbar só no mobile: hamburger + marca */}
      <header className="fixed inset-x-0 top-0 z-30 flex items-center gap-2 bg-brand-deep px-4 py-3 text-white md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="-ml-1 rounded-lg p-1 transition-colors hover:bg-white/10"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
          </svg>
        </button>
        <WingMark accent className="size-6 text-white" />
        <span className="font-display text-lg font-bold tracking-tight">Hermes</span>
      </header>

      {/* Overlay: toque fora fecha o drawer (só mobile) */}
      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={close}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      )}

      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-52 shrink-0 flex-col px-3 py-4 text-white transition-transform duration-200 md:static md:z-auto md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ backgroundImage: 'linear-gradient(to bottom, #0a3c2e, #072a20)' }}
      >
        <div className="flex items-center gap-2 px-2">
          <WingMark accent className="size-7 text-white" />
          <span className="font-display text-lg font-bold tracking-tight text-white">Hermes</span>
        </div>

        <nav className="mt-6 flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={close}
              className={({ isActive }) =>
                cx(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand text-white'
                    : 'text-white/70 hover:bg-white/10 hover:text-white',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {sidebarSlot && <div className="mt-6">{sidebarSlot}</div>}

        <div className="mt-auto flex items-center gap-2 border-t border-white/10 pt-3">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-vivid text-[11px] font-medium text-brand-deep">
            {initials(operator.tenantSlug)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-white">{operator.tenantSlug}</p>
            <p className="truncate text-[11px] text-white/50">{operator.username}</p>
          </div>
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="text-xs text-white/60 transition-colors hover:text-white"
            >
              Sair
            </button>
          </Form>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pt-14 md:pt-0">{children}</main>
    </div>
  )
}
