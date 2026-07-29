import { db } from '../db.server'
import { PLANS, type PlanId, TRIAL_DAYS } from './plans'

// Assinatura (marco M3), agnóstica de gateway. O catálogo de planos vive em código; a integração
// do gateway escolhido (Stripe/Mercado Pago/Asaas) sincroniza status/período via webhook depois.
// isSubscriptionActive é o que um gate de atendimento (M4) vai consultar. Server-side.

// O catálogo em si mora em ./plans (puro, sem banco) para a landing pública poder
// mostrar o preço. Re-exportado aqui para não quebrar quem já importava daqui.
export { PLANS, type PlanId, TRIAL_DAYS }

const ACTIVE_STATUSES = new Set(['trialing', 'active'])

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Quantos dias faltam até `end`. Qualquer fração conta como um dia inteiro —
 * faltando meia hora o cliente ainda tem "1 dia", nunca "0": arredondar pra baixo
 * faria a tela anunciar o fim enquanto ainda dá tempo de assinar. Compara instantes
 * absolutos, então o fuso de quem lê não muda a conta. Nunca negativa. Pura.
 */
export function daysRemaining(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS))
}

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
  const daysLeft = sub.currentPeriodEnd ? daysRemaining(sub.currentPeriodEnd, now) : null
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

/** A partir de quantos dias restantes o fim do teste vira aviso urgente na tela. */
export const TRIAL_URGENT_DAYS = 3

export type SubscriptionNoticeKind =
  | 'none' // sem assinatura registrada (pilotos legados) — nada a avisar
  | 'trial' // teste correndo com folga
  | 'trial_ending' // teste correndo, mas acabando
  | 'trial_over' // o teste terminou sem virar assinatura
  | 'payment_problem' // já era pagante, mas a cobrança não está em dia
  | 'canceled' // cancelou por vontade própria — não é falha de cobrança
  | 'active' // assinatura paga e em dia

export type SubscriptionNotice = {
  kind: SubscriptionNoticeKind
  /** Dias até o fim do período; `null` quando não há data de fim registrada. */
  daysLeft: number | null
}

/**
 * Traduz o estado da assinatura no aviso que o painel mostra. Existe porque o
 * cliente só descobria que o teste tinha acabado quando o atendimento parava —
 * a faixa precisa aparecer desde o primeiro dia e esquentar perto do fim.
 * Tenant sem assinatura nenhuma não recebe aviso: são os pilotos que o gate de
 * cobrança (`billing-gate.server.ts`) também deixa passar. Pura.
 */
export function subscriptionNotice(view: SubscriptionView): SubscriptionNotice {
  if (view.status === 'none') {
    return { kind: 'none', daysLeft: null }
  }
  if (!view.active) {
    // Teste vencido, cancelamento e cobrança recusada pedem textos diferentes: quem já
    // pagou não pode ler "seu teste acabou", e quem cancelou de propósito não pode ler
    // "não conseguimos confirmar seu pagamento".
    if (view.status === 'trialing') {
      return { kind: 'trial_over', daysLeft: 0 }
    }
    if (view.status === 'canceled') {
      return { kind: 'canceled', daysLeft: 0 }
    }
    // 'active' com período vencido NÃO é problema de cobrança: o webhook do Mercado Pago
    // só grava `status`, nunca renova `currentPeriodEnd` — então a data que sobrou é a do
    // trial e não diz nada sobre a assinatura paga. Acusar aqui seria caluniar quem está
    // em dia. Enquanto o webhook não gravar o próximo vencimento, tratamos como ativa.
    if (view.status === 'active') {
      return { kind: 'active', daysLeft: null }
    }
    return { kind: 'payment_problem', daysLeft: 0 }
  }
  if (view.status !== 'trialing') {
    return { kind: 'active', daysLeft: view.daysLeft }
  }
  // Trial sem data de fim não deveria existir (startTrial sempre grava uma), mas se
  // existir avisamos sem contagem em vez de inventar "0 dias".
  if (view.daysLeft === null) {
    return { kind: 'trial', daysLeft: null }
  }
  return {
    kind: view.daysLeft <= TRIAL_URGENT_DAYS ? 'trial_ending' : 'trial',
    daysLeft: view.daysLeft,
  }
}
