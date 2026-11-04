import { db } from '../db.server'
import { createPreapproval, getPreapproval, mapMpStatus } from './mercadopago.server'
import { PLANS, type PlanId } from './subscription.server'

// Orquestra a cobrança (marco M3): liga o cliente do Mercado Pago à Subscription do tenant.
// A IA nunca toca isto; é fluxo de pagamento puro. Server-side.

/**
 * Inicia a assinatura paga: cria o preapproval no MP e guarda o providerSubId na Subscription.
 * Retorna a URL de checkout (initPoint) pra redirecionar o dono, ou null se o MP não está
 * configurado (modo stub) ou falhou.
 */
export async function startSubscription(input: {
  tenantId: string
  planId: PlanId
  payerEmail: string
  backUrl: string
}): Promise<string | null> {
  const plan = PLANS[input.planId]
  const preapproval = await createPreapproval({
    reason: `Hermes — plano ${plan.nome}`,
    amount: plan.precoCentavos / 100,
    payerEmail: input.payerEmail,
    backUrl: input.backUrl,
    externalReference: input.tenantId,
  })
  if (!preapproval) {
    return null
  }

  const data = {
    provider: 'mercadopago',
    providerSubId: preapproval.id,
    planId: input.planId,
    status: mapMpStatus(preapproval.status),
  }
  await db.subscription.upsert({
    where: { tenantId: input.tenantId },
    create: { tenantId: input.tenantId, ...data },
    update: data,
  })
  return preapproval.initPoint
}

/**
 * Sincroniza a Subscription a partir de uma notificação do MP (webhook). Busca o estado REAL no
 * MP (o webhook só manda o id) e atualiza o status — idempotente. Retorna true se sincronizou.
 */
export async function syncSubscriptionFromMp(preapprovalId: string): Promise<boolean> {
  const preapproval = await getPreapproval(preapprovalId)
  if (!preapproval) {
    return false
  }
  const sub = await db.subscription.findUnique({ where: { providerSubId: preapprovalId } })
  if (!sub) {
    return false // preapproval que não conhecemos — ignora
  }
  const nextPayment = preapproval.nextPaymentDate ? new Date(preapproval.nextPaymentDate) : null
  const validPeriodEnd = nextPayment && Number.isFinite(nextPayment.getTime()) ? nextPayment : null
  await db.subscription.update({
    where: { id: sub.id },
    data: {
      status: mapMpStatus(preapproval.status),
      // O MP define next_payment_date como a próxima cobrança recorrente. Se o campo
      // vier ausente/inválido, preservamos o período já conhecido em vez de inventar
      // uma data ou apagar uma assinatura válida.
      ...(validPeriodEnd ? { currentPeriodEnd: validPeriodEnd } : {}),
    },
  })
  return true
}
