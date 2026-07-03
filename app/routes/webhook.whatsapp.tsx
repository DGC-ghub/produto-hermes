import { checkRate, type RateState, rateConfig } from '../lib/rate-limit'
import {
  parseInboundMessages,
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '../lib/whatsapp.server'
import { drainPending, persistInbound } from '../lib/whatsapp-queue.server'
import type { Route } from './+types/webhook.whatsapp'

// Teto global do webhook público (o app vê tudo como localhost atrás da ponte, então
// não dá pra limitar por IP). Estado no processo — zera a cada reinício do serviço.
let rateState: RateState = { windowStart: 0, count: 0 }

// GET — handshake de verificação: a Meta chama a URL com o verify_token; devolvemos
// o challenge só se bater. É como a Meta confirma que a URL é nossa.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const challenge = verifyWebhookChallenge(url.searchParams)
  if (challenge) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response('Forbidden', { status: 403 })
}

// POST — mensagens recebidas. Valida a assinatura, PERSISTE os eventos (dedup por
// wamid) e só então devolve 200: a Meta tem timeout curto e a IA pode levar ~20s.
// O processamento sai da fila (drainPending) — restart não perde mensagem e
// redelivery não gera resposta dupla.
export async function action({ request }: Route.ActionArgs) {
  // Anti-flood: rejeita o excesso ANTES de ler o corpo ou validar assinatura (barato).
  const { max, windowMs } = rateConfig()
  const rate = checkRate(Date.now(), rateState, max, windowMs)
  rateState = rate.state
  if (!rate.allowed) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: { 'Retry-After': String(rate.retryAfterSec) },
    })
  }

  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyWebhookSignature(rawBody, signature)) {
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad payload', { status: 400 })
  }

  // Persistir ANTES do 200: se falhar (ex.: banco fora), a Meta recebe 500 e
  // REENVIA depois — melhor um retry da Meta do que uma mensagem perdida.
  await persistInbound(parseInboundMessages(payload))
  void drainPending()
  return new Response('EVENT_RECEIVED', { status: 200 })
}
