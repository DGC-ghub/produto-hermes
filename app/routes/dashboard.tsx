import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/layout/AppShell'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { Tag } from '../components/ui/Tag'
import { requireOperator } from '../lib/auth.server'
import { getDashboardData } from '../lib/dashboard.server'
import { autonomyPercent, conversationStatusMeta, cx } from '../lib/ui'
import type { Route } from './+types/dashboard'

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOperator(request)
  const data = await getDashboardData(operator.tenantId)
  return { ...data, operator: { username: operator.username, tenantSlug: operator.tenantSlug } }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Hermes — Painel' },
    {
      name: 'description',
      content: 'Visão geral do atendimento: autonomia da IA, conversas e leads.',
    },
  ]
}

// Cartão de indicador (KPI): número grande em Bricolage + rótulo. `accent` dá a
// cor do número; `hint` é a legenda honesta sobre a base do cálculo.
function Kpi({
  label,
  value,
  accent,
  hint,
}: {
  label: string
  value: ReactNode
  accent?: string
  hint?: string
}) {
  return (
    <Card className="p-4">
      <p className={cx('font-display text-3xl font-bold tracking-tight', accent ?? 'text-ink')}>
        {value}
      </p>
      <p className="mt-1 text-sm text-ink-soft">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-soft/70">{hint}</p>}
    </Card>
  )
}

// Estado vazio com a ilustração da marca (linha emerald, sem texto).
function EmptyState({ illustration, children }: { illustration: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <img src={illustration} alt="" className="h-28 w-auto" />
      <p className="text-sm text-ink-soft">{children}</p>
    </div>
  )
}

// Ponto + texto do status (regra: nunca bloco de cor cheio).
function StatusDot({ status }: { status: string }) {
  const { label, dot } = conversationStatusMeta(status)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
      <span className={cx('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { summary, conversations, leads, operator } = loaderData
  const autonomy = autonomyPercent(summary.totalConversations, summary.humanInvolvedConversations)

  return (
    <AppShell operator={operator}>
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Painel</h1>
            <p className="text-sm text-ink-soft">
              Visão geral do atendimento de {operator.tenantSlug}.
            </p>
          </div>
          <Tag>dados de simulação</Tag>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Conversas" value={summary.totalConversations} />
          <Kpi
            label="Resolvido sem humano"
            value={autonomy === null ? '—' : `${autonomy}%`}
            accent="text-brand"
            hint="do total de conversas"
          />
          <Kpi label="Leads" value={summary.totalLeads} />
          <Kpi
            label="Precisam de humano"
            value={summary.needsHumanConversations}
            accent={summary.needsHumanConversations > 0 ? 'text-urgent' : 'text-ink'}
            hint="na fila agora"
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-ink-soft">Conversas recentes</h2>
          {conversations.length === 0 ? (
            <Card>
              <EmptyState illustration="/brand/empty-no-conversations.svg">
                Nenhuma conversa ainda. Assim que um cliente escrever, ela aparece aqui.
              </EmptyState>
            </Card>
          ) : (
            <ul className="space-y-2">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Card className="flex items-center gap-3 p-3">
                    <Avatar name={conversation.contactId} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium text-ink">{conversation.contactId}</span>
                        <StatusDot status={conversation.status} />
                        <span className="text-xs text-ink-soft/70">
                          {conversation.messageCount} msg
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-ink-soft">
                        {conversation.lastMessagePreview ?? '—'}
                      </p>
                    </div>
                    <Link
                      to={`/demo/chat?tenant=${conversation.tenantSlug}&conversationId=${conversation.id}`}
                      className="shrink-0 text-xs font-medium text-brand hover:text-brand-deep"
                    >
                      Abrir
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-ink-soft">Leads recentes</h2>
          {leads.length === 0 ? (
            <Card>
              <EmptyState illustration="/brand/empty-no-results.svg">
                Nenhum lead capturado ainda.
              </EmptyState>
            </Card>
          ) : (
            <ul className="space-y-2">
              {leads.map((lead) => (
                <li key={lead.id}>
                  <Card className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Avatar name={lead.name ?? lead.id} size="sm" />
                      <span className="font-medium text-ink">{lead.name ?? 'Sem nome'}</span>
                      <Tag>{lead.stage}</Tag>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-4">
                      <div>
                        Telefone: <span className="text-ink">{lead.phone ?? '—'}</span>
                      </div>
                      <div>
                        Bairro: <span className="text-ink">{lead.neighborhood ?? '—'}</span>
                      </div>
                      <div>
                        Necessidade: <span className="text-ink">{lead.need ?? '—'}</span>
                      </div>
                      <div>
                        Urgência: <span className="text-ink">{lead.urgency ?? '—'}</span>
                      </div>
                    </dl>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  )
}
