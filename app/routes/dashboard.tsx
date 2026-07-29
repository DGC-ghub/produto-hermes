import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { WingMark } from '../components/brand/BrandMark'
import { AppShell } from '../components/layout/AppShell'
import { Button } from '../components/ui/Button'
import { Tag } from '../components/ui/Tag'
import { db } from '../db.server'
import { resolveTenantConfig } from '../lib/attendant/tenant-config-db.server'
import { requireOperator } from '../lib/auth.server'
import type { DashboardConversation, DashboardLead } from '../lib/dashboard.server'
import { getDashboardData } from '../lib/dashboard.server'
import type { SubscriptionNotice } from '../lib/subscription.server'
import { getSubscriptionStatus, subscriptionNotice } from '../lib/subscription.server'
import { AUTONOMY_TONE_CLASS, autonomyPercent, autonomyTone, cx } from '../lib/ui'
import type { Route } from './+types/dashboard'

export async function loader({ request }: Route.LoaderArgs) {
  const operator = await requireOperator(request)
  const [data, config, realChannelConversations, subscription] = await Promise.all([
    getDashboardData(operator.tenantId),
    resolveTenantConfig(operator.tenantSlug),
    // Conversa de canal real (hoje só o WhatsApp; `simulator` é o balcão de teste).
    // Se existir ao menos uma, os números do painel são de verdade — nada de rótulo
    // de simulação em cima do atendimento do cliente.
    db.conversation.count({
      where: { tenantId: operator.tenantId, channel: { not: 'simulator' } },
    }),
    getSubscriptionStatus(operator.tenantId),
  ])
  return {
    ...data,
    // O cliente se reconhece pelo nome da empresa, não pelo slug técnico.
    businessName: config?.businessProfile.name.trim() || operator.tenantSlug,
    isSimulation: realChannelConversations === 0,
    // Só o dono chega em /assinar (requireOwner manda operador comum de volta pra
    // fila): pra ele o aviso informa, mas sem oferecer um botão que não abre.
    subscription: {
      notice: subscriptionNotice(subscription),
      planName: subscription.planName,
      canManage: operator.role === 'owner',
    },
    operator: { username: operator.username, tenantSlug: operator.tenantSlug },
  }
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

// Faixa de assinatura. Só aparece quando há algo a resolver — quem paga em dia não
// leva banner na cara. O tom esquenta conforme o prazo aperta: o teste com folga
// informa, os últimos dias chamam atenção, o vencido pede ação.
type BannerKind = Exclude<SubscriptionNotice['kind'], 'none' | 'active'>

const BANNER_TONE: Record<BannerKind, { wrap: string; dot: string }> = {
  trial: { wrap: 'border-border bg-surface', dot: 'bg-brand' },
  trial_ending: { wrap: 'border-waiting/40 bg-waiting/10', dot: 'bg-waiting' },
  trial_over: { wrap: 'border-urgent/40 bg-urgent/10', dot: 'bg-urgent' },
  payment_problem: { wrap: 'border-urgent/40 bg-urgent/10', dot: 'bg-urgent' },
  // Cancelamento é escolha do cliente, não emergência: tom neutro, sem vermelho.
  canceled: { wrap: 'border-border bg-surface', dot: 'bg-ink-soft' },
}

const BANNER_COPY: Record<BannerKind, { detail: string; cta: string }> = {
  trial: {
    detail: 'Assine antes do fim para o atendimento não parar.',
    cta: 'Ver planos',
  },
  trial_ending: {
    detail: 'Falta pouco — assine para o atendente continuar respondendo.',
    cta: 'Assinar',
  },
  trial_over: {
    // Não diz "voltou a funcionar/parou": hoje o gate de cobrança está desligado e o
    // atendimento continua no ar — a faixa cobra a assinatura sem mentir sobre o estado.
    detail: 'Assine para continuar com o atendente respondendo seus clientes.',
    cta: 'Assinar',
  },
  payment_problem: {
    detail: 'Confira o pagamento para não ficar sem atendimento.',
    cta: 'Rever assinatura',
  },
  canceled: {
    detail: 'Você pode voltar quando quiser — seus dados e sua base continuam aqui.',
    cta: 'Assinar de novo',
  },
}

// A contagem já vem pronta do servidor (`daysRemaining`, pura e testada); aqui só
// se escolhem as palavras.
function bannerTitle({ kind, daysLeft }: { kind: BannerKind; daysLeft: number | null }): string {
  if (kind === 'trial_over') {
    return 'Seu teste grátis terminou'
  }
  if (kind === 'payment_problem') {
    return 'Não conseguimos confirmar seu pagamento'
  }
  if (kind === 'canceled') {
    return 'Sua assinatura foi cancelada'
  }
  if (daysLeft === null) {
    return 'Teste grátis'
  }
  if (daysLeft === 0) {
    return 'Teste grátis — termina hoje'
  }
  return `Teste grátis — ${daysLeft} ${daysLeft === 1 ? 'dia restante' : 'dias restantes'}`
}

function SubscriptionBanner({
  notice,
  canManage,
}: {
  notice: SubscriptionNotice
  canManage: boolean
}) {
  if (notice.kind === 'none' || notice.kind === 'active') {
    return null
  }
  const tone = BANNER_TONE[notice.kind]
  const copy = BANNER_COPY[notice.kind]
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-6 py-2.5',
        tone.wrap,
      )}
    >
      <span className={cx('size-1.5 shrink-0 rounded-full', tone.dot)} />
      <p className="text-sm font-medium text-ink">
        {bannerTitle({ kind: notice.kind, daysLeft: notice.daysLeft })}
      </p>
      <p className="text-sm text-ink-soft">{copy.detail}</p>
      {canManage ? (
        <Link to="/assinar" className="ml-auto">
          <Button variant="primary" size="sm">
            {copy.cta}
          </Button>
        </Link>
      ) : (
        <p className="ml-auto text-xs text-ink-soft">Avise quem cuida da assinatura.</p>
      )}
    </div>
  )
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const {
    summary,
    conversations,
    leads,
    activity,
    operator,
    businessName,
    isSimulation,
    subscription,
  } = loaderData
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
        <SubscriptionBanner notice={subscription.notice} canManage={subscription.canManage} />

        <div className="flex items-center justify-between px-6 pt-5 text-xs text-ink-soft">
          <span className="uppercase tracking-wide">painel · {businessName}</span>
          <div className="flex items-center gap-2">
            {/* Assinatura em dia não vira faixa: fica só esta linha discreta, que também
                serve de atalho pra trocar de plano. */}
            {subscription.notice.kind === 'active' && subscription.canManage && (
              <Link to="/assinar" className="hover:text-ink">
                assinatura ativa
                {subscription.planName && ` · ${subscription.planName}`}
              </Link>
            )}
            {isSimulation && <Tag>dados de simulação</Tag>}
          </div>
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
