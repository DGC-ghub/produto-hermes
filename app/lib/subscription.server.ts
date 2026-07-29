import { db } from '../db.server'
import { PLANS, type PlanId, TRIAL_DAYS } from './plans'

// Assinatura (marco M3), agnóstica de gateway. O catálogo de planos vive em código; a integração
// do gateway escolhido (Stripe/Mercado Pago/Asaas) sincroniza status/período via webhook depois.
// isSubscriptionActive é o que um gate de atendimento (M4) vai consultar. Server-side.

// O catálogo em si mora em ./plans (puro, sem banco) para a landing pública poder
// mostrar o preço. Re-exportado aqui para não quebrar quem já importava daqui.
export { PLANS, type PlanId, TRIAL_DAYS }

const ACTIVE_STATUSES = new Set(['trialing', 'active'])

/** A assinatura do tenant permite usar o serviço? (status ativo E período não expirado). */
export async function isSubscriptionActive(
  tenantId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const sub = await db.subscription.findUnique({ where: { tenantId } })
  if (!sub || !ACTIVE_STATUSES.has(sub.status)) {
    return false
  }
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < now.getTime()) {
    return false // período (trial ou pago) expirou
  }
  return true
}

/** Inicia (ou reinicia) um período de TRIAL para o tenant. Idempotente (upsert por tenant). */
export async function startTrial(
  tenantId: string,
  planId: PlanId,
  days = TRIAL_DAYS,
  now: Date = new Date(),
): Promise<void> {
  const currentPeriodEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  await db.subscription.upsert({
    where: { tenantId },
    create: { tenantId, provider: 'none', status: 'trialing', planId, currentPeriodEnd },
    update: { status: 'trialing', planId, currentPeriodEnd },
  })
}

export type SubscriptionView = {
  status: string // trialing | active | past_due | canceled | none
  planId: PlanId | null
  planName: string | null
  currentPeriodEnd: string | null // ISO
  daysLeft: number | null
  active: boolean
}

/** Estado da assinatura pra a tela de billing: plano, status, quando vence e dias restantes. */
export async function getSubscriptionStatus(
  tenantId: string,
  now: Date = new Date(),
): Promise<SubscriptionView> {
  const sub = await db.subscription.findUnique({ where: { tenantId } })
  if (!sub) {
    return {
      status: 'none',
      planId: null,
      planName: null,
      currentPeriodEnd: null,
      daysLeft: null,
      active: false,
    }
  }
  const planId = (sub.planId && sub.planId in PLANS ? sub.planId : null) as PlanId | null
  const daysLeft = sub.currentPeriodEnd
    ? Math.max(0, Math.ceil((sub.currentPeriodEnd.getTime() - now.getTime()) / 86_400_000))
    : null
  const active =
    ACTIVE_STATUSES.has(sub.status) &&
    (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() >= now.getTime())
  return {
    status: sub.status,
    planId,
    planName: planId ? PLANS[planId].nome : null,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    daysLeft,
    active,
  }
}
