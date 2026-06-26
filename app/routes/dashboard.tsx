import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { AppShell } from '../components/layout/AppShell'
import { Tag } from '../components/ui/Tag'
import { requireOperator } from '../lib/auth.server'
import type { DashboardConversation, DashboardLead } from '../lib/dashboard.server'
import { getDashboardData } from '../lib/dashboard.server'
import { AUTONOMY_TONE_CLASS, autonomyPercent, autonomyTone, cx } from '../lib/ui'
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
      content: 'Quanto a IA resolve sozinha, em um número — e o que precisa de você.',
    },
  ]
}

type Bar = { count: number }

// Sparkline de área: a trajetória de atividade (conversas/dia) correndo na base
// do número-herói. Pura/determinística — recebe a série pronta do loader.
function Sparkline({ data, className }: { data: Bar[]; className?: string }) {
  const W = 720
  const H = 44
  const max = Math.max(1, ...data.map((d) => d.count))
  const n = data.length
  const points = data.map((d, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * W
    const y = H - 2 - (d.count / max) * (H - 6)
    return [x, y] as const
  })
  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
  const linePath = line.join(' ')
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cx('block w-full', className)}
      aria-hidden="true"
    >
      <path d={areaPath} fill="var(--color-brand-vivid)" opacity="0.16" />
      <path d={linePath} fill="none" stroke="var(--color-brand)" strokeWidth="2" />
    </svg>
  )
}

// Bloco "pulso" da barra lateral (vai no slot do AppShell): faz o verde escuro
// carregar informação em vez de ser um paredão vazio.
function SidebarPulse({
  totalConversations,
  needsHuman,
  totalLeads,
  activity,
}: {
  totalConversations: number
  needsHuman: number
  totalLeads: number
  activity: Bar[]
}) {
  return (
    <div className="border-t border-white/10 pt-4">
      <p className="mb-2 text-[10px] uppercase tracking-wide text-white/45">resumo</p>
      <p className="text-xs text-white/85">{totalConversations} conversas</p>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-white/85">
        {needsHuman > 0 && <span className="size-1.5 rounded-full bg-urgent" />}
        fila {needsHuman}
      </p>
      <p className="mt-1 text-xs text-white/85">{totalLeads} leads</p>
      <Sparkline data={activity} className="mt-3 h-6 opacity-90" />
    </div>
  )
}

function SupportCard({
  value,
  label,
  trend,
}: {
  value: ReactNode
  label: string
  trend?: boolean
}) {
  return (
    <div className="rounded-xl bg-surface p-3 shadow-[0_8px_22px_-14px_rgba(26,31,28,0.6)]">
      <p className="font-display text-xl font-bold tracking-tight text-ink">
        {value}
        {trend && <span className="ml-1 text-sm text-brand">▲</span>}
      </p>
      <p className="text-xs text-ink-soft">{label}</p>
    </div>
  )
}

function LeadLine({ lead }: { lead: DashboardLead }) {
  const urgent = lead.urgency === 'alta'
  const where = [lead.neighborhood, lead.need].filter(Boolean).join(' · ')
  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        {urgent && <span className="size-1.5 shrink-0 rounded-full bg-urgent" />}
        <span className="text-sm font-medium text-ink">{lead.name ?? 'Sem nome'}</span>
        <Tag>{lead.stage}</Tag>
      </div>
      {where && <p className="mt-0.5 truncate text-xs text-ink-soft">{where}</p>}
    </div>
  )
}

// Linha do card escuro "precisa de você": nome do contato + motivo curto.
function EscalationLine({ conversation }: { conversation: DashboardConversation }) {
  return (
    <Link
      to={`/atendente?contactId=${conversation.contactId}`}
      className="flex items-center gap-2 py-1.5 text-sm text-white/90 hover:text-white"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-urgent" />
      <span className="font-medium">{conversation.contactId}</span>
      {conversation.lastMessagePreview && (
        <span className="truncate text-white/55">· {conversation.lastMessagePreview}</span>
      )}
    </Link>
  )
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { summary, conversations, leads, activity, operator } = loaderData
  const autonomy = autonomyPercent(summary.totalConversations, summary.humanInvolvedConversations)
  const toneClass = AUTONOMY_TONE_CLASS[autonomyTone(autonomy)]
  const solved = summary.totalConversations - summary.humanInvolvedConversations
  const escalations = conversations.filter((c) => c.status === 'needs_human').slice(0, 4)
  const recentLeads = leads.slice(0, 5)

  return (
    <AppShell
      operator={operator}
      sidebarSlot={
        <SidebarPulse
          totalConversations={summary.totalConversations}
          needsHuman={summary.needsHumanConversations}
          totalLeads={summary.totalLeads}
          activity={activity}
        />
      }
    >
      <div className="flex min-h-screen flex-col">
        <div className="flex items-center justify-between px-6 pt-5 text-xs text-ink-soft">
          <span className="uppercase tracking-wide">painel · {operator.tenantSlug}</span>
          <Tag>dados de simulação</Tag>
        </div>

        <section className="relative mt-3 overflow-hidden bg-bg-warm px-6 pt-7 pb-2">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.8]"
            style={{ backgroundImage: 'url(/brand/pattern.svg)' }}
          />
          <div className="relative">
            {autonomy === null ? (
              <div className="flex items-center gap-4 pb-6">
                <div>
                  <p className="font-display text-3xl font-bold tracking-tight text-ink">
                    Sua IA começa a atender agora
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Assim que os clientes escreverem, este número mostra quanto ela resolve sozinha.
                  </p>
                </div>
                <img src="/brand/empty-caught-up.svg" alt="" className="ml-auto h-20 w-auto" />
              </div>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <span
                    className={cx(
                      'font-display text-[88px] font-extrabold leading-[0.82] tracking-tighter tabular-nums sm:text-[116px]',
                      toneClass,
                    )}
                  >
                    {autonomy}%
                  </span>
                  <WingMark accent className="mt-4 size-7 text-brand" />
                </div>
                <p className="mt-2 max-w-md text-sm text-ink-soft">
                  A IA resolveu{' '}
                  <span className="text-ink">
                    {solved} de {summary.totalConversations}
                  </span>{' '}
                  conversas sozinha — você só precisou entrar {summary.humanInvolvedConversations}{' '}
                  {summary.humanInvolvedConversations === 1 ? 'vez' : 'vezes'}.
                </p>
                <Sparkline data={activity} className="mt-3 h-10" />
              </>
            )}
          </div>
        </section>

        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 px-6 pt-3 pb-6">
          <div className="grid grid-cols-3 gap-3">
            <SupportCard value={summary.totalConversations} label="clientes atendidos" />
            <SupportCard
              value={summary.totalLeads}
              label="leads capturados"
              trend={summary.totalLeads > 0}
            />
            <SupportCard value={summary.totalMessages} label="mensagens trocadas" />
          </div>

          <div className="grid flex-1 gap-4 lg:grid-cols-2">
            <section className="flex flex-col rounded-xl bg-brand-deep p-4 text-white">
              <p className="mb-3 text-xs text-white/65">precisa de você</p>
              {escalations.length === 0 ? (
                <div className="flex items-center gap-3 py-2">
                  <span className="size-2 rounded-full bg-brand-vivid" />
                  <p className="text-sm text-white/90">Tudo em dia — a IA está cuidando da fila.</p>
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {escalations.map((c) => (
                    <EscalationLine key={c.id} conversation={c} />
                  ))}
                </div>
              )}
              <div className="mt-auto border-t border-white/10 pt-3">
                <p className="text-xs text-white/55">
                  A IA resolveu {solved} de {summary.totalConversations} conversas sem te chamar.
                </p>
                {escalations.length > 0 && (
                  <Link
                    to="/atendente"
                    className="mt-1.5 inline-block text-xs font-medium text-brand-vivid hover:text-white"
                  >
                    Abrir {escalations.length === 1 ? 'a 1' : `as ${escalations.length}`} na Central
                    →
                  </Link>
                )}
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface p-4">
              <p className="mb-2 text-xs text-ink-soft">leads quentes</p>
              {recentLeads.length === 0 ? (
                <p className="py-2 text-sm text-ink-soft">Nenhum lead capturado ainda.</p>
              ) : (
                <div className="divide-y divide-border">
                  {recentLeads.map((lead) => (
                    <LeadLine key={lead.id} lead={lead} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
