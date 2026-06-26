import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { AppShell } from '../components/layout/AppShell'
import { Avatar } from '../components/ui/Avatar'
import { Card } from '../components/ui/Card'
import { Tag } from '../components/ui/Tag'
import { requireOperator } from '../lib/auth.server'
import type { DashboardConversation, DashboardLead } from '../lib/dashboard.server'
import { getDashboardData } from '../lib/dashboard.server'
import {
  AUTONOMY_TONE_CLASS,
  autonomyPercent,
  autonomyTone,
  conversationStatusMeta,
  cx,
} from '../lib/ui'
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

// Ordena conversas por urgência (precisa-humano primeiro); dentro do grupo, o
// servidor já entrega por updatedAt desc, e o sort estável preserva isso.
const STATUS_WEIGHT: Record<string, number> = { needs_human: 0, human: 1, open: 2, closed: 3 }
const RECENT_VISIBLE = 5

// Título de seção com a asa do mensageiro como bullet (signature da marca).
function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink-soft">
      <WingMark accent className="size-3.5 text-brand" />
      {children}
    </h2>
  )
}

// Faixa de atenção: o ponto focal do painel. Nunca some — quando há fila, vira um
// alerta clicável pra Central; quando está limpa, vira a recompensa "tudo em dia".
function AttentionBand({
  needsHuman,
  urgent,
}: {
  needsHuman: number
  urgent: DashboardConversation | null
}) {
  if (needsHuman > 0) {
    return (
      <Link
        to={urgent ? `/atendente?contactId=${urgent.contactId}` : '/atendente'}
        className="flex items-center gap-3 rounded-xl border border-urgent/25 bg-urgent/10 px-4 py-3 transition-colors hover:bg-urgent/15"
      >
        <span className="size-2 shrink-0 rounded-full bg-urgent" />
        <div className="min-w-0 flex-1">
          <p className="font-display font-semibold text-ink">
            {needsHuman} {needsHuman === 1 ? 'conversa precisa' : 'conversas precisam'} de você
            agora
          </p>
          {urgent && (
            <p className="mt-0.5 truncate text-sm text-ink-soft">
              {urgent.contactId}
              {urgent.lastMessagePreview ? ` · ${urgent.lastMessagePreview}` : ''}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white">
          Abrir na Central →
        </span>
      </Link>
    )
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-brand/20 bg-brand/8 px-4 py-3">
      <span className="size-2 shrink-0 rounded-full bg-brand" />
      <div className="min-w-0 flex-1">
        <p className="font-display font-semibold text-brand-deep">Tudo em dia</p>
        <p className="mt-0.5 text-sm text-ink-soft">
          A IA está cuidando das conversas — nada na sua fila.
        </p>
      </div>
      <img src="/brand/empty-caught-up.svg" alt="" className="h-12 w-auto shrink-0" />
    </div>
  )
}

// Item da régua de prova: número grande em Bricolage + rótulo.
function ProofItem({
  value,
  label,
  valueClass,
  wide,
}: {
  value: ReactNode
  label: string
  valueClass?: string
  wide?: boolean
}) {
  return (
    <div className={cx('px-3 py-3 text-center', wide ? 'flex-[1.3]' : 'flex-1')}>
      <p className={cx('font-display text-2xl font-bold tracking-tight', valueClass ?? 'text-ink')}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-ink-soft">{label}</p>
    </div>
  )
}

// Status em ponto + texto (regra: nunca bloco de cor cheio).
function StatusDot({ status }: { status: string }) {
  const { label, dot } = conversationStatusMeta(status)
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
      <span className={cx('size-1.5 rounded-full', dot)} />
      {label}
    </span>
  )
}

// Estado vazio com a ilustração da marca.
function EmptyState({ illustration, children }: { illustration: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <img src={illustration} alt="" className="h-24 w-auto" />
      <p className="text-sm text-ink-soft">{children}</p>
    </div>
  )
}

function LeadRow({ lead }: { lead: DashboardLead }) {
  const facts = [lead.need, lead.neighborhood, lead.urgency].filter(Boolean).join(' · ')
  const urgent = lead.urgency === 'alta'
  return (
    <div className="flex items-start gap-3 p-3">
      <Avatar name={lead.name ?? lead.id} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {urgent && <span className="size-1.5 rounded-full bg-urgent" />}
          <span className="font-medium text-ink">{lead.name ?? 'Sem nome'}</span>
          <Tag>{lead.stage}</Tag>
        </div>
        {facts && <p className="mt-0.5 text-xs text-ink-soft">{facts}</p>}
      </div>
    </div>
  )
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { summary, conversations, leads, operator } = loaderData
  const autonomy = autonomyPercent(summary.totalConversations, summary.humanInvolvedConversations)
  const resolvedLabel =
    summary.totalConversations === 0
      ? '—'
      : `${summary.totalConversations - summary.humanInvolvedConversations} de ${summary.totalConversations}`
  const urgentConversation = conversations.find((c) => c.status === 'needs_human') ?? null
  const recentConversations = [...conversations]
    .sort((a, b) => (STATUS_WEIGHT[a.status] ?? 2) - (STATUS_WEIGHT[b.status] ?? 2))
    .slice(0, RECENT_VISIBLE)
  const recentLeads = leads.slice(0, RECENT_VISIBLE)

  return (
    <AppShell operator={operator}>
      <div className="mx-auto max-w-5xl space-y-5 px-6 py-8">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-ink-soft">
            painel · {operator.tenantSlug}
          </span>
          <Tag>dados de simulação</Tag>
        </div>

        <AttentionBand needsHuman={summary.needsHumanConversations} urgent={urgentConversation} />

        <Card className="flex divide-x divide-border">
          <ProofItem value={summary.totalConversations} label="conversas" />
          <ProofItem value={summary.totalLeads} label="leads" />
          <ProofItem value={summary.totalMessages} label="mensagens" />
          <ProofItem
            value={resolvedLabel}
            label="resolvido sem você"
            valueClass={AUTONOMY_TONE_CLASS[autonomyTone(autonomy)]}
            wide
          />
        </Card>

        <div className="grid gap-6 pt-2 lg:grid-cols-2">
          <section>
            <SectionTitle>conversas recentes</SectionTitle>
            {recentConversations.length === 0 ? (
              <Card>
                <EmptyState illustration="/brand/empty-no-conversations.svg">
                  Nenhuma conversa ainda. Assim que um cliente escrever, ela aparece aqui.
                </EmptyState>
              </Card>
            ) : (
              <Card className="divide-y divide-border">
                {recentConversations.map((conversation) => (
                  <div key={conversation.id} className="flex items-center gap-3 p-3">
                    <Avatar name={conversation.contactId} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium text-ink">{conversation.contactId}</span>
                        <StatusDot status={conversation.status} />
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
                  </div>
                ))}
                <Link
                  to="/atendente"
                  className="block p-3 text-xs font-medium text-brand hover:text-brand-deep"
                >
                  Ver todas na Central →
                </Link>
              </Card>
            )}
          </section>

          <section>
            <SectionTitle>leads recentes</SectionTitle>
            {recentLeads.length === 0 ? (
              <Card>
                <EmptyState illustration="/brand/empty-no-results.svg">
                  Nenhum lead capturado ainda.
                </EmptyState>
              </Card>
            ) : (
              <Card className="divide-y divide-border">
                {recentLeads.map((lead) => (
                  <LeadRow key={lead.id} lead={lead} />
                ))}
              </Card>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  )
}
