import { db } from '../db.server'
import { isSubscriptionActive } from './subscription.server'

// Gate de cobrança (Tier 2): decide se o atendimento do tenant é permitido pelo estado da
// assinatura. Duas salvaguardas contra parar atendimento por engano:
//  1. GRANDFATHERING — tenant SEM assinatura (pilotos/legado, criados por CLI) passa livre.
//  2. FLAG — o bloqueio só age com BILLING_GATE_ENABLED=1; desligado (default), NUNCA bloqueia
//     (só reporta o que faria, via `reason`). Assim o gate fica pronto e testado sem afetar
//     produção até o dono revisar o grandfathering e ligar de propósito.

export type GateReason = 'no_subscription' | 'active' | 'gate_disabled' | 'inactive'
export type GateDecision = { allowed: boolean; reason: GateReason }

/** O flag está ligado? (bloqueio só age quando true). */
export function isBillingGateEnabled(): boolean {
  return process.env.BILLING_GATE_ENABLED === '1'
}

/**
 * Decide se o atendimento do tenant passa. Bloqueia SÓ quando: existe assinatura, ela não
 * está ativa E o flag está ligado. Nos demais casos, permite (com o motivo pra log). Server-side.
 */
export async function checkBillingGate(
  tenantId: string,
  now: Date = new Date(),
): Promise<GateDecision> {
  const sub = await db.subscription.findUnique({ where: { tenantId }, select: { id: true } })
  if (!sub) {
    return { allowed: true, reason: 'no_subscription' } // legado/piloto: grandfathered
  }
  if (await isSubscriptionActive(tenantId, now)) {
    return { allowed: true, reason: 'active' }
  }
  // Assinatura existe mas não está ativa (trial/pagamento expirou ou foi cancelado).
  if (!isBillingGateEnabled()) {
    return { allowed: true, reason: 'gate_disabled' } // construído, mas desligado por segurança
  }
  return { allowed: false, reason: 'inactive' }
}
