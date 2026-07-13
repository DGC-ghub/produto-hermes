import { syncSubscriptionFromMp } from '../lib/billing.server'
import { verifyMpWebhookSignature } from '../lib/mercadopago.server'
import { checkRate, type RateState, rateConfig } from '../lib/rate-limit'
import type { Route } from './+types/webhook.mercadopago'

// Webhook do Mercado Pago (marco M3): o MP notifica por POST (query ?data.id=) quando uma
// assinatura muda de estado. Antes de qualquer chamada de saída, VALIDA a assinatura
// x-signature (issue #6: era endpoint público não autenticado que mutava assinatura e
// disparava chamadas ao MP com o token real). Fail-closed: sem MP_WEBHOOK_SECRET, rejeita.
// O sync em si é seguro (só um preapproval já conhecido, re-busca a fonte da verdade no MP).

// Teto global anti-flood (o app vê tudo como localhost atrás da ponte). Estado no processo.
let rateState: RateState = { windowStart: 0, count: 0 }

export async function action({ request }: Route.ActionArgs) {
  // Anti-flood: rejeita o excesso ANTES de validar/sincronizar (barato).
  const { max, windowMs } = rateConfig()
  const rate = checkRate(Date.now(), rateState, max, windowMs)
  rateState = rate.state
  if (!rate.allowed) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': String(rate.retryAfterSec) },
    })
  }

  const url = new URL(request.url)
  const dataId = url.searchParams.get('data.id') ?? url.searchParams.get('id')

  const secret = process.env.MP_WEBHOOK_SECRET
  const valid = verifyMpWebhookSignature({
    dataId,
    xSignature: request.headers.get('x-signature'),
    xRequestId: request.headers.get('x-request-id'),
    secret,
  })
  if (!valid) {
    if (!secret) {
      console.warn('[mp] MP_WEBHOOK_SECRET não configurado — webhook rejeitado (fail-closed)')
    }
    return new Response('Invalid signature', { status: 401 })
  }

  if (dataId) {
    await syncSubscriptionFromMp(dataId)
  }
  // 200 sempre (após validar): senão o MP fica re-tentando.
  return new Response('ok', { status: 200 })
}

// GET NÃO dispara sync (issue #6: um GET anônimo disparava chamada de saída). Só o POST
// assinado do MP muta. Responde 200 (health) pra validação de URL do painel.
export async function loader() {
  return new Response('ok', { status: 200 })
}
