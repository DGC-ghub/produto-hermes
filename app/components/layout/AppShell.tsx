import type { ReactNode } from 'react'
import { Form, NavLink } from 'react-router'
import { cx, initials } from '../../lib/ui'
import { WingMark } from '../brand/BrandMark'

type Operator = {
  tenantSlug: string
  username: string
}

const NAV = [
  { to: '/atendente', label: 'Central' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/configuracoes', label: 'Configurações' },
]

type AppShellProps = {
  operator: Operator
  children: ReactNode
}

/**
 * Casca do app interno: barra lateral fixa (marca, navegação, empresa) + área de
 * conteúdo. As telas internas envolvem o próprio conteúdo com este componente
 * conforme vão sendo repaginadas.
 */
export function AppShell({ operator, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-bg text-ink">
      <aside className="flex w-56 shrink-0 flex-col bg-brand-deep px-3 py-4 text-white">
        <div className="flex items-center gap-2 px-2">
          <WingMark accent className="size-7 text-white" />
          <span className="font-display text-lg font-bold tracking-tight text-white">Hermes</span>
        </div>

        <nav className="mt-6 flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
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

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
